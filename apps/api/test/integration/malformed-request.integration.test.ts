/**
 * A malformed id or a repeated query parameter is the caller's mistake (P250-03).
 *
 * ## The defect
 *
 * Every admin route below took its path id as a bare string and handed it to a
 * query. A value that is not a uuid came back from the driver as
 * `invalid input syntax for type uuid` and the caller got a **500** — measured
 * on 05.10.2026 against all of them, before `shared/request-params.ts`
 * existed. Three list routes did the same with a repeated query parameter,
 * which Express delivers as an array.
 *
 * A 500 says the platform is broken, gives the caller nothing to fix, and
 * counts towards the error rate the alerting watches. These answer **400**,
 * as a problem document, before any handler or query runs.
 *
 * ## Why every route rather than one
 *
 * The pipe is applied per parameter, so one route that lacks it is a hole no
 * other case would notice. `request-params.test.ts` checks the annotation on
 * every controller statically; this checks that the annotation does what it
 * says, over HTTP, on each route a customer administrator can reach.
 */

import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { createPool } from "@ds/postgres";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK } from "jose";
import { AppModule } from "../../src/app.module.js";
import { configureApp } from "../../src/configure-app.js";
import { loadConfig } from "../../src/config/config.js";
import { seedLearner } from "./support/seed-learner.js";
import { requireEnv } from "./support/env.js";

const SUPERUSER_URL = requireEnv("POSTGRES_SUPERUSER_URL");

process.env["NODE_ENV"] ??= "test";
process.env["CERTIFICATE_DELIVERY_ENABLED"] = "no";

const KID = "malformed-request-key";
const AUDIENCE = "ds-education-api";
const RUN = randomUUID().slice(0, 8);
const ADMIN_SUB = `malformed-admin-${RUN}`;
/** Not a uuid, and not something a router would treat specially. */
const NOT_A_UUID = "not-a-uuid";

let jwksServer: Server;
let privateKey: CryptoKey;
let issuer: string;
let app: NestExpressApplication;
let baseUrl: string;
let seedPool: Pool;
let projectSlug: string;

