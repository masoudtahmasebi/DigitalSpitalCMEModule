/**
 * Every tenant-scoped admin route refuses a caller who names no tenant, or
 * names one they hold no grant for (P135-01, QA audit §1.1).
 *
 * ## The question this answers, and why per-route
 *
 * The tenant guard exists and `tenant-isolation.integration.test.ts` proves it
 * at the database: RLS matches nothing without `app.customer_id`, and a
 * cross-tenant insert is refused by the policy rather than by application code.
 * That is the invariant, and it holds.
 *
 * It is not the same question as *"does every route reach that invariant"*.
 * CLAUDE.md §9.2's recurring shape is a guard that covers a subset of what it
 * claims and produces confusing UI rather than a refusal on the rest — and
 * §9.6's is worse, because under RLS a missing tenant context returns **zero
 * rows**, which a repository can render as "nothing configured" with a 200.
 * Neither shows up in a suite that tests one route at a time with a correct
 * header.
 *
 * So this sweeps the contract: every operation the contract marks tenant-scoped
 * is called twice with a real, valid staff session and a wrong tenant claim.
 * Adding a route to the contract adds it here.
 *
 * ## What "refuses" means, precisely
 *
 * * never `2xx` — a tenant-scoped answer with no tenant is either somebody
 *   else's data or an empty shape that reads as "not configured";
 * * never `5xx` — the caller's mistake reported as ours, and the shape that
 *   leaves nothing to act on;
 * * `problem+json` with a `detail` a person could read, because the failure the
 *   client reported this year was *"this route is tenant-scoped and no
 *   X-DS-Project header was sent (Referenz: e06b7eb6-…)"* on an operator's
 *   screen (§9.4).
 */

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { createPool } from "@ds/postgres";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { hash } from "@node-rs/argon2";
import { AppModule } from "../../src/app.module.js";
import { configureApp } from "../../src/configure-app.js";
import { loadConfig } from "../../src/config/config.js";
import { requireEnv } from "./support/env.js";
import { signInStaff, type StaffSession } from "./support/staff-session.js";

/*
 * The **superuser**, not `DATABASE_URL`. `ds_app` is deliberately not
 * BYPASSRLS, so seeding two customers through it is refused by the very policy
 * this suite exists to check — which is the isolation working, and the wrong
 * tool for arranging a fixture.
 */
const SUPERUSER_URL = requireEnv("POSTGRES_SUPERUSER_URL");
const PASSWORD = "tenant-header-suite-password";
const RUN = randomUUID().slice(0, 8);

let app: NestExpressApplication;
let pool: Pool;
let baseUrl: string;
let session: StaffSession;
/** The customer this operator administers. */
let ownCustomerId: string;
/** A customer they hold no grant for at all. */
let foreignCustomerId: string;

interface Operation {
  readonly method: "get" | "post" | "put" | "patch" | "delete";
  readonly path: string;
}

/**
 * The contract's tenant-scoped admin operations.
 *
 * Read as text for the same reason `routes.spec.ts` does: indentation is the
 * grammar, prettier enforces the shape on every commit, and the alternative is
 * a YAML parser in a suite that needs one file. An operation counts when its
 * own parameter list references `ProjectHeader` — which is how the contract
 * says "this route is about one tenant".
 */
function tenantScopedAdminOperations(): Operation[] {
  const yaml = readFileSync(
    fileURLToPath(new URL("../../../../contracts/openapi.yaml", import.meta.url)),
    "utf8",
  );

  const found: Operation[] = [];
  let path: string | undefined;
  let method: Operation["method"] | undefined;
  let sawProjectHeader = false;

  const flush = () => {
    if (path !== undefined && method !== undefined && sawProjectHeader) {
      found.push({ method, path });
    }
  };

  for (const line of yaml.split("\n")) {
    const pathMatch = /^ {2}(\/[^\s:]*):/u.exec(line);
    if (pathMatch?.[1] !== undefined) {
      flush();
      path = pathMatch[1];
      method = undefined;
      sawProjectHeader = false;
      continue;
    }
    const methodMatch = /^ {4}(get|post|put|patch|delete):/u.exec(line);
    if (methodMatch?.[1] !== undefined) {
      flush();
      method = methodMatch[1] as Operation["method"];
      sawProjectHeader = false;
      continue;
    }
    if (line.includes("ProjectHeader")) sawProjectHeader = true;
  }
  flush();

  return found.filter((operation) => operation.path.startsWith("/admin"));
}

/** Path parameters filled with something well-formed and certainly absent. */
function concrete(path: string): string {
  return path
    .replace(/\{[^}]*[Ii]d\}/gu, "00000000-0000-4000-8000-000000000000")
    .replace(/\{[^}]*\}/gu, "does-not-exist-tenant-sweep");
}

const OPERATIONS = tenantScopedAdminOperations();

async function insert(sql: string, values: unknown[]): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(sql, values);
  const id = rows[0]?.id;
  if (id === undefined) throw new Error(`seed insert returned no id: ${sql}`);
  return id;
}

