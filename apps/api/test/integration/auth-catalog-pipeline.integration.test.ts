/**
 * End-to-end proof of the request pipeline described in `auth.guard.ts`:
 * bearer token → project binding → JWKS verification → user provisioning →
 * tenant resolution → RLS-scoped query → response — booting the real
 * `AppModule` and making real HTTP calls, against a real Postgres and Redis.
 *
 * This is the permanent home for what was previously a one-off manual smoke
 * script (see CONTRIBUTING.md's "why not `Scope.REQUEST`" section, and the
 * two DI pitfalls it documents — both were only caught by an end-to-end run
 * like this one, not by any unit test). Ports the same scenarios that script
 * verified, so the proof survives past the session that found the bugs.
 *
 * Implements P1-01, P1-03, P1-04, P1-05 acceptance criteria end-to-end, and
 * P2-05's "existence is not disclosed" rule (unknown slug is 404, not 403).
 */

import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK } from "jose";
import { AppModule } from "../../src/app.module.js";
import { configureApp } from "../../src/configure-app.js";
import { loadConfig } from "../../src/config/config.js";
import { seedLearner } from "./support/seed-learner.js";
import { requireEnv } from "./support/env.js";

const SUPERUSER_URL = requireEnv("POSTGRES_SUPERUSER_URL");

// Config validated once at boot (`config.ts`). The KEYCLOAK_* values are never
// actually used per-request — every request's issuer/audience come from the
// resolved project binding row — but the schema requires *something* well-
// formed, so a harmless placeholder goes here rather than in every test case.
process.env["KEYCLOAK_ISSUER"] ??= "http://127.0.0.1:1/realms/unused";
process.env["KEYCLOAK_AUDIENCE"] ??= "unused";
process.env["KEYCLOAK_JWKS_URI"] ??=
  "http://127.0.0.1:1/realms/unused/protocol/openid-connect/certs";
process.env["NODE_ENV"] ??= "test";
// The submission worker has its own suite; leaving it sweeping here would
// mutate eiv_submissions rows underneath these assertions.
process.env["EIV_WORKER_ENABLED"] = "no";

const KID = "integration-test-key";

let jwksServer: Server;
let jwksPort: number;
let privateKey: CryptoKey;
let otherPrivateKey: CryptoKey;

let app: NestExpressApplication;
let baseUrl: string;

let seedPool: Pool;

/** The realm/issuer this run's fake JWKS endpoint serves. Unique per run so
 * parallel test runs (or a re-run without a fresh database) never collide on
 * `(provider, realm, subject)` in `user_identities`. */
let issuer: string;
const AUDIENCE = "ds-education-api";

let projectSlug: string;
let customerId: string;
let courseSlug: string;

/** The second tenant: same issuer, different customer — see the fixture. */
let otherCustomerId: string;
let otherProjectSlug: string;
let otherCourseSlug: string;

const GRANTED_SUB = "sub-with-grant";
const UNGRANTED_SUB = "sub-without-grant";