beforeAll(async () => {
  seedPool = createPool({ connectionString: SUPERUSER_URL });

  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: KID, alg: "RS256" };
  const port = await startJwks(jwk);
  issuer = `http://127.0.0.1:${port}/realms/malformed-${RUN}`;
  process.env["KEYCLOAK_ISSUER"] = issuer;
  process.env["KEYCLOAK_AUDIENCE"] = AUDIENCE;
  process.env["KEYCLOAK_JWKS_URI"] = `${issuer}/protocol/openid-connect/certs`;

  const customerId = await insert(
    "INSERT INTO customers (slug, name) VALUES ($1,$2) RETURNING id",
    [`malformed-${RUN}`, "Malformed GmbH"],
  );
  const departmentId = await insert(
    "INSERT INTO departments (customer_id, slug, name) VALUES ($1,$2,$3) RETURNING id",
    [customerId, "default", "Default"],
  );
  projectSlug = `malformed-projekt-${RUN}`;
  await insert(
    `INSERT INTO projects (customer_id, department_id, slug, name,
                           keycloak_issuer, keycloak_audience)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [customerId, departmentId, projectSlug, "Projekt", issuer, AUDIENCE],
  );
  const { id } = await seedLearner(seedPool, { realm: issuer, subject: ADMIN_SUB });
  await seedPool.query(
    "INSERT INTO user_roles (user_id, role, customer_id) VALUES ($1,'customer_admin',$2)",
    [id, customerId],
  );

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
  await new Promise<void>((resolve) => jwksServer.close(() => resolve()));
  await seedPool.end();
});

async function insert(sql: string, values: unknown[]): Promise<string> {
  const { rows } = await seedPool.query<{ id: string }>(sql, values);
  const id = rows[0]?.id;
  if (id === undefined) throw new Error(`seed insert returned no id: ${sql}`);
  return id;
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

async function asAdmin(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; type: string | null; body: Record<string, unknown> }> {
  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid: KID })
    .setIssuedAt()
    .setIssuer(issuer)
    .setAudience(AUDIENCE)
    .setSubject(ADMIN_SUB)
    .setExpirationTime("5m")
    .sign(privateKey);
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${jwt}`,
      "x-ds-project": projectSlug,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return {
    status: response.status,
    type: response.headers.get("content-type"),
    body: text === "" ? {} : (JSON.parse(text) as Record<string, unknown>),
  };
}

const B = NOT_A_UUID;

/** Every customer-admin route with an id in its path, as measured: all 500 before. */
const ID_ROUTES: ReadonlyArray<readonly [string, string, unknown?]> = [
  ["PATCH", `/admin/learners/${B}/name`, { name: "Dr. Erika Musterfrau" }],
  ["GET", `/admin/learners/${B}/delivery-email`],
  ["PATCH", `/admin/learners/${B}/delivery-email`, { email: "" }],
  ["DELETE", `/admin/learners/${B}`, { reason: "Test" }],
  ["POST", `/admin/certificates/${B}/regenerate`],
  ["POST", `/admin/certificates/${B}/resend`],
  ["GET", `/admin/certificates/${B}/pdf`],
  ["POST", `/admin/certificates/${B}/revoke`, { reason: "Test" }],
  ["PATCH", `/admin/modules/${B}`, { title: "Modul" }],
  ["DELETE", `/admin/modules/${B}`],
  ["POST", `/admin/modules/${B}/chapters`, { title: "Kapitel", body: null }],
  ["PATCH", `/admin/chapters/${B}`, { title: "Kapitel" }],
  ["DELETE", `/admin/chapters/${B}`],
  ["POST", `/admin/chapters/${B}/contents`, { kind: "text", title: "Text" }],
  ["PATCH", `/admin/contents/${B}`, { title: "Inhalt" }],
  ["DELETE", `/admin/contents/${B}`],
  ["GET", `/admin/contents/${B}/quiz`],
  ["PUT", `/admin/contents/${B}/quiz`, { questions: [] }],
  ["PATCH", `/admin/media/${B}`, { title: "Datei" }],
  ["POST", `/admin/media/${B}/view`],
  ["DELETE", `/admin/media/${B}`],
  ["POST", `/admin/learners/${B}/eiv`],
  ["PATCH", `/admin/learners/${B}/eiv/efn`, { efn: "802760699999995" }],
  ["DELETE", `/admin/learners/${B}/eiv`, { reason: "Test" }],
  ["POST", `/admin/participants/${B}/reset-password`],
  ["POST", `/admin/participants/${B}/disabled`, { disabled: true }],
];

const REPEATED_QUERIES: ReadonlyArray<string> = [
  "/admin/participants?q=anna&q=berta",
  "/admin/learners?course=a&course=b",
  "/admin/certificates?course=a&course=b",
];

describe("an id that is not a uuid", () => {
  it.each(ID_ROUTES.map(([method, path, body]) => ({ method, path, body })))(
    "$method $path answers a 400 problem document",
    async ({ method, path, body }) => {
      const answer = await asAdmin(method, path, body);

      expect(answer.status, JSON.stringify(answer.body)).toBe(400);
      expect(answer.type).toContain("application/problem+json");
      expect(answer.body["detail"]).toBe("Validation failed (uuid is expected)");
      // The detail names what was expected, not what was sent. (`instance` is
      // the request path and carries it by definition.)
      expect(String(answer.body["detail"])).not.toContain(NOT_A_UUID);
    },
  );
});

describe("a query parameter given twice", () => {
  it.each(REPEATED_QUERIES)("%s answers a 400 problem document", async (path) => {
    const answer = await asAdmin("GET", path);

    expect(answer.status, JSON.stringify(answer.body)).toBe(400);
    expect(answer.type).toContain("application/problem+json");
    expect(String(answer.body["detail"])).toMatch(/must be given at most once/u);
  });

  it("still answers the same routes given each parameter once", async () => {
    for (const path of REPEATED_QUERIES) {
      const once = path.slice(0, path.lastIndexOf("&"));
      const answer = await asAdmin("GET", once);
      expect(answer.status, `${once}: ${JSON.stringify(answer.body)}`).toBe(200);
    }
  });
});
