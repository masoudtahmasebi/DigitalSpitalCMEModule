/**
 * The complete hierarchy (P12-04), against real Postgres and the staff plane.
 *
 * `Customer` is the level this suite exists for. It is the only one whose table
 * is RLS-scoped to a single tenant, which is why it had no endpoint at all
 * until now, and it is therefore the one where "does isolation actually hold"
 * cannot be answered by reading the code:
 *
 * - the registry list escapes RLS through a SECURITY DEFINER function, so the
 *   *authorisation* check in front of it is the only thing standing between a
 *   course editor and the names of every DigitalSpital customer;
 * - creating a customer does **not** escape RLS — it opens a tenant context on
 *   the new id and inserts — and the only way to be sure of that is to do it
 *   and then read the row back as somebody else;
 * - deleting anything above a leaf must be refused with the counts, and the
 *   database's `ON DELETE RESTRICT` must never be what the caller sees.
 *
 * The staff plane is driven with a real cookie and a real CSRF token, because
 * the capability check lives in `RolesGuard` and only exists on a request that
 * went through `AuthGuard`.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { hash } from "@node-rs/argon2";
import { totpCode } from "../../src/modules/staff/totp.js";
import { AppModule } from "../../src/app.module.js";
import { configureApp } from "../../src/configure-app.js";
import { loadConfig } from "../../src/config/config.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} must be set to run the integration suite.`);
  }
  return value;
}

const SUPERUSER_URL = requireEnv("POSTGRES_SUPERUSER_URL");

process.env["KEYCLOAK_ISSUER"] ??= "http://127.0.0.1:1/realms/unused";
process.env["KEYCLOAK_AUDIENCE"] ??= "unused";
process.env["KEYCLOAK_JWKS_URI"] ??=
  "http://127.0.0.1:1/realms/unused/protocol/openid-connect/certs";
process.env["NODE_ENV"] ??= "test";
process.env["EIV_WORKER_ENABLED"] = "no";
process.env["CERTIFICATE_DELIVERY_ENABLED"] = "no";

const RUN = randomUUID().slice(0, 8);
const PASSWORD = "ein hinreichend langes passwort";

let app: NestExpressApplication;
let baseUrl: string;
let seedPool: Pool;

/** A super admin: holds `customer`, so the registry is reachable. */
let superSession: StaffSession;
/** A customer admin: holds everything except `customer`. */
let tenantSession: StaffSession;

let existingCustomerId: string;

interface StaffSession {
  readonly cookie: string;
  readonly csrf: string;
}

beforeAll(async () => {
  seedPool = new Pool({ connectionString: SUPERUSER_URL });

  // One customer that already exists, with a department inside it, so the
  // deletion refusals have something real to refuse.
  existingCustomerId = await insert(
    "INSERT INTO customers (slug, name) VALUES ($1,$2) RETURNING id",
    [`hierarchy-${RUN}`, "Bestandskunde GmbH"],
  );
  await insert(
    "INSERT INTO departments (customer_id, slug, name) VALUES ($1,$2,$3) RETURNING id",
    [existingCustomerId, `abteilung-${RUN}`, "Abteilung"],
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

  superSession = await signIn(await seedStaff("super_admin", null));
  tenantSession = await signIn(await seedStaff("customer_admin", existingCustomerId));
}, 40_000);

afterAll(async () => {
  await app?.close();
  await seedPool.end();
});

async function insert(sql: string, values: unknown[]): Promise<string> {
  const { rows } = await seedPool.query<{ id: string }>(sql, values);
  const id = rows[0]?.id;
  if (id === undefined) throw new Error(`seed insert returned no id: ${sql}`);
  return id;
}

/**
 * A staff account with one grant.
 *
 * Argon2 with the default cost, because the login path verifies with the real
 * verifier and a cheaper hash would not be accepted by it.
 */
async function seedStaff(role: string, customerId: string | null): Promise<string> {
  const email = `${role}-${randomUUID().slice(0, 8)}@hierarchy.test`;
  const passwordHash = await hash(PASSWORD, { algorithm: 2 });
  const id = await insert(
    "INSERT INTO admin_users (email, display_name, password_hash) VALUES ($1,$2,$3) RETURNING id",
    [email, `Test ${role}`, passwordHash],
  );
  await seedPool.query(
    "INSERT INTO admin_user_roles (admin_user_id, role, customer_id) VALUES ($1,$2,$3)",
    [id, role, customerId],
  );
  return email;
}

/**
 * Sign in, completing the second factor when the account requires one.
 *
 * `super_admin` always does (`secondFactorStep`), which is the whole reason
 * this helper is more than one `fetch`: without enrolling, the only role that
 * can manage customers cannot log in at all, and every test below would be
 * asserting against a 401.
 */
async function signIn(email: string): Promise<StaffSession> {
  const first = await post("/admin/auth/login", { email, password: PASSWORD });
  const body = first.body as {
    status: string;
    csrfToken?: string;
    challenge?: string;
  };

  if (body.status === "signed_in") return sessionFrom(first.response, body.csrfToken);

  if (body.challenge === undefined) {
    throw new Error(`sign-in failed for ${email}: ${JSON.stringify(body)}`);
  }

  // Enrol if this is the first sign-in, then present a code either way.
  let secret: Buffer;
  if (body.status === "totp_enrolment_required") {
    const enrol = await post("/admin/auth/totp/enrol", { challenge: body.challenge });
    secret = secretFromUri((enrol.body as { otpauthUri: string }).otpauthUri);
  } else {
    throw new Error(`unexpected second-factor state: ${body.status}`);
  }

  const counter = Math.floor(Date.now() / 1000 / 30);
  const verified = await post("/admin/auth/totp/verify", {
    challenge: body.challenge,
    code: totpCode(secret, counter),
  });
  const verifiedBody = verified.body as { status: string; csrfToken?: string };
  if (verifiedBody.status !== "signed_in") {
    throw new Error(`TOTP failed for ${email}: ${JSON.stringify(verifiedBody)}`);
  }

  return sessionFrom(verified.response, verifiedBody.csrfToken);
}

async function post(
  path: string,
  body: unknown,
): Promise<{ response: Response; body: unknown }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() };
}

