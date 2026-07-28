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

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(
      `${name} must be set to run the integration suite — see .env.example.`,
    );
  }
  return value;
}

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
 * `(keycloak_realm, keycloak_sub)`. */
let issuer: string;
const AUDIENCE = "ds-education-api";

let projectSlug: string;
let customerId: string;
let courseSlug: string;

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

  // Pre-provision the "granted" learner and their role — `provisionOrUpdate`
  // upserts on (keycloak_realm, keycloak_sub), so the auth guard's first-sight
  // sync finds and reuses this row rather than creating a second one.
  const {
    rows: [grantedUser],
  } = await seedPool.query<{ id: string }>(
    `INSERT INTO users (keycloak_realm, keycloak_sub, email, first_name, last_name)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [issuer, GRANTED_SUB, "learner@example.org", "Anna", "Müller"],
  );
  await seedPool.query(
    "INSERT INTO user_roles (user_id, role, customer_id) VALUES ($1, 'learner', $2)",
    [grantedUser!.id, customerId],
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
      "SELECT first_name, last_name FROM users WHERE keycloak_realm = $1 AND keycloak_sub = $2",
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

  it("404s an unknown slug rather than disclosing existence with a 403", async () => {
    const token = await mint(GRANTED_SUB);
    const response = await fetch(`${baseUrl}/courses/does-not-exist-${randomUUID()}`, {
      headers: { authorization: `Bearer ${token}`, "x-ds-project": projectSlug },
    });
    expect(response.status).toBe(404);
  });
});
