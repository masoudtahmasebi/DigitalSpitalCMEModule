/**
 * The EIV admin routes over HTTP (TEST-4, P250-02). **Human review gate — eiv.**
 *
 * ## Why this is a separate file from `eiv-admin.integration.test.ts`
 *
 * That suite drives `EivAdminService` directly, inside a tenant scope it opens
 * itself. It proves the decisions; it cannot prove who reaches them, because
 * it never passes `AuthGuard`, `RolesGuard` or the tenant interceptor. Every
 * one of these seven routes reaches an Ärztekammer with a customer's VNR
 * credential — files, corrects or withdraws a physician's Punktemeldung — and
 * until this file nothing asserted that a learner, or another customer's
 * administrator, is turned away from them.
 *
 * ## What would make it red
 *
 * `RolesGuard` is deny-by-default, so **removing** `@Roles` from a route turns
 * the own administrator's call into a 403 — which is why every route has a
 * case below in which the right person succeeds. **Widening** it is the other
 * direction, and the learner's refusals catch that one.
 *
 * The authority is `startMockServer`, the same mock the worker suite uses,
 * reached through `platform_settings.eiv_endpoint = 'mock'` and
 * `EIV_MOCK_BASE_URL` — set explicitly below, because the shipped default is
 * the live register.
 */

import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { createPool } from "@ds/postgres";
import { createSecretCipher } from "@ds/secrets";
import { startMockServer, type MockServer } from "@ds/eiv-client";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK } from "jose";
import { AppModule } from "../../src/app.module.js";
import { configureApp } from "../../src/configure-app.js";
import { loadConfig } from "../../src/config/config.js";
import { seedLearner } from "./support/seed-learner.js";
import { requireEnv } from "./support/env.js";

const SUPERUSER_URL = requireEnv("POSTGRES_SUPERUSER_URL");

const KMS_KEY = Buffer.alloc(32, "ds-eiv-admin-http-key-not-secret").toString("base64");
process.env["NODE_ENV"] ??= "test";
process.env["SECRETS_KMS_KEY"] = KMS_KEY;
process.env["CERTIFICATE_DELIVERY_ENABLED"] = "no";

const KID = "eiv-admin-http-key";
const AUDIENCE = "ds-education-api";
const RUN = randomUUID().slice(0, 8);
const LEARNER_SUB = `eiv-http-learner-${RUN}`;
const ADMIN_SUB = `eiv-http-admin-${RUN}`;
const FOREIGN_ADMIN_SUB = `eiv-http-foreign-${RUN}`;

const VNR = "2760552025919300099";
/** Distinctive, so its appearance anywhere in a response is unambiguous. */
const VNR_PASSWORD = `vnr-kennwort-${RUN}`;
const EFN = "802760699999990";
const CORRECTED_EFN = "802760699999995";

let jwksServer: Server;
let mock: MockServer;
let privateKey: CryptoKey;
let issuer: string;
let app: NestExpressApplication;
let baseUrl: string;
let seedPool: Pool;

let projectA: string;
let projectB: string;
let courseSlug: string;

/** One enrolment per action, each in the state its own admin case needs. */
let requeueable: string;
let correctable: string;
let withdrawable: string;