function sessionFrom(response: Response, csrf: string | undefined): StaffSession {
  const setCookie = response.headers.get("set-cookie");
  if (setCookie === null || csrf === undefined) {
    throw new Error("signed in without a cookie or CSRF token");
  }
  return { cookie: setCookie.split(";")[0] ?? "", csrf };
}

/** Pull the Base32 secret back out of the `otpauth://` URI and decode it. */
function secretFromUri(uri: string): Buffer {
  const encoded = new URL(uri).searchParams.get("secret");
  if (encoded === null) throw new Error("otpauth URI carried no secret");

  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const character of encoded) {
    value = (value << 5) | alphabet.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

async function asStaff(
  session: StaffSession,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      cookie: session.cookie,
      "x-ds-csrf": session.csrf,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  const text = await response.text();
  return { status: response.status, body: text === "" ? undefined : JSON.parse(text) };
}

// ---------------------------------------------------------------------------

describe("who may reach the customer registry", () => {
  it("lets a super admin list customers", async () => {
    const { status, body } = await asStaff(superSession, "GET", "/admin/customers");

    expect(status).toBe(200);
    expect(body.some((c: { slug: string }) => c.slug === `hierarchy-${RUN}`)).toBe(true);
  });

  it("refuses a customer administrator, who holds every capability but this one", async () => {
    // The sharp case. This operator is a legitimate, fully authenticated
    // administrator of their own customer — and the registry spans customers,
    // so it is not theirs to see. A `@StaffOnly()` route would have let them in.
    const { status } = await asStaff(tenantSession, "GET", "/admin/customers");

    expect(status).toBe(403);
  });

  it("refuses them by slug too, so an id cannot be probed", async () => {
    // 403 and not 404: a 404 for an unknown slug and a 403 for a known one
    // would confirm which customers exist, one guess at a time.
    const { status } = await asStaff(
      tenantSession,
      "GET",
      `/admin/customers/hierarchy-${RUN}`,
    );

    expect(status).toBe(403);
  });

  it("refuses a request with no staff session at all", async () => {
    const response = await fetch(`${baseUrl}/admin/customers`);
    expect(response.status).toBe(401);
  });

  it("refuses a write with a session but no CSRF token", async () => {
    const response = await fetch(`${baseUrl}/admin/customers`, {
      method: "POST",
      headers: { cookie: superSession.cookie, "content-type": "application/json" },
      body: JSON.stringify({ slug: `csrf-${RUN}`, name: "Nie erstellt" }),
    });

    expect(response.status).toBe(403);
  });
});

describe("creating a customer", () => {
  const slug = () => `neu-${RUN}`;

  it("creates one and returns it with empty counts", async () => {
    const { status, body } = await asStaff(superSession, "POST", "/admin/customers", {
      slug: slug(),
      name: "Neukunde AG",
    });

    expect(status).toBe(201);
    expect(body).toMatchObject({
      slug: slug(),
      name: "Neukunde AG",
      departmentCount: 0,
      projectCount: 0,
      courseCount: 0,
    });
  });

  it("wrote a row that is genuinely RLS-scoped, not an exempt one", async () => {
    // The property that matters: creation opened a tenant context on the new
    // id rather than bypassing the policy. If it had bypassed, this read with
    // a *different* customer set would still return the row.
    const client = await seedPool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE ds_app");
      await client.query("SELECT set_config('app.customer_id', $1, true)", [
        existingCustomerId,
      ]);
      const { rows } = await client.query("SELECT slug FROM customers WHERE slug = $1", [
        slug(),
      ]);
      expect(rows).toEqual([]);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
  });

  it("refuses a duplicate slug rather than shadowing the first customer", async () => {
    const { status } = await asStaff(superSession, "POST", "/admin/customers", {
      slug: slug(),
      name: "Noch einmal",
    });

    expect(status).toBe(409);
  });

  it("refuses a slug the grammar does not allow", async () => {
    const { status } = await asStaff(superSession, "POST", "/admin/customers", {
      slug: "Nicht Erlaubt",
      name: "Ungültig",
    });

    expect(status).toBe(422);
  });

  it("refuses creation by a customer administrator", async () => {
    // A customer is the tenant boundary; nobody inside one may mint another.
    const { status } = await asStaff(tenantSession, "POST", "/admin/customers", {
      slug: `verboten-${RUN}`,
      name: "Verboten",
    });

    expect(status).toBe(403);
  });
});

describe("renaming a customer", () => {
  it("changes the name and leaves the slug alone", async () => {
    const { status, body } = await asStaff(
      superSession,
      "PATCH",
      `/admin/customers/neu-${RUN}`,
      { name: "Neukunde SE" },
    );

    expect(status).toBe(200);
    expect(body).toMatchObject({ slug: `neu-${RUN}`, name: "Neukunde SE" });
  });

  it("ignores an attempt to re-slug through the same call", async () => {
    // The slug is what links, bookmarks and runbooks refer to. Renaming it
    // through the PATCH that fixes a typo in a company name is how those break
    // with nothing in the audit trail to explain it.
    const { status, body } = await asStaff(
      superSession,
      "PATCH",
      `/admin/customers/neu-${RUN}`,
      { name: "Neukunde SE", slug: "heimlich-umbenannt" },
    );

    expect(status).toBe(200);
    expect(body.slug).toBe(`neu-${RUN}`);
  });
});

describe("deleting a customer", () => {
  it("deletes an empty one", async () => {
    const { status } = await asStaff(
      superSession,
      "DELETE",
      `/admin/customers/neu-${RUN}`,
    );

    expect(status).toBe(204);
  });

  it("is gone from the registry afterwards", async () => {
    const { body } = await asStaff(superSession, "GET", "/admin/customers");
    expect(body.some((c: { slug: string }) => c.slug === `neu-${RUN}`)).toBe(false);
  });

  it("refuses a customer that still contains something, and names what", async () => {
    // Never a foreign-key error and never a cascade. The counts are the point:
    // a bare "cannot delete" sends somebody hunting through six levels.
    const { status, body } = await asStaff(
      superSession,
      "DELETE",
      `/admin/customers/hierarchy-${RUN}`,
    );

    expect(status).toBe(409);
    expect(body.detail).toContain("1 Abteilungen");
  });

  it("left the customer intact after the refusal", async () => {
    const { status } = await asStaff(
      superSession,
      "GET",
      `/admin/customers/hierarchy-${RUN}`,
    );

    expect(status).toBe(200);
  });

  it("404s an unknown slug for somebody who may see the registry", async () => {
    const { status } = await asStaff(
      superSession,
      "DELETE",
      `/admin/customers/gibt-es-nicht-${RUN}`,
    );

    expect(status).toBe(404);
  });
});

describe("the second factor cannot be stepped around", () => {
  /**
   * The regression test for the bypass migration 0022 closes.
   *
   * `login` hands back a challenge token when an account owes a second factor.
   * That token used to be a row in `admin_sessions` indistinguishable from a
   * real session, and CSRF is only checked on unsafe methods — so putting it in
   * the cookie jar authenticated every `GET` in the admin API. The second
   * factor could be skipped using the token the server gives you for not having
   * passed it.
   */
  it("refuses a challenge token presented as a session cookie", async () => {
    const email = await seedStaff("super_admin", null);
    const { body } = await post("/admin/auth/login", { email, password: PASSWORD });
    const challenge = (body as { challenge?: string }).challenge;
    expect(challenge).toBeDefined();

    const response = await fetch(`${baseUrl}/admin/auth/session`, {
      headers: { cookie: `ds_staff_session=${challenge ?? ""}` },
    });

    expect(response.status).toBe(401);
  });

  it("refuses a challenge that has already been spent", async () => {
    const email = await seedStaff("super_admin", null);
    const { body } = await post("/admin/auth/login", { email, password: PASSWORD });
    const challenge = (body as { challenge: string }).challenge;

    const enrol = await post("/admin/auth/totp/enrol", { challenge });
    const secret = secretFromUri((enrol.body as { otpauthUri: string }).otpauthUri);
    const code = totpCode(secret, Math.floor(Date.now() / 1000 / 30));

    const first = await post("/admin/auth/totp/verify", { challenge, code });
    expect((first.body as { status: string }).status).toBe("signed_in");

    // Single-use. A challenge that survived its first use would let somebody
    // walk the six-digit space against it at leisure.
    const second = await post("/admin/auth/totp/verify", { challenge, code });
    expect(second.response.status).toBe(401);
  });

  it("refuses a code that was already accepted, even within its own step", async () => {
    const email = await seedStaff("super_admin", null);

    // Enrol, which spends one counter.
    const first = await post("/admin/auth/login", { email, password: PASSWORD });
    const challenge = (first.body as { challenge: string }).challenge;
    const enrol = await post("/admin/auth/totp/enrol", { challenge });
    const secret = secretFromUri((enrol.body as { otpauthUri: string }).otpauthUri);
    const counter = Math.floor(Date.now() / 1000 / 30);
    await post("/admin/auth/totp/verify", { challenge, code: totpCode(secret, counter) });

    // A fresh challenge, the same code. Arithmetically valid for another few
    // seconds, and refused because that counter is spent.
    const second = await post("/admin/auth/login", { email, password: PASSWORD });
    const nextChallenge = (second.body as { challenge: string }).challenge;
    const replay = await post("/admin/auth/totp/verify", {
      challenge: nextChallenge,
      code: totpCode(secret, counter),
    });

    expect(replay.response.status).toBe(401);
  });

  it("refuses a code from outside the drift window", async () => {
    const email = await seedStaff("super_admin", null);
    const { body } = await post("/admin/auth/login", { email, password: PASSWORD });
    const challenge = (body as { challenge: string }).challenge;
    const enrol = await post("/admin/auth/totp/enrol", { challenge });
    const secret = secretFromUri((enrol.body as { otpauthUri: string }).otpauthUri);

    const stale = totpCode(secret, Math.floor(Date.now() / 1000 / 30) - 5);
    const { response } = await post("/admin/auth/totp/verify", {
      challenge,
      code: stale,
    });

    expect(response.status).toBe(401);
  });

  it("does not enrol an account whose code never arrived", async () => {
    // The secret is staged, not enrolled, until a code proves the app has it —
    // otherwise a failed scan locks the operator out with no way back that does
    // not involve database access.
    const email = await seedStaff("super_admin", null);
    const { body } = await post("/admin/auth/login", { email, password: PASSWORD });
    await post("/admin/auth/totp/enrol", {
      challenge: (body as { challenge: string }).challenge,
    });

    const { rows } = await seedPool.query<{ totp_enrolled_at: Date | null }>(
      "SELECT totp_enrolled_at FROM admin_users WHERE email = $1",
      [email],
    );
    expect(rows[0]?.totp_enrolled_at).toBeNull();
  });

  it("never stores the TOTP secret in plaintext", async () => {
    // CLAUDE.md §4 invariant 7. The secret is a credential like any other.
    const email = await seedStaff("super_admin", null);
    const { body } = await post("/admin/auth/login", { email, password: PASSWORD });
    const challenge = (body as { challenge: string }).challenge;
    const enrol = await post("/admin/auth/totp/enrol", { challenge });
    const secret = secretFromUri((enrol.body as { otpauthUri: string }).otpauthUri);

    const { rows } = await seedPool.query<{ totp_secret_enc: Buffer }>(
      "SELECT totp_secret_enc FROM admin_users WHERE email = $1",
      [email],
    );
    const stored = rows[0]?.totp_secret_enc;
    expect(stored).toBeDefined();
    expect(stored?.includes(secret)).toBe(false);
  });
});
