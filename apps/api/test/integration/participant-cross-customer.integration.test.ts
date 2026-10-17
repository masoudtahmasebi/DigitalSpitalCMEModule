/**
 * One physician, two customers, and what each customer's administrator may do
 * to them (P247-01, closes SEC-1).
 *
 * ## The defect this file exists for
 *
 * A merge (P21-05) puts every membership and every credential of two people on
 * one person — and every local credential has the realm `ds:local`, so a merged
 * person could hold two. Customer A's administrator passed `isMember` for that
 * person, because they *are* a member of A, and the reset handed A's
 * administrator a password that signs in at B as well. The disable wrote
 * `learner_credentials.disabled_at`, which every customer's sign-in read, so A
 * could lock the physician out of B.
 *
 * ## Why it needs two customers and real HTTP
 *
 * Every property here is a boundary between two tenants, and RLS is what draws
 * it. One customer cannot show that a block stops at the boundary, and a mocked
 * repository answers whatever it is told (§9.13).
 *
 * Every fixture row is created through the customer it belongs to (§9.6): the
 * memberships, roles and projects name their customer explicitly, never a row
 * found by `LIMIT 1` over a shared table.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { createPool } from "@ds/postgres";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { hash as argonHash } from "@node-rs/argon2";
import { AppModule } from "../../src/app.module.js";
import { configureApp } from "../../src/configure-app.js";
import { loadConfig } from "../../src/config/config.js";
import { LOCAL_REALM } from "../../src/auth/local-identity-provider.js";
import { PARTICIPANT_COOKIE } from "../../src/auth/participant-cookie.js";
import { requireEnv } from "./support/env.js";

const SUPERUSER_URL = requireEnv("POSTGRES_SUPERUSER_URL");

process.env["KEYCLOAK_ISSUER"] ??= "http://127.0.0.1:1/realms/unused";
process.env["KEYCLOAK_AUDIENCE"] ??= "unused";
process.env["KEYCLOAK_JWKS_URI"] ??=
  "http://127.0.0.1:1/realms/unused/protocol/openid-connect/certs";
process.env["NODE_ENV"] ??= "test";
process.env["CERTIFICATE_DELIVERY_ENABLED"] = "no";
// Where a reset link points. From configuration, never from the request: the
// caller of this route is the console, and the link is for the portal (§9.5).
process.env["PORTAL_BASE_URL"] = "https://portal.example.test";

const OPERATOR_PASSWORD = `op-${randomUUID()}`;

let app: NestExpressApplication;
let baseUrl: string;
let pool: Pool;

interface Customer {
  readonly id: string;
  readonly projectSlug: string;
  readonly adminCookie: string;
}

let customerA: Customer;
let customerB: Customer;
let superCookie: string;

beforeAll(async () => {
  pool = createPool({ connectionString: SUPERUSER_URL });

  app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: false,
    bodyParser: false,
  });
  await configureApp(app, loadConfig());
  await app.listen(0);
  const address = app.getHttpServer().address();
  if (address === null || typeof address === "string") {
    throw new Error("expected the HTTP server to bind a TCP port");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;

  // A can send mail; B deliberately has no sender, so nothing here depends on
  // B's project being able to deliver anything.
  customerA = await seedCustomer("a", { sender: true });
  customerB = await seedCustomer("b", { sender: false });

  const superId = await createPerson(`super-${short()}@example.org`, OPERATOR_PASSWORD);
  await member(superId, customerA.id, "super_admin");
  superCookie = await signIn(
    customerA.projectSlug,
    await emailOf(superId),
    OPERATOR_PASSWORD,
  );
}, 60_000);

afterAll(async () => {
  await app?.close();
  await pool?.end();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const short = () => randomUUID().slice(0, 8);

async function one(sql: string, values: unknown[]): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(sql, values);
  const id = rows[0]?.id;
  if (id === undefined) throw new Error(`fixture returned no id:\n${sql}`);
  return id;
}

async function seedCustomer(
  label: string,
  options: { sender: boolean },
): Promise<Customer> {
  const suffix = `${label}-${short()}`;
  const id = await one("INSERT INTO customers (slug, name) VALUES ($1,$2) RETURNING id", [
    `xc-${suffix}`,
    `Kunde ${suffix}`,
  ]);
  const departmentId = await one(
    "INSERT INTO departments (customer_id, slug, name) VALUES ($1,'default','Default') RETURNING id",
    [id],
  );
  const projectSlug = `xc-${suffix}`;
  {
    await pool.query(
      `INSERT INTO projects (customer_id, department_id, slug, name, identity_provider,
                             smtp_host, smtp_port, smtp_from_address, smtp_from_name)
       VALUES ($1,$2,$3,$4,'local',$5,587,$6,'Portal')`,
      [
        id,
        departmentId,
        projectSlug,
        `Projekt ${suffix}`,
        options.sender ? "smtp.invalid.test" : null,
        options.sender ? "no-reply@invalid.test" : null,
      ],
    );
  }

  // Each customer's administrator is a member of that customer only, and
  // signs in through that customer's project.
  const adminId = await createPerson(`admin-${suffix}@example.org`, OPERATOR_PASSWORD);
  await member(adminId, id, "customer_admin");
  const adminCookie = await signIn(
    projectSlug,
    `admin-${suffix}@example.org`,
    OPERATOR_PASSWORD,
  );
  return { id, projectSlug, adminCookie };
}

async function createPerson(email: string, password: string): Promise<string> {
  const userId = await one(
    "INSERT INTO users (email, first_name, last_name) VALUES ($1,'Vor','Nach') RETURNING id",
    [email],
  );
  const identityId = await one(
    `INSERT INTO user_identities (user_id, provider, realm, subject)
     VALUES ($1,'local',$2,$3) RETURNING id`,
    [userId, LOCAL_REALM, email],
  );
  await pool.query(
    `INSERT INTO learner_credentials (user_identity_id, password_hash, must_change)
     VALUES ($1,$2,false)`,
    [identityId, await argonHash(password, { algorithm: 2 })],
  );
  return userId;
}

/** A membership and a grant at one named customer. */
async function member(userId: string, customerId: string, role: string): Promise<void> {
  await pool.query("INSERT INTO user_customers (user_id, customer_id) VALUES ($1,$2)", [
    userId,
    customerId,
  ]);
  await pool.query(
    "INSERT INTO user_roles (user_id, role, customer_id) VALUES ($1,$2,$3)",
    [userId, role, customerId],
  );
}