beforeAll(async () => {
  seedPool = new Pool({ connectionString: SUPERUSER_URL });

  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  const other = await generateKeyPair("RS256");
  otherPrivateKey = other.privateKey;
  const publicJwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: KID, alg: "RS256" };

  jwksPort = await startFakeJwksServer(publicJwk);
  issuer = `http://127.0.0.1:${jwksPort}/realms/integration-test`;

  const suffix = randomUUID().slice(0, 8);
  projectSlug = `pipeline-project-${suffix}`;
  courseSlug = `pipeline-course-${suffix}`;
  otherProjectSlug = `pipeline-other-project-${suffix}`;
  otherCourseSlug = `pipeline-other-course-${suffix}`;

  const {
    rows: [customer],
  } = await seedPool.query<{ id: string }>(
    "INSERT INTO customers (slug, name) VALUES ($1, $2) RETURNING id",
    [`pipeline-customer-${suffix}`, "Pipeline Test GmbH"],
  );
  customerId = customer!.id;

  const {
    rows: [department],
  } = await seedPool.query<{ id: string }>(
    "INSERT INTO departments (customer_id, slug, name) VALUES ($1, $2, $3) RETURNING id",
    [customerId, "default", "Default"],
  );

  const {
    rows: [project],
  } = await seedPool.query<{ id: string }>(
    `INSERT INTO projects (customer_id, department_id, slug, name, keycloak_issuer, keycloak_audience)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [customerId, department!.id, projectSlug, "Pipeline project", issuer, AUDIENCE],
  );

  // Real, non-hardcoded values — the point of asserting on them below is that
  // they are the *course's* configuration, not a widget constant (P5-06).
  await seedPool.query(
    `INSERT INTO courses (customer_id, project_id, slug, title, required_watch_percent, pass_threshold_percent)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [customerId, project!.id, courseSlug, "Pipeline course", 100, 70],
  );

  /*
   * A **second customer**, with its own project on the same issuer and its own
   * course (P52-04).
   *
   * The same realm deliberately: two customers federated from one Keycloak is
   * the arrangement where a mistake is easiest to make and hardest to see,
   * because the token verifies perfectly and only the *grant* separates them.
   * Two issuers would make the test pass for the wrong reason — the signature
   * check would catch it before authorisation ever ran.
   */
  const {
    rows: [otherCustomer],
  } = await seedPool.query<{ id: string }>(
    "INSERT INTO customers (slug, name) VALUES ($1, $2) RETURNING id",
    [`pipeline-other-${suffix}`, "Pipeline Other GmbH"],
  );
  otherCustomerId = otherCustomer!.id;

  const {
    rows: [otherDepartment],
  } = await seedPool.query<{ id: string }>(
    "INSERT INTO departments (customer_id, slug, name) VALUES ($1, $2, $3) RETURNING id",
    [otherCustomerId, "default", "Default"],
  );

  const {
    rows: [otherProject],
  } = await seedPool.query<{ id: string }>(
    `INSERT INTO projects (customer_id, department_id, slug, name, keycloak_issuer, keycloak_audience)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      otherCustomerId,
      otherDepartment!.id,
      otherProjectSlug,
      "Pipeline other project",
      issuer,
      AUDIENCE,
    ],
  );

  await seedPool.query(
    `INSERT INTO courses (customer_id, project_id, slug, title, required_watch_percent, pass_threshold_percent)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [otherCustomerId, otherProject!.id, otherCourseSlug, "Other course", 100, 70],
  );

  // Pre-provision the "granted" learner and their role — `provisionOrUpdate`
  // resolves on (provider, realm, subject), so the auth guard's first-sight
  // sync finds and reuses this row rather than creating a second one.
  const grantedUser = await seedLearner(seedPool, {
    realm: issuer,
    subject: GRANTED_SUB,
    email: "learner@example.org",
    firstName: "Anna",
    lastName: "Müller",
  });
  await seedPool.query(
    "INSERT INTO user_roles (user_id, role, customer_id) VALUES ($1, 'learner', $2)",
    [grantedUser.id, customerId],
  );
  // UNGRANTED_SUB is deliberately never provisioned: the guard provisions it
  // on first sight, with zero roles, so resolveTenantContext denies it.

  app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: false,
    // Configured by `configureApp` below, exactly as `main.ts` does it. A
    // suite that boots the app differently from production is testing a
    // different application — which is how the font route's body limit got
    // past this suite once already.
    bodyParser: false,
  });
  await configureApp(app, loadConfig());
  await app.listen(0);
  const address = app.getHttpServer().address();
  if (address === null || typeof address === "string") {
    throw new Error("expected the HTTP server to bind a TCP port");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
}, 30_000);

afterAll(async () => {
  await app?.close();
  await new Promise<void>((resolve) => jwksServer.close(() => resolve()));
  await seedPool.end();
});