beforeAll(async () => {
  seedPool = createPool({ connectionString: SUPERUSER_URL });
  mock = await startMockServer(0, { eventBeginn: "2020-01-01", eventEnde: "2099-12-31" });
  process.env["EIV_MOCK_BASE_URL"] = mock.url;

  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: KID, alg: "RS256" };
  const port = await startJwks(jwk);
  issuer = `http://127.0.0.1:${port}/realms/eiv-admin-http-${RUN}`;
  process.env["KEYCLOAK_ISSUER"] = issuer;
  process.env["KEYCLOAK_AUDIENCE"] = AUDIENCE;
  process.env["KEYCLOAK_JWKS_URI"] = `${issuer}/protocol/openid-connect/certs`;

  const a = await seedTenant("a");
  const b = await seedTenant("b");
  projectA = a.projectSlug;
  projectB = b.projectSlug;

  courseSlug = `eiv-http-kurs-${RUN}`;
  const courseId = await insert(
    `INSERT INTO courses (customer_id, project_id, slug, title, required_watch_percent,
                          pass_threshold_percent, vnr, vnr_password_enc, status)
     VALUES ($1,$2,$3,$4,100,70,$5,$6,'published') RETURNING id`,
    [
      a.customerId,
      a.projectId,
      courseSlug,
      "EIV über HTTP",
      VNR,
      createSecretCipher("test", KMS_KEY).encrypt(VNR_PASSWORD),
    ],
  );

  await grant(LEARNER_SUB, "learner", a.customerId);
  await grant(ADMIN_SUB, "customer_admin", a.customerId);
  await grant(FOREIGN_ADMIN_SUB, "customer_admin", b.customerId);

  /*
   * The register this installation talks to, set to the mock **explicitly**.
   * Since migration 0053 a fresh `platform_settings` row points at `live`
   * (and `reset.ts` restores that default per file), so a suite that leaves
   * it alone sends every one of these routes — withdraw included — to the
   * production EIV with a test VNR. The first run of this file did exactly
   * that and was refused at `auth`; the worker stays off either way.
   */
  await seedPool.query(
    "UPDATE platform_settings SET eiv_endpoint = 'mock', eiv_worker_enabled = false",
  );

  requeueable = await seedSubmission(a.customerId, courseId, "failed_permanent");
  correctable = await seedSubmission(a.customerId, courseId, "queued");
  withdrawable = await seedSubmission(a.customerId, courseId, "submitted");

  app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: false,
    bodyParser: false,
  });
  await configureApp(app, loadConfig());
  await app.listen(0);
  const address = app.getHttpServer().address();
  if (address === null || typeof address === "string") {
    throw new Error("expected a bound TCP port");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
}, 30_000);

afterAll(async () => {
  await app?.close();
  await mock?.close();
  await new Promise<void>((resolve) => jwksServer.close(() => resolve()));
  await seedPool.end();
});

async function insert(sql: string, values: unknown[]): Promise<string> {
  const { rows } = await seedPool.query<{ id: string }>(sql, values);
  const id = rows[0]?.id;
  if (id === undefined) throw new Error(`seed insert returned no id: ${sql}`);
  return id;
}

async function seedTenant(tag: string) {
  const customerId = await insert(
    "INSERT INTO customers (slug, name) VALUES ($1,$2) RETURNING id",
    [`eiv-http-${tag}-${RUN}`, `EIV HTTP ${tag} GmbH`],
  );
  const departmentId = await insert(
    "INSERT INTO departments (customer_id, slug, name) VALUES ($1,$2,$3) RETURNING id",
    [customerId, "default", "Default"],
  );
  const projectSlug = `eiv-http-projekt-${tag}-${RUN}`;
  const projectId = await insert(
    `INSERT INTO projects (customer_id, department_id, slug, name,
                           keycloak_issuer, keycloak_audience)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [customerId, departmentId, projectSlug, "Projekt", issuer, AUDIENCE],
  );
  return { customerId, projectId, projectSlug };
}

async function grant(subject: string, role: string, customerId: string): Promise<void> {
  const { id } = await seedLearner(seedPool, { realm: issuer, subject });
  await seedPool.query(
    "INSERT INTO user_roles (user_id, role, customer_id) VALUES ($1,$2,$3)",
    [id, role, customerId],
  );
}

/** A completed enrolment with a Punktemeldung in `status`; returns the enrolment id. */
async function seedSubmission(
  customerId: string,
  courseId: string,
  status: string,
): Promise<string> {
  const suffix = randomUUID().slice(0, 8);
  const { id: userId } = await seedLearner(seedPool, {
    realm: `http://127.0.0.1/realms/eiv-http-participant-${suffix}`,
    subject: `participant-${suffix}`,
  });
  const enrolmentId = await insert(
    `INSERT INTO enrolments (customer_id, course_id, user_id, required_watch_percent,
                             pass_threshold_percent, completed_at)
     VALUES ($1,$2,$3,100,70,now()) RETURNING id`,
    [customerId, courseId, userId],
  );
  await insert(
    `INSERT INTO eiv_submissions (customer_id, enrolment_id, vnr, efn, event_end_at,
                                  report_due_at, first_submitted_at, attempt_count,
                                  last_error, status)
     VALUES ($1,$2,$3,$4,now(),now() + interval '8 days',
             CASE WHEN $5::text = 'submitted' THEN now() ELSE NULL END,
             CASE WHEN $5::text = 'failed_permanent' THEN 4 ELSE 0 END,
             CASE WHEN $5::text = 'failed_permanent' THEN 'business' ELSE NULL END,
             $5::text::eiv_status) RETURNING id`,
    [customerId, enrolmentId, VNR, EFN, status],
  );
  return enrolmentId;
}