async function emailOf(userId: string): Promise<string> {
  const { rows } = await pool.query<{ email: string }>(
    "SELECT email FROM users WHERE id = $1",
    [userId],
  );
  return rows[0]!.email;
}

async function signInStatus(
  projectSlug: string,
  email: string,
  password: string,
): Promise<{ status: number; cookie: string | undefined }> {
  const response = await fetch(`${baseUrl}/auth/participant/sign-in`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-ds-project": projectSlug },
    body: JSON.stringify({ email, password }),
  });
  const cookie = response.headers
    .getSetCookie()
    .find((c) => c.startsWith(PARTICIPANT_COOKIE))
    ?.split(";")[0]
    ?.split("=")[1];
  return { status: response.status, cookie };
}

async function signIn(projectSlug: string, email: string, password: string) {
  const { status, cookie } = await signInStatus(projectSlug, email, password);
  if (cookie === undefined || cookie === "") {
    throw new Error(`sign-in failed for ${email}: ${String(status)}`);
  }
  return cookie;
}

function as(customer: { projectSlug: string }, cookie: string, init: RequestInit = {}) {
  return {
    ...init,
    headers: {
      ...init.headers,
      "content-type": "application/json",
      cookie: `${PARTICIPANT_COOKIE}=${cookie}`,
      "x-ds-project": customer.projectSlug,
    },
  };
}

/**
 * Two participants — one at A, one at B, each with their own password — merged
 * onto the B one by a super administrator, as P21-05 does.
 */