function startFakeJwksServer(jwk: JWK): Promise<number> {
  return new Promise((resolve, reject) => {
    jwksServer = createServer((request, response) => {
      if (request.url?.endsWith("/protocol/openid-connect/certs")) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ keys: [jwk] }));
        return;
      }
      response.writeHead(404).end();
    });
    jwksServer.on("error", reject);
    jwksServer.listen(0, "127.0.0.1", () => {
      const address = jwksServer.address();
      if (address === null || typeof address === "string") {
        reject(new Error("expected the fake JWKS server to bind a TCP port"));
        return;
      }
      resolve(address.port);
    });
  });
}

async function mint(
  sub: string,
  overrides: { audience?: string; signWith?: CryptoKey } = {},
): Promise<string> {
  return new SignJWT({ email: "learner@example.org" })
    .setProtectedHeader({ alg: "RS256", kid: KID })
    .setIssuedAt()
    .setIssuer(issuer)
    .setAudience(overrides.audience ?? AUDIENCE)
    .setSubject(sub)
    .setExpirationTime("5m")
    .sign(overrides.signWith ?? privateKey);
}

describe("GET /health — public, needs no token", () => {
  it("returns 200 with no Authorization header at all", async () => {
    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(200);
  });
});

describe("GET /courses — deny by default", () => {
  it("401s with no bearer token", async () => {
    const response = await fetch(`${baseUrl}/courses`, {
      headers: { "x-ds-project": projectSlug },
    });
    expect(response.status).toBe(401);
  });

  it("401s with a valid token but no X-DS-Project header", async () => {
    const token = await mint(GRANTED_SUB);
    const response = await fetch(`${baseUrl}/courses`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(401);
  });

  it("401s for an unknown project slug — never a 404 that would confirm/deny it exists", async () => {
    const token = await mint(GRANTED_SUB);
    const response = await fetch(`${baseUrl}/courses`, {
      headers: {
        authorization: `Bearer ${token}`,
        "x-ds-project": "no-such-project-slug",
      },
    });
    expect(response.status).toBe(401);
  });

  it("401s a token signed by a different key — a tampered or forged signature", async () => {
    const token = await mint(GRANTED_SUB, { signWith: otherPrivateKey });
    const response = await fetch(`${baseUrl}/courses`, {
      headers: { authorization: `Bearer ${token}`, "x-ds-project": projectSlug },
    });
    expect(response.status).toBe(401);
  });

  it("401s a token minted for a different audience", async () => {
    const token = await mint(GRANTED_SUB, { audience: "some-other-client" });
    const response = await fetch(`${baseUrl}/courses`, {
      headers: { authorization: `Bearer ${token}`, "x-ds-project": projectSlug },
    });
    expect(response.status).toBe(401);
  });

  it("403s a validly-authenticated user with no grant reaching this customer", async () => {
    const token = await mint(UNGRANTED_SUB);
    const response = await fetch(`${baseUrl}/courses`, {
      headers: { authorization: `Bearer ${token}`, "x-ds-project": projectSlug },
    });
    expect(response.status).toBe(403);
  });

  it("200s a validly-authenticated user with a grant, returning this tenant's course", async () => {
    const token = await mint(GRANTED_SUB);
    const response = await fetch(`${baseUrl}/courses`, {
      headers: { authorization: `Bearer ${token}`, "x-ds-project": projectSlug },
    });
    expect(response.status).toBe(200);

    const body = (await response.json()) as { items: Array<{ slug: string }> };
    expect(body.items.map((item) => item.slug)).toEqual([courseSlug]);
  });
});

describe("first-sight provisioning", () => {
  it("does not erase a stored name when the token carries no name claims", async () => {
    // `mint` sets no given_name/family_name — which is what a token issued
    // without the profile scope looks like. The stored name must survive it:
    // it is the fallback that prints as "Name des Teilnehmenden" on the
    // Teilnahmebescheinigung, and an absent claim is not an instruction to
    // clear it.
    const token = await mint(GRANTED_SUB);
    await fetch(`${baseUrl}/courses`, {
      headers: { authorization: `Bearer ${token}`, "x-ds-project": projectSlug },
    });

    const { rows } = await seedPool.query<{ first_name: string; last_name: string }>(
      `SELECT u.first_name, u.last_name
         FROM users u
         JOIN user_identities i ON i.user_id = u.id
        WHERE i.realm = $1 AND i.subject = $2`,
      [issuer, GRANTED_SUB],
    );

    expect(rows[0]?.first_name).toBe("Anna");
    expect(rows[0]?.last_name).toBe("Müller");
  });
});

describe("GET /courses/:slug", () => {
  it("returns the course's actual configured percentages, not a hardcoded value (P5-06)", async () => {
    const token = await mint(GRANTED_SUB);
    const response = await fetch(`${baseUrl}/courses/${courseSlug}`, {
      headers: { authorization: `Bearer ${token}`, "x-ds-project": projectSlug },
    });
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      requiredWatchPercent: number;
      passThresholdPercent: number;
    };
    expect(body.requiredWatchPercent).toBe(100);
    expect(body.passThresholdPercent).toBe(70);
  });

  /*
   * Cross-tenant reads over the bearer path (P52-04).
   *
   * Every one of these was checked by hand during a QA pass and none of them
   * was pinned by anything: the suite had exactly one customer, so "tenant A
   * cannot read tenant B" was unfalsifiable here. The session path has had
   * these tests since P21-03 (`participant-auth`); the federated path did not,
   * and that is the path MEDICE's physicians actually arrive on.
   *
   * A security property verified by clicking is a security property that
   * regresses silently (CLAUDE.md §9.7).
   */
  it("404s another tenant's course slug, for a token that is otherwise valid", async () => {
    const token = await mint(GRANTED_SUB);

    const response = await fetch(`${baseUrl}/courses/${otherCourseSlug}`, {
      headers: { authorization: `Bearer ${token}`, "x-ds-project": projectSlug },
    });

    // 404 and not 403: a course in another tenant must be indistinguishable
    // from one that does not exist, or the status code enumerates the
    // platform's customers (§9.5).
    expect(response.status).toBe(404);
  });

  it("does not name the other tenant's course in the refusal", async () => {
    const token = await mint(GRANTED_SUB);
    const response = await fetch(`${baseUrl}/courses/${otherCourseSlug}`, {
      headers: { authorization: `Bearer ${token}`, "x-ds-project": projectSlug },
    });

    // The slug is the caller's own input, so echoing it back proves nothing on
    // its own — the title is the thing only the server knows.
    expect(await response.text()).not.toContain("Other course");
  });

  it("403s a token presented against the other tenant's project", async () => {
    // Same issuer, same audience, same signature — everything verifies. The
    // only thing standing between this learner and another customer's
    // catalogue is the grant, which is exactly what makes it worth a test.
    const token = await mint(GRANTED_SUB);

    const response = await fetch(`${baseUrl}/courses`, {
      headers: { authorization: `Bearer ${token}`, "x-ds-project": otherProjectSlug },
    });

    expect(response.status).toBe(403);
  });

  it("never returns the other tenant's course in a list", async () => {
    const token = await mint(GRANTED_SUB);
    const response = await fetch(`${baseUrl}/courses`, {
      headers: { authorization: `Bearer ${token}`, "x-ds-project": projectSlug },
    });

    const body = (await response.json()) as { items: Array<{ slug: string }> };
    expect(body.items.map((c) => c.slug)).toContain(courseSlug);
    expect(body.items.map((c) => c.slug)).not.toContain(otherCourseSlug);
  });

  it("404s an unknown slug rather than disclosing existence with a 403", async () => {
    const token = await mint(GRANTED_SUB);
    const response = await fetch(`${baseUrl}/courses/does-not-exist-${randomUUID()}`, {
      headers: { authorization: `Bearer ${token}`, "x-ds-project": projectSlug },
    });
    expect(response.status).toBe(404);
  });
});