async function statusOf(enrolmentId: string): Promise<{ status: string; efn: string }> {
  const { rows } = await seedPool.query<{ status: string; efn: string }>(
    "SELECT status, efn FROM eiv_submissions WHERE enrolment_id = $1",
    [enrolmentId],
  );
  return rows[0] ?? { status: "", efn: "" };
}

function startJwks(jwk: JWK): Promise<number> {
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
        reject(new Error("expected a bound TCP port"));
        return;
      }
      resolve(address.port);
    });
  });
}

interface Answer {
  readonly status: number;
  // Responses vary by route; each case asserts on the fields it names.
  readonly body: any;
}

async function callAs(sub: string, project: string, route: Route): Promise<Answer> {
  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid: KID })
    .setIssuedAt()
    .setIssuer(issuer)
    .setAudience(AUDIENCE)
    .setSubject(sub)
    .setExpirationTime("5m")
    .sign(privateKey);

  const response = await fetch(`${baseUrl}${route.path}`, {
    method: route.method,
    headers: {
      authorization: `Bearer ${jwt}`,
      "x-ds-project": project,
      ...(route.body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(route.body === undefined ? {} : { body: JSON.stringify(route.body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text === "" ? undefined : JSON.parse(text) };
}

interface Route {
  readonly name: string;
  readonly method: string;
  readonly path: string;
  readonly body?: unknown;
}

/** Every route on `EivAdminController`, each aimed at tenant A's data. */
function routes(): readonly Route[] {
  return [
    { name: "list submissions", method: "GET", path: "/admin/eiv/submissions" },
    {
      name: "describe event",
      method: "GET",
      path: `/admin/courses/${courseSlug}/eiv/event`,
    },
    {
      name: "connection check",
      method: "POST",
      path: `/admin/courses/${courseSlug}/eiv/check`,
      body: {},
    },
    {
      name: "reconcile",
      method: "GET",
      path: `/admin/courses/${courseSlug}/eiv/reported`,
    },
    { name: "requeue", method: "POST", path: `/admin/learners/${requeueable}/eiv` },
    {
      name: "correct EFN",
      method: "PATCH",
      path: `/admin/learners/${correctable}/eiv/efn`,
      body: { efn: CORRECTED_EFN },
    },
    {
      name: "withdraw",
      method: "DELETE",
      path: `/admin/learners/${withdrawable}/eiv`,
      body: { reason: "Widerruf im Test" },
    },
  ];
}

describe("who is turned away from the EIV admin routes", () => {
  it("refuses a learner of the same customer on every route", async () => {
    for (const route of routes()) {
      const answer = await callAs(LEARNER_SUB, projectA, route);
      expect(answer.status, `${route.name}: ${JSON.stringify(answer.body)}`).toBe(403);
    }
  });

  it("refuses another customer's administrator naming this customer's project", async () => {
    for (const route of routes()) {
      const answer = await callAs(FOREIGN_ADMIN_SUB, projectA, route);
      expect(answer.status, `${route.name}: ${JSON.stringify(answer.body)}`).toBe(403);
    }
  });

  it("finds nothing of this customer's from inside another customer", async () => {
    for (const route of routes()) {
      const answer = await callAs(FOREIGN_ADMIN_SUB, projectB, route);
      if (route.name === "list submissions") {
        // Reachable — it is their own queue — and empty of anything of A's.
        expect(answer.status).toBe(200);
        expect(JSON.stringify(answer.body)).not.toContain(requeueable);
        expect(answer.body.total).toBe(0);
      } else {
        expect(answer.status, `${route.name}: ${JSON.stringify(answer.body)}`).toBe(404);
      }
    }
  });

  it("left every Punktemeldung exactly as it was", async () => {
    expect(await statusOf(requeueable)).toEqual({ status: "failed_permanent", efn: EFN });
    expect(await statusOf(correctable)).toEqual({ status: "queued", efn: EFN });
    expect(await statusOf(withdrawable)).toEqual({ status: "submitted", efn: EFN });
  });
});

describe("the customer's own administrator reaches every route", () => {
  /*
   * The half that goes red when `@Roles` is *removed*: `RolesGuard` refuses a
   * route with no decorator, so the right person would get a 403 here.
   */
  it("lists the queue", async () => {
    const [route] = routes().filter((r) => r.name === "list submissions");
    const answer = await callAs(ADMIN_SUB, projectA, route!);
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    expect(answer.body.total).toBe(3);
  });

  it("reads the accredited event from the register", async () => {
    const [route] = routes().filter((r) => r.name === "describe event");
    const answer = await callAs(ADMIN_SUB, projectA, route!);
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    expect(answer.body.title).toBe("Mock-Fortbildung");
  });

  it("checks the connection, and the answer carries no password", async () => {
    const answer = await callAs(ADMIN_SUB, projectA, {
      name: "connection check",
      method: "POST",
      path: `/admin/courses/${courseSlug}/eiv/check`,
      body: { vnrPassword: VNR_PASSWORD },
    });
    // 201 is Nest's default for a POST and what this route has always sent.
    expect(answer.status, JSON.stringify(answer.body)).toBe(201);
    // It really reached the register with the supplied password, so the
    // assertions below are about a response that handled one.
    expect(answer.body.tier).toBe("mock");
    expect(answer.body.steps.every((step: { ok: boolean }) => step.ok)).toBe(true);

    // Neither the value, nor any password-named field holding a string, at
    // any depth: a masked or empty password is still a password field (§4
    // invariant 7). `usedStoredPassword` is a boolean saying *which* password
    // was used, and is the one such key the report legitimately carries.
    const serialised = JSON.stringify(answer.body);
    expect(serialised).not.toContain(VNR_PASSWORD);
    const passwordShaped = fieldsOf(answer.body).filter(
      ([key, value]) => /pass|secret|kennwort/iu.test(key) && typeof value !== "boolean",
    );
    expect(passwordShaped).toEqual([]);
    expect(answer.body.usedStoredPassword).toBe(false);
  });

  it("reconciles with the register", async () => {
    const [route] = routes().filter((r) => r.name === "reconcile");
    const answer = await callAs(ADMIN_SUB, projectA, route!);
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
  });

  it("requeues an abandoned Punktemeldung", async () => {
    const [route] = routes().filter((r) => r.name === "requeue");
    const answer = await callAs(ADMIN_SUB, projectA, route!);
    expect(answer.status, JSON.stringify(answer.body)).toBe(204);
    expect((await statusOf(requeueable)).status).toBe("queued");
  });

  it("corrects the EFN of an unreported one", async () => {
    const [route] = routes().filter((r) => r.name === "correct EFN");
    const answer = await callAs(ADMIN_SUB, projectA, route!);
    expect(answer.status, JSON.stringify(answer.body)).toBe(204);
    expect((await statusOf(correctable)).efn).toBe(CORRECTED_EFN);
  });

  it("withdraws a reported one", async () => {
    const [route] = routes().filter((r) => r.name === "withdraw");
    const answer = await callAs(ADMIN_SUB, projectA, route!);
    expect(answer.status, JSON.stringify(answer.body)).toBe(204);
    expect((await statusOf(withdrawable)).status).toBe("withdrawn");
  });
});

/** Every `[key, value]` in a JSON value, at any depth. */
function fieldsOf(value: unknown): Array<[string, unknown]> {
  if (Array.isArray(value)) return value.flatMap(fieldsOf);
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, inner]): Array<[string, unknown]> => [
      [key, inner],
      ...fieldsOf(inner),
    ]);
  }
  return [];
}