beforeAll(async () => {
  pool = createPool({ connectionString: SUPERUSER_URL });

  ownCustomerId = await insert(
    "INSERT INTO customers (slug, name) VALUES ($1,$2) RETURNING id",
    [`tenant-own-${RUN}`, "Eigener Kunde"],
  );
  foreignCustomerId = await insert(
    "INSERT INTO customers (slug, name) VALUES ($1,$2) RETURNING id",
    [`tenant-foreign-${RUN}`, "Fremder Kunde"],
  );

  const email = `tenant-sweep-${RUN}@guards.test`;
  const passwordHash = await hash(PASSWORD, { algorithm: 2 });
  const adminId = await insert(
    "INSERT INTO admin_users (email, display_name, password_hash) VALUES ($1,$2,$3) RETURNING id",
    [email, "Tenant Sweep", passwordHash],
  );
  await pool.query(
    "INSERT INTO admin_user_roles (admin_user_id, role, customer_id) VALUES ($1,$2,$3)",
    [adminId, "customer_admin", ownCustomerId],
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

  session = await signInStaff({ baseUrl, email, password: PASSWORD });
}, 60_000);

afterAll(async () => {
  await app?.close();
  await pool?.end();
});

async function callWith(
  operation: Operation,
  headers: Record<string, string>,
): Promise<{ status: number; contentType: string; body: string }> {
  // The body is spread in rather than set to `undefined`: under
  // `exactOptionalPropertyTypes` an explicit `undefined` is not the same as an
  // absent property, and GET with a body is not a request at all.
  const sendsBody = operation.method !== "get" && operation.method !== "delete";

  const response = await fetch(`${baseUrl}${concrete(operation.path)}`, {
    method: operation.method.toUpperCase(),
    headers: {
      cookie: session.cookie,
      "x-ds-csrf": session.csrf,
      "content-type": "application/json",
      ...headers,
    },
    // Enough to get past body validation to the guard, which is what is probed.
    ...(sendsBody ? { body: "{}" } : {}),
  });

  return {
    status: response.status,
    contentType: response.headers.get("content-type") ?? "",
    body: await response.text(),
  };
}

describe("a tenant-scoped admin route, with a valid session and no tenant named", () => {
  it("has tenant-scoped admin routes to sweep at all", () => {
    // The check that stops the two below passing by covering nothing — the
    // parser reads indentation, and a reformat that broke it would otherwise
    // turn this whole file green (§9.1).
    expect(OPERATIONS.length).toBeGreaterThan(15);
  });

  it("never serves one, and never fails as our error", async () => {
    const served: string[] = [];
    const errored: string[] = [];

    for (const operation of OPERATIONS) {
      const label = `${operation.method.toUpperCase()} ${operation.path}`;
      const result = await callWith(operation, {});

      if (result.status < 400) served.push(`${label} → ${result.status}`);
      if (result.status >= 500) errored.push(`${label} → ${result.status}`);
    }

    expect(
      served,
      "a tenant-scoped route answered a caller who named no tenant. Under RLS " +
        "that answer is an empty shape, which reads as 'nothing configured'",
    ).toEqual([]);
    expect(
      errored,
      "the caller's missing header reported as our internal error, which " +
        "leaves them nothing to act on",
    ).toEqual([]);
  }, 120_000);

  it("answers in problem-details with something a person can read", async () => {
    /*
     * §9.4. The client's report was a developer sentence and a correlation id
     * on an operator's screen. The status being right is not the whole of it —
     * what the console renders comes from `detail`.
     */
    const opaque: string[] = [];

    for (const operation of OPERATIONS) {
      const result = await callWith(operation, {});
      const label = `${operation.method.toUpperCase()} ${operation.path}`;

      if (!result.contentType.includes("problem+json")) {
        opaque.push(`${label} → ${result.contentType || "no content-type"}`);
        continue;
      }
      const problem = JSON.parse(result.body) as { detail?: unknown; title?: unknown };
      if (typeof problem.detail !== "string" && typeof problem.title !== "string") {
        opaque.push(`${label} → neither detail nor title`);
      }
    }

    expect(opaque, "refused without saying anything the caller can act on").toEqual([]);
  }, 120_000);
});

describe("a tenant-scoped admin route, with a tenant the operator does not hold", () => {
  it("never serves one", async () => {
    /*
     * The sharper half of §1.1. The header is well-formed and names a customer
     * that genuinely exists — so nothing here is a validation failure. The only
     * thing standing between this operator and another company's data is the
     * grant check, which is the thing being asserted.
     */
    const served: string[] = [];
    const errored: string[] = [];

    for (const operation of OPERATIONS) {
      const label = `${operation.method.toUpperCase()} ${operation.path}`;
      const result = await callWith(operation, { "x-ds-customer": foreignCustomerId });

      if (result.status < 400) served.push(`${label} → ${result.status}`);
      if (result.status >= 500) errored.push(`${label} → ${result.status}`);
    }

    expect(served, "an operator reached a customer they hold no grant for").toEqual([]);
    expect(errored, "a foreign tenant claim produced a 5xx").toEqual([]);
  }, 120_000);

  it("proves the same session works when it names its own customer", async () => {
    /*
     * The control, and it is what makes the three assertions above evidence
     * rather than a session that was broken all along (§9.1). Without it every
     * route could be refusing for the wrong reason and the sweep would be
     * green.
     */
    const result = await callWith(
      { method: "get", path: "/admin/courses" },
      { "x-ds-customer": ownCustomerId },
    );

    expect(result.status, result.body).toBe(200);
  });
});