async function mergedAcrossCustomers(): Promise<{
  userId: string;
  email: string;
  passwordA: string;
  passwordB: string;
  droppedIdentityId: string;
}> {
  const passwordA = `pa-${randomUUID()}`;
  const passwordB = `pb-${randomUUID()}`;
  // B first, so that A's credential is the *newer* one: creation order would
  // keep A, and only `last_used_at` keeps B. Otherwise the test could not tell
  // the two orderings apart.
  const atB = await createPerson(`p-b-${short()}@example.org`, passwordB);
  await member(atB, customerB.id, "learner");
  const atA = await createPerson(`p-a-${short()}@example.org`, passwordA);
  await member(atA, customerA.id, "learner");

  // B's credential is the one the physician last used.
  await signIn(customerB.projectSlug, await emailOf(atB), passwordB);
  const { rows } = await pool.query<{ id: string }>(
    "SELECT id FROM user_identities WHERE user_id = $1 AND provider = 'local'",
    [atA],
  );

  const response = await fetch(
    `${baseUrl}/admin/participants/merge`,
    as(customerA, superCookie, {
      method: "POST",
      body: JSON.stringify({ sourceUserId: atA, targetUserId: atB, confirm: atB }),
    }),
  );
  expect(response.status, await response.clone().text()).toBe(204);

  return {
    userId: atB,
    email: await emailOf(atB),
    passwordA,
    passwordB,
    droppedIdentityId: rows[0]!.id,
  };
}

async function localHashes(userId: string): Promise<string[]> {
  const { rows } = await pool.query<{ password_hash: string }>(
    `SELECT c.password_hash FROM user_identities i
       JOIN learner_credentials c ON c.user_identity_id = i.id
      WHERE i.user_id = $1 AND i.provider = 'local' ORDER BY i.id`,
    [userId],
  );
  return rows.map((row) => row.password_hash);
}

async function openTokens(userId: string): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM learner_credential_tokens t
       JOIN user_identities i ON i.id = t.user_identity_id
      WHERE i.user_id = $1 AND t.accepted_at IS NULL AND t.revoked_at IS NULL`,
    [userId],
  );
  return Number(rows[0]?.n ?? "0");
}

function reset(customer: Customer, userId: string): Promise<Response> {
  return fetch(
    `${baseUrl}/admin/participants/${userId}/reset-password`,
    as(customer, customer.adminCookie, { method: "POST", body: "{}" }),
  );
}

// ---------------------------------------------------------------------------

describe("resetting a password shared with another customer", () => {
  it("a reset by A's admin returns no password and leaves the hash unchanged", async () => {
    const person = await mergedAcrossCustomers();
    const before = await localHashes(person.userId);

    const response = await reset(customerA, person.userId);
    const body = await response.text();

    expect(response.status, body).toBe(202);
    expect(body).toBe("");
    expect(body).not.toContain("temporaryPassword");
    expect(await localHashes(person.userId)).toEqual(before);
    // And the physician still signs in at B with the password they chose.
    expect(
      (await signInStatus(customerB.projectSlug, person.email, person.passwordB)).status,
    ).toBe(200);
  });

  it("mints a token only when the project is local and can send", async () => {
    // A: local, with a sender — a link is minted (and sent).
    const atA = await createPerson(`r-a-${short()}@example.org`, `x-${randomUUID()}`);
    await member(atA, customerA.id, "learner");
    const a = await reset(customerA, atA);
    expect(a.status).toBe(202);
    expect(await a.text()).toBe("");
    expect(await openTokens(atA)).toBe(1);

    // B: local, no sender. The same answer, and nothing a person could spend.
    const atB = await createPerson(`r-b-${short()}@example.org`, `x-${randomUUID()}`);
    await member(atB, customerB.id, "learner");
    const b = await reset(customerB, atB);
    expect(b.status).toBe(202);
    expect(await b.text()).toBe("");
    expect(await openTokens(atB)).toBe(0);

    // C: the project that *can* send signs in at Keycloak, and the local one
    // (through which C's administrator signs in) has no sender. A link minted
    // through the Keycloak project's sender would be a link to a password box
    // that project does not offer — so the same answer, and no token.
    const customerC = await seedCustomer("c", { sender: false });
    const { rows: dept } = await pool.query<{ id: string }>(
      "SELECT id FROM departments WHERE customer_id = $1",
      [customerC.id],
    );
    await pool.query(
      `INSERT INTO projects (customer_id, department_id, slug, name, identity_provider,
                             keycloak_issuer, keycloak_audience, keycloak_realm,
                             smtp_host, smtp_port, smtp_from_address)
       VALUES ($1,$2,$3,'KC','keycloak','https://kc.example.test/realms/x','x','x',
               'smtp.invalid.test',587,'no-reply@invalid.test')`,
      [customerC.id, dept[0]!.id, `xc-kc-${short()}`],
    );
    const atC = await createPerson(`r-c-${short()}@example.org`, `x-${randomUUID()}`);
    await member(atC, customerC.id, "learner");
    const c = await reset(customerC, atC);
    expect(c.status).toBe(202);
    expect(await c.text()).toBe("");
    expect(await openTokens(atC)).toBe(0);
  });
});

describe("disabling a person who learns with two customers", () => {
  it("a block at A does not reach B", async () => {
    const person = await mergedAcrossCustomers();

    const response = await fetch(
      `${baseUrl}/admin/participants/${person.userId}/disabled`,
      as(customerA, customerA.adminCookie, {
        method: "POST",
        body: JSON.stringify({ disabled: true }),
      }),
    );
    expect(response.status).toBe(204);

    expect(
      (await signInStatus(customerB.projectSlug, person.email, person.passwordB)).status,
    ).toBe(200);
    expect(
      (await signInStatus(customerA.projectSlug, person.email, person.passwordB)).status,
    ).toBe(401);
  });

  it("is shown as blocked at A and not at B", async () => {
    const person = await mergedAcrossCustomers();
    await fetch(
      `${baseUrl}/admin/participants/${person.userId}/disabled`,
      as(customerA, customerA.adminCookie, {
        method: "POST",
        body: JSON.stringify({ disabled: true }),
      }),
    );

    const listed = async (customer: Customer) => {
      const response = await fetch(
        `${baseUrl}/admin/participants?q=${encodeURIComponent(person.email)}`,
        as(customer, customer.adminCookie, { method: "GET" }),
      );
      const rows = (await response.json()) as {
        userId: string;
        credential?: { disabled: boolean } | null;
      }[];
      return rows.filter((row) => row.userId === person.userId);
    };

    const atA = await listed(customerA);
    const atB = await listed(customerB);
    // One row each, even for a person who once held two credentials.
    expect(atA).toHaveLength(1);
    expect(atB).toHaveLength(1);
    expect(atA[0]?.credential?.disabled).toBe(true);
    expect(atB[0]?.credential?.disabled).toBe(false);
  });
});

describe("a merge of two people with local credentials", () => {
  it("keeps one local credential, the most recently used", async () => {
    const person = await mergedAcrossCustomers();

    const { rows } = await pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM user_identities WHERE user_id = $1 AND provider = 'local'",
      [person.userId],
    );
    expect(Number(rows[0]?.n)).toBe(1);

    // The dropped password opens nothing, at either customer.
    for (const customer of [customerA, customerB]) {
      expect(
        (await signInStatus(customer.projectSlug, person.email, person.passwordA)).status,
      ).toBe(401);
      expect(
        (await signInStatus(customer.projectSlug, person.email, person.passwordB)).status,
      ).toBe(200);
    }

    // The audit row says which credential went, by id — never an address.
    const audit = await pool.query<{ detail: Record<string, unknown> }>(
      `SELECT detail FROM admin_audit_log
        WHERE action = 'participant.merge' AND subject_id = $1`,
      [person.userId],
    );
    expect(audit.rows[0]?.detail["droppedLocalIdentityIds"]).toEqual([
      person.droppedIdentityId,
    ]);
    expect(JSON.stringify(audit.rows[0]?.detail)).not.toContain("@");
  });
});
