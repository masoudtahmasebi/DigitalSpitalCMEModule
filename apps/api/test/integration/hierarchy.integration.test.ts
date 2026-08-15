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
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { createPool } from "@ds/postgres";
import Redis from "ioredis";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { hash } from "@node-rs/argon2";
import { totpCode } from "../../src/modules/staff/totp.js";
import { AppModule } from "../../src/app.module.js";
import { configureApp } from "../../src/configure-app.js";
import { loadConfig } from "../../src/config/config.js";
import { requireEnv } from "./support/env.js";

const SUPERUSER_URL = requireEnv("POSTGRES_SUPERUSER_URL");

process.env["KEYCLOAK_ISSUER"] ??= "http://127.0.0.1:1/realms/unused";
process.env["KEYCLOAK_AUDIENCE"] ??= "unused";
process.env["KEYCLOAK_JWKS_URI"] ??=
  "http://127.0.0.1:1/realms/unused/protocol/openid-connect/certs";
process.env["NODE_ENV"] ??= "test";
process.env["EIV_WORKER_ENABLED"] = "no";
/*
 * A real key, so `createSecretCipher` builds AES-GCM rather than falling back
 * to `PlaintextSecretCipher` (P40-01).
 *
 * Without it the platform SMTP password would be stored as itself, and the
 * test asserting it is *not* would have been asserting the fallback rather
 * than the encryption. Exactly 32 bytes — `AesGcmSecretCipher` refuses to
 * construct otherwise, and the failure surfaces as an unreadable stack trace
 * out of Nest's initialisation.
 */
process.env["SECRETS_KMS_KEY"] ??= Buffer.alloc(
  32,
  "ds-hierarchy-kms-key-not-secret",
).toString("base64");
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
  seedPool = createPool({ connectionString: SUPERUSER_URL });

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
async function signIn(email: string, knownSecret?: Buffer): Promise<StaffSession> {
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

  // Enrol if this is the first sign-in, then present a code either way. An
  // account that is *already* enrolled needs the secret it enrolled with, which
  // only the caller knows — so `knownSecret` is how the P22-02 tests sign the
  // same account in twice under changing policy.
  let secret: Buffer;
  if (body.status === "totp_enrolment_required") {
    const enrol = await post("/admin/auth/totp/enrol", { challenge: body.challenge });
    secret = secretFromUri((enrol.body as { otpauthUri: string }).otpauthUri);
  } else if (body.status === "totp_required" && knownSecret !== undefined) {
    secret = knownSecret;
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
  // Named, not positional: the response now carries two `Set-Cookie` headers,
  // and taking the first one would sometimes send the CSRF cookie as the
  // session and 401.
  const session = cookieNamed(response, "ds_staff_session");
  if (session === undefined || csrf === undefined) {
    throw new Error("signed in without a cookie or CSRF token");
  }
  return { cookie: `ds_staff_session=${session}`, csrf };
}

/**
 * Every `Set-Cookie` on a response, as separate strings.
 *
 * `headers.get("set-cookie")` joins them with ", " and a cookie's own
 * attributes contain commas, so splitting that back apart is guesswork.
 * `getSetCookie()` exists for exactly this and is what the runtime gives us.
 */
function setCookies(response: Response): readonly string[] {
  return response.headers.getSetCookie();
}

function cookieNamed(response: Response, name: string): string | undefined {
  const pair = setCookies(response)
    .map((raw) => raw.split(";")[0] ?? "")
    .find((part) => part.startsWith(`${name}=`));
  return pair?.slice(name.length + 1);
}

function attributesOf(response: Response, name: string): string | undefined {
  return setCookies(response).find((raw) => raw.startsWith(`${name}=`));
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
  return asStaffIn(session, undefined, method, path, body);
}

/**
 * The same, naming a project — which is what every tenant-scoped console screen
 * does, and what `asStaff` deliberately does not.
 */
async function asStaffIn(
  session: StaffSession,
  projectSlug: string | undefined,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      cookie: session.cookie,
      "x-ds-csrf": session.csrf,
      ...(projectSlug === undefined ? {} : { "x-ds-project": projectSlug }),
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

/** Long enough for `checkPassword`, and containing no account identifier. */
const STAFF_PASSWORD = "Sommerregen-Iserlohn-2026";
const PASSWORD_ACCOUNT_EMAIL = `mit-passwort-${RUN}@ds.test`;

describe("operator accounts", () => {
  /**
   * The check that matters. A `customer_admin` legitimately manages operators
   * *in their own customer*; `canGrant` is what keeps them away from a super
   * administrator, whose account is above them and whose scope they cannot
   * reach. Capability alone would not — both roles hold `staff_user`.
   */
  it("lets a super admin invite a customer administrator", async () => {
    const { status, body } = await asStaff(superSession, "POST", "/admin/staff", {
      email: `invited-${RUN}@ds.test`,
      displayName: "Eingeladene Person",
      role: "customer_admin",
      customerId: existingCustomerId,
      departmentId: null,
    });

    expect(status).toBe(201);
    expect(body.token).toEqual(expect.any(String));
    // Not sent: this suite configures no platform sender, and the invitation
    // still has to come back so it can be handed over (P40-05).
    expect(body.delivered).toBe(false);
  });

  it("creates the account without a password, so the invitation is not a credential", async () => {
    const { rows } = await seedPool.query<{ password_hash: string | null }>(
      "SELECT password_hash FROM admin_users WHERE email = $1",
      [`invited-${RUN}@ds.test`],
    );
    expect(rows[0]?.password_hash).toBeNull();
  });

  /*
   * Create with a password, and change one (P64-01).
   *
   * The whole reason this exists: an operator account could only be created by
   * invitation, and its password could only be changed by the operator via a
   * mail the platform might not be able to send. Both cases below were
   * impossible, and both were asked for by name.
   *
   * **One** account is created across these four cases, on purpose.
   * `POST /admin/staff` is on the `customerCreate` limiter, and a suite that
   * spends the bucket makes *later, unrelated* tests fail with 429 — which is
   * how the first version of this block presented, and is a worse failure than
   * the one it was testing for.
   */
  it("creates an account with a password, mints no token, and stores a hash", async () => {
    const { status, body } = await asStaff(superSession, "POST", "/admin/staff", {
      email: PASSWORD_ACCOUNT_EMAIL,
      displayName: "Mit Passwort",
      role: "customer_admin",
      customerId: existingCustomerId,
      departmentId: null,
      password: STAFF_PASSWORD,
    });

    expect(status).toBe(201);
    expect(body.status).toBe("created");
    // The assertion that separates this from the invitation path: no link,
    // because there is nothing to redeem.
    expect(body.token).toBeNull();

    const { rows } = await seedPool.query<{ hash: string | null; live: string }>(
      `SELECT u.password_hash AS hash,
              (SELECT count(*) FROM admin_credential_tokens t
                WHERE t.admin_user_id = u.id
                  AND t.accepted_at IS NULL AND t.revoked_at IS NULL)::text AS live
         FROM admin_users u WHERE u.email = $1`,
      [PASSWORD_ACCOUNT_EMAIL],
    );
    expect(rows[0]?.hash).toEqual(expect.any(String));
    // No live invitation either: a token beside a password is a second
    // credential for the same account.
    expect(rows[0]?.live).toBe("0");
  });

  it("changes that password, and the stored hash moves", async () => {
    const before = await seedPool.query<{ id: string; hash: string }>(
      "SELECT id, password_hash AS hash FROM admin_users WHERE email = $1",
      [PASSWORD_ACCOUNT_EMAIL],
    );
    const id = before.rows[0]?.id ?? "";

    const changed = await asStaff(superSession, "POST", `/admin/staff/${id}/password`, {
      password: `${STAFF_PASSWORD}-zwei`,
    });
    expect(changed.status).toBe(204);

    const after = await seedPool.query<{ hash: string }>(
      "SELECT password_hash AS hash FROM admin_users WHERE id = $1",
      [id],
    );
    expect(after.rows[0]?.hash).not.toBe(before.rows[0]?.hash);
  });

  it("refuses a password the policy rejects, naming the rule and not the value", async () => {
    const { rows } = await seedPool.query<{ id: string }>(
      "SELECT id FROM admin_users WHERE email = $1",
      [PASSWORD_ACCOUNT_EMAIL],
    );

    const { status, body } = await asStaff(
      superSession,
      "POST",
      `/admin/staff/${rows[0]?.id ?? ""}/password`,
      { password: "geheim" },
    );

    expect(status).toBe(422);
    expect(body.detail).toContain("zu kurz");
    /*
     * §9.5: an error names invalid fields, never their contents.
     *
     * The value here is deliberately not a German word from the message. The
     * first version of this test rejected `"kurz"` and asserted the body did
     * not contain `"kurz"` — which the correct message *does*, in "zu kurz". A
     * test that cannot distinguish the rejected value from the rule's own name
     * is not testing the rule.
     */
    expect(JSON.stringify(body)).not.toContain("geheim");
  });

  it("refuses a customer administrator setting a super administrator's password", async () => {
    /*
     * The escalation this must not permit, and the reason the check is
     * `canGrant` rather than the `staff_user` capability: setting a password is
     * being able to sign in as that account, so a customer administrator who
     * could do it to a super administrator would own the platform.
     */
    const { rows } = await seedPool.query<{ id: string }>(
      `SELECT u.id FROM admin_users u
         JOIN admin_user_roles r ON r.admin_user_id = u.id
        WHERE r.role = 'super_admin' LIMIT 1`,
    );

    const { status } = await asStaff(
      tenantSession,
      "POST",
      `/admin/staff/${rows[0]?.id ?? ""}/password`,
      { password: `${STAFF_PASSWORD}-drei` },
    );
    expect(status).toBe(403);
  });

  it("refuses a customer administrator inviting a super administrator", async () => {
    // Upward. `canGrant` refuses on rank before it ever looks at scope.
    const { status } = await asStaff(tenantSession, "POST", "/admin/staff", {
      email: `eskalation-${RUN}@ds.test`,
      displayName: "Zu weit",
      role: "super_admin",
      customerId: null,
      departmentId: null,
    });

    expect(status).toBe(403);
  });

  it("refuses a customer administrator disabling a super administrator", async () => {
    const { rows } = await seedPool.query<{ id: string }>(
      `SELECT u.id FROM admin_users u
         JOIN admin_user_roles r ON r.admin_user_id = u.id
        WHERE r.role = 'super_admin' LIMIT 1`,
    );
    const superAdminId = rows[0]?.id ?? "";

    const { status } = await asStaff(
      tenantSession,
      "POST",
      `/admin/staff/${superAdminId}/disabled`,
      { disabled: true },
    );

    expect(status).toBe(403);
  });

  it("does not show a customer administrator the accounts above them", async () => {
    const { status, body } = await asStaff(tenantSession, "GET", "/admin/staff");

    expect(status).toBe(200);
    const roles = body.flatMap((account: { grants: { role: string }[] }) =>
      account.grants.map((grant) => grant.role),
    );
    expect(roles).not.toContain("super_admin");
  });

  it("refuses to let an operator disable themselves", async () => {
    // Not a permission question — a footgun. There is no legitimate reason to
    // lock yourself out of the console.
    const { body: profile } = await asStaff(superSession, "GET", "/admin/auth/session");
    const { status } = await asStaff(
      superSession,
      "POST",
      `/admin/staff/${profile.profile.id}/disabled`,
      { disabled: true },
    );

    expect(status).toBe(403);
  });

  it("signs an account out of every browser at once", async () => {
    const { rows } = await seedPool.query<{ id: string }>(
      "SELECT id FROM admin_users WHERE email = $1",
      [`invited-${RUN}@ds.test`],
    );
    const invitedId = rows[0]?.id ?? "";

    const { status } = await asStaff(
      superSession,
      "POST",
      `/admin/staff/${invitedId}/sign-out-everywhere`,
    );
    expect(status).toBe(204);
  });
});

/**
 * The console's tenant screens, on a project that has no Keycloak binding
 * (P22-01).
 *
 * ## What this reproduces
 *
 * A super administrator signs in, `GET /admin/customers` succeeds — and
 * `GET /admin/courses` answers **401 Unauthenticated**. Reported from a live
 * deployment, and it reads as "the login did not work" when the session is
 * perfectly fine.
 *
 * The cause is that `authenticateStaffPlane` resolved the project through
 * `resolve_project_binding`, which returns nothing when `keycloak_issuer` or
 * `keycloak_audience` is NULL — deliberately, because a project with no binding
 * cannot authenticate a *learner*. But the staff plane needs exactly one field
 * out of that lookup, `customer_id`, and needs none of the Keycloak ones: a
 * staff session is local to the platform and never touches an IdP (ADR-0012).
 *
 * So a project created through the console — where the Keycloak fields are
 * optional, because they belong to the learner plane and may legitimately be
 * filled in later — locked every operator out of every tenant screen for it.
 * A fresh installation is the same case: it has no project at all until an
 * operator makes one, and the screens they need in order to make one were the
 * screens that refused.
 *
 * ## And the refusals had to become distinguishable
 *
 * Three unrelated failures all produced a bare 401 with no `detail`: an expired
 * session, a project slug that does not exist, and a tenant screen reached with
 * no project named at all. The console treats 401 as "session gone" and bounces
 * to the login form, so a *configuration* problem presented as a *logout* —
 * which is precisely why this was hard to see from the browser.
 */
describe("a project with no Keycloak binding is still a project (P22-01)", () => {
  let unboundSlug: string;
  let boundSlug: string;

  beforeAll(async () => {
    const departmentId = await insert(
      "INSERT INTO departments (customer_id, slug, name) VALUES ($1,$2,$3) RETURNING id",
      [existingCustomerId, `unbound-dept-${RUN}`, "Abteilung"],
    );

    // Exactly what the console's own "create project" produces: no issuer, no
    // audience. Those are learner-plane configuration and are filled in later,
    // or never, for a customer that only ever uses the standalone portal.
    unboundSlug = `unbound-${RUN}`;
    await insert(
      `INSERT INTO projects (customer_id, department_id, slug, name)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [existingCustomerId, departmentId, unboundSlug, "Ohne Keycloak"],
    );

    boundSlug = `bound-${RUN}`;
    await insert(
      `INSERT INTO projects (customer_id, department_id, slug, name,
                             keycloak_issuer, keycloak_audience)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [
        existingCustomerId,
        departmentId,
        boundSlug,
        "Mit Keycloak",
        "https://kc.example.test/realms/x",
        "ds-widget",
      ],
    );
  });

  it("lets an operator reach a tenant screen for it", async () => {
    const result = await asStaffIn(superSession, unboundSlug, "GET", "/admin/courses");
    expect(result.status).toBe(200);
  });

  it("still works for a project that does have a binding", async () => {
    const result = await asStaffIn(superSession, boundSlug, "GET", "/admin/courses");
    expect(result.status).toBe(200);
  });

  it("scopes it to that project's customer, not to every customer", async () => {
    // The customer administrator's grant is on `existingCustomerId`, which both
    // projects belong to — so this proves the customer was resolved rather than
    // the check skipped. The refusal case is the next test.
    const result = await asStaffIn(tenantSession, unboundSlug, "GET", "/admin/courses");
    expect(result.status).toBe(200);
  });

  it("refuses an operator with no grant reaching that customer, as a 403", async () => {
    const otherCustomerId = await insert(
      "INSERT INTO customers (slug, name) VALUES ($1,$2) RETURNING id",
      [`elsewhere-${RUN}`, "Woanders GmbH"],
    );
    const otherDept = await insert(
      "INSERT INTO departments (customer_id, slug, name) VALUES ($1,$2,$3) RETURNING id",
      [otherCustomerId, `elsewhere-dept-${RUN}`, "Abteilung"],
    );
    const elsewhere = `elsewhere-project-${RUN}`;
    await insert(
      `INSERT INTO projects (customer_id, department_id, slug, name)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [otherCustomerId, otherDept, elsewhere, "Woanders"],
    );

    const result = await asStaffIn(tenantSession, elsewhere, "GET", "/admin/courses");
    // 403, not 401: they are authenticated and the platform says so. Answering
    // 401 would send the console to the login form for an authorization
    // failure, which is how a permissions problem gets misread as a broken
    // login.
    expect(result.status).toBe(403);
  });

  it("says which project it could not find, rather than a bare 401", async () => {
    const result = await asStaffIn(
      superSession,
      `does-not-exist-${RUN}`,
      "GET",
      "/admin/courses",
    );

    // 404: the caller is authenticated, so "no such project" is the honest
    // answer and is safe to give — unlike the learner plane, where whether a
    // slug exists is not a fact an anonymous caller should learn.
    expect(result.status).toBe(404);
    expect(result.body.detail).toBeDefined();
  });

  it("tells an operator who named no project that a project is needed", async () => {
    const result = await asStaff(superSession, "GET", "/admin/courses");

    // Not 401. The session is valid; what is missing is a selection the console
    // has to make. Reporting it as unauthenticated is what turned "pick a
    // customer" into "you have been logged out".
    //
    // 422 rather than 400 because that is what this API calls a refusal about
    // what the caller sent — `AppError.badRequest`, whose whole contract is
    // that the reason is safe to echo back. Inventing a 400 for one case would
    // add a status to the contract to say something 422 already says.
    expect(result.status).toBe(422);
    expect(result.body.detail).toBeDefined();
  });
});

/**
 * The second factor as a policy, and the lost-device path (P22-02).
 *
 * Two requests behind these cases:
 *
 * 1. *"it should be possible to turn off or on 2fa or make it mandatory or not
 *    mandatory"* — `requiresSecondFactor(role)` was a constant, `super_admin`
 *    always and everybody else never.
 * 2. The gap that request uncovered, which is the more urgent half: there was
 *    **no way to remove or reset an enrolled second factor at all**. An
 *    operator who lost their phone was locked out permanently, and for a super
 *    administrator — the one role forced to enrol — a lost device could end the
 *    platform's only unrestricted account.
 *
 * The tests are here rather than in the pure suite because what they check is
 * that the policy is read *on the sign-in path*, against a real row. The
 * decision itself is exhaustively covered in `@ds/domain`.
 */
describe("the second factor is a policy, not a constant (P22-02)", () => {
  let policyCustomerId: string;

  beforeAll(async () => {
    policyCustomerId = await insert(
      "INSERT INTO customers (slug, name) VALUES ($1,$2) RETURNING id",
      [`policy-${RUN}`, "Policy GmbH"],
    );
  });

  /** Put a scope's policy back, so one case cannot decide the next one's. */
  async function setPolicy(
    customerId: string | null,
    policy: "disabled" | "optional" | "required",
  ): Promise<void> {
    if (customerId === null) {
      await seedPool.query(
        "UPDATE admin_2fa_policy SET policy = $1 WHERE customer_id IS NULL",
        [policy],
      );
      return;
    }
    await seedPool.query(
      `INSERT INTO admin_2fa_policy (customer_id, policy) VALUES ($1,$2)
       ON CONFLICT (customer_id) WHERE customer_id IS NOT NULL
       DO UPDATE SET policy = excluded.policy`,
      [customerId, policy],
    );
  }

  it("starts the platform strict, which is ADR-0012's rule kept as a default", async () => {
    const { rows } = await seedPool.query<{ policy: string }>(
      "SELECT policy FROM admin_2fa_policy WHERE customer_id IS NULL",
    );
    expect(rows[0]?.policy).toBe("required");
  });

  it("keeps exactly one platform row, however hard a caller tries", async () => {
    // Two rows would disagree about the strictest policy in the system and the
    // reader would take whichever the planner returned first.
    await expect(
      seedPool.query(
        "INSERT INTO admin_2fa_policy (customer_id, policy) VALUES (NULL, 'disabled')",
      ),
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  it("sends a customer operator to enrolment when their customer requires one", async () => {
    await setPolicy(policyCustomerId, "required");
    const email = await seedStaff("customer_admin", policyCustomerId);

    const first = await post("/admin/auth/login", { email, password: PASSWORD });
    expect((first.body as { status: string }).status).toBe("totp_enrolment_required");
  });

  it("lets the same kind of operator straight in when it is optional", async () => {
    await setPolicy(policyCustomerId, "optional");
    const email = await seedStaff("customer_admin", policyCustomerId);

    const first = await post("/admin/auth/login", { email, password: PASSWORD });
    expect((first.body as { status: string }).status).toBe("signed_in");
  });

  it("still asks an enrolled operator for a code under an optional policy", async () => {
    // The load-bearing case. Relaxing a policy must never make a stolen
    // password sufficient for somebody who had already protected themselves.
    await setPolicy(policyCustomerId, "required");
    const email = await seedStaff("customer_admin", policyCustomerId);
    await signIn(email); // enrols

    await setPolicy(policyCustomerId, "optional");
    const again = await post("/admin/auth/login", { email, password: PASSWORD });
    expect((again.body as { status: string }).status).toBe("totp_required");
  });

  it("stops asking once the policy is disabled, even though the secret is still on the row", async () => {
    // This asymmetry is what lets an operator whose device is gone back in.
    await setPolicy(policyCustomerId, "required");
    const email = await seedStaff("customer_admin", policyCustomerId);
    await signIn(email);

    await setPolicy(policyCustomerId, "disabled");
    const again = await post("/admin/auth/login", { email, password: PASSWORD });
    expect((again.body as { status: string }).status).toBe("signed_in");
  });

  it("takes the strictest of the scopes an operator can reach", async () => {
    // A grant somewhere relaxed must not be a way around a customer's
    // `required` — otherwise finding that somewhere is an attacker's first
    // move.
    const strict = await insert(
      "INSERT INTO customers (slug, name) VALUES ($1,$2) RETURNING id",
      [`strict-${RUN}`, "Streng GmbH"],
    );
    await setPolicy(strict, "required");
    await setPolicy(policyCustomerId, "disabled");

    const email = await seedStaff("customer_admin", policyCustomerId);
    const { rows } = await seedPool.query<{ id: string }>(
      "SELECT id FROM admin_users WHERE email = $1",
      [email],
    );
    await seedPool.query(
      "INSERT INTO admin_user_roles (admin_user_id, role, customer_id) VALUES ($1,'customer_admin',$2)",
      [rows[0]!.id, strict],
    );

    const first = await post("/admin/auth/login", { email, password: PASSWORD });
    expect((first.body as { status: string }).status).toBe("totp_enrolment_required");
  });

  it("lets a super administrator remove their own factor under a required policy (P66-02)", async () => {
    /*
     * This asserted 403 until P66-02, on the reasoning that otherwise
     * "mandatory" is a suggestion. For a super administrator it always was one:
     * they own the platform policy, so `required` never prevented the outcome —
     * it made them relax the policy, remove the factor and set it back, through
     * a screen that does not say the dance exists. A stolen session could
     * already do exactly that.
     *
     * The rule that keeps `required` meaningful is everybody else, asserted
     * exhaustively where it is pure — `canRemoveOwnSecondFactor` in
     * `packages/domain`, over every role and every policy. Reproducing it here
     * would need a signed-in customer administrator with an enrolled factor,
     * which is a lot of fixture for a property already pinned at the rule with
     * its caller named.
     */
    const result = await asStaff(superSession, "DELETE", "/admin/auth/second-factor");
    expect(result.status).toBe(200);
  });

  it("lets a super admin read the policies", async () => {
    const result = await asStaff(superSession, "GET", "/admin/auth/second-factor/policy");
    expect(result.status).toBe(200);
    expect(result.body.platform).toBe("required");
  });

  /*
   * Which row is the reader's own (P74-01).
   *
   * The console used to work this out from the customer list it holds for the
   * invitation form — every customer for a super administrator, none of which
   * they hold a grant in. So it told them to relax a customer's rule that had
   * no bearing on their account, beside the platform row that did.
   */
  it("tells a super admin that the platform row is the one governing them", async () => {
    const result = await asStaff(superSession, "GET", "/admin/auth/second-factor/policy");
    expect(result.body.own.policy).toBe("required");
    expect(result.body.own.scopes).toEqual([
      { customerId: null, name: null, mayChange: true },
    ]);
  });

  it("tells a customer admin it is their own customer, by name", async () => {
    const result = await asStaff(
      tenantSession,
      "GET",
      "/admin/auth/second-factor/policy",
    );
    expect(result.status).toBe(200);

    const scopes = result.body.own.scopes as readonly {
      customerId: string | null;
      name: string | null;
      mayChange: boolean;
    }[];
    expect(scopes).toHaveLength(1);
    expect(scopes[0]?.customerId).toBe(existingCustomerId);
    // Read through `list_customer_registry()`, because `customers` is under
    // FORCE ROW LEVEL SECURITY and this pool carries no tenant context — a
    // plain SELECT would answer `null` and the screen would name nothing
    // (CLAUDE.md §9.6).
    expect(scopes[0]?.name).not.toBeNull();
    // And never the platform's, which is the row they cannot set.
    expect(scopes[0]?.customerId).not.toBeNull();
    expect(scopes[0]?.mayChange).toBe(true);
  });

  it("refuses a customer admin setting the platform policy", async () => {
    // They would be deciding, from inside one customer, how strictly the
    // platform's unrestricted accounts are protected.
    const result = await asStaff(
      tenantSession,
      "PUT",
      "/admin/auth/second-factor/policy",
      { customerId: null, policy: "disabled" },
    );
    expect(result.status).toBe(403);
  });

  it("refuses a customer admin setting another customer's policy", async () => {
    const result = await asStaff(
      tenantSession,
      "PUT",
      "/admin/auth/second-factor/policy",
      { customerId: policyCustomerId, policy: "disabled" },
    );
    expect(result.status).toBe(403);
  });

  it("lets a customer admin set their own, and records which direction it went", async () => {
    const result = await asStaff(
      tenantSession,
      "PUT",
      "/admin/auth/second-factor/policy",
      { customerId: existingCustomerId, policy: "required" },
    );
    expect(result.status).toBe(200);

    // `recordSystem` writes to `audit_log` with a NULL customer_id — the
    // event belongs to the platform, not to the tenant whose policy changed.
    const { rows } = await seedPool.query<{ detail: { weakened: boolean; to: string } }>(
      `SELECT detail FROM audit_log
        WHERE action = 'staff.second_factor_policy_changed'
        ORDER BY id DESC LIMIT 1`,
    );
    // `optional` → `required` is a tightening, and the entry says so without a
    // reader having to diff two rows to work it out.
    expect(rows[0]?.detail.to).toBe("required");
    expect(rows[0]?.detail.weakened).toBe(false);
  });
});

describe("recovering an operator whose device is gone (P22-02)", () => {
  let targetId: string;
  let targetEmail: string;

  beforeAll(async () => {
    targetEmail = await seedStaff("customer_admin", existingCustomerId);
    const { rows } = await seedPool.query<{ id: string }>(
      "SELECT id FROM admin_users WHERE email = $1",
      [targetEmail],
    );
    targetId = rows[0]!.id;

    // Enrol them, so there is something to lose.
    await seedPool.query(
      `INSERT INTO admin_2fa_policy (customer_id, policy) VALUES ($1,'required')
       ON CONFLICT (customer_id) WHERE customer_id IS NOT NULL
       DO UPDATE SET policy = 'required'`,
      [existingCustomerId],
    );
    await signIn(targetEmail);
  });

  it("clears the secret, the enrolment and the replay counter", async () => {
    const before = await seedPool.query<{ enrolled: Date | null }>(
      "SELECT totp_enrolled_at AS enrolled FROM admin_users WHERE id = $1",
      [targetId],
    );
    expect(before.rows[0]?.enrolled).not.toBeNull();

    const result = await asStaff(
      superSession,
      "POST",
      `/admin/staff/${targetId}/second-factor/reset`,
    );
    expect(result.status).toBe(204);

    const after = await seedPool.query<{
      secret: Buffer | null;
      enrolled: Date | null;
      counter: string | null;
    }>(
      `SELECT totp_secret_enc AS secret, totp_enrolled_at AS enrolled,
              totp_last_counter AS counter
         FROM admin_users WHERE id = $1`,
      [targetId],
    );
    expect(after.rows[0]?.secret).toBeNull();
    expect(after.rows[0]?.enrolled).toBeNull();
    // The counter goes too: a high-water mark from a device that no longer
    // exists is not a fact about the device replacing it.
    expect(after.rows[0]?.counter).toBeNull();
  });

  it("sends their next sign-in to enrolment, not straight in", async () => {
    // A reset restores access without lowering the bar. The policy is still
    // `required`, so they must set up a new device before they get in.
    const first = await post("/admin/auth/login", {
      email: targetEmail,
      password: PASSWORD,
    });
    expect((first.body as { status: string }).status).toBe("totp_enrolment_required");
  });

  it("refuses an operator resetting their own", async () => {
    // Self-reset would turn a stolen *session* into a permanently weakened
    // account, and would step around the `required` policy that
    // `DELETE /admin/auth/second-factor` enforces.
    //
    // The id comes from the session itself, not from "the newest super admin":
    // other cases in this file seed more of those, and asking the database for
    // the latest one would test a different account than the one holding the
    // cookie — which is how a self-reset check quietly becomes an
    // other-account check that passes for the wrong reason.
    const me = await asStaff(superSession, "GET", "/admin/auth/session");
    const ownId = me.body.profile.id as string;

    const result = await asStaff(
      superSession,
      "POST",
      `/admin/staff/${ownId}/second-factor/reset`,
    );
    expect(result.status).toBe(403);
  });

  it("refuses a customer admin resetting a super admin", async () => {
    const superAdmin = await asStaff(superSession, "GET", "/admin/auth/session");

    const result = await asStaff(
      tenantSession,
      "POST",
      `/admin/staff/${superAdmin.body.profile.id}/second-factor/reset`,
    );
    expect(result.status).toBe(403);
  });

  it("404s an account that does not exist", async () => {
    const result = await asStaff(
      superSession,
      "POST",
      `/admin/staff/${randomUUID()}/second-factor/reset`,
    );
    expect(result.status).toBe(404);
  });

  it("revoked every session the reset account held", async () => {
    const { rows } = await seedPool.query<{ live: string }>(
      `SELECT count(*)::text AS live FROM admin_sessions
        WHERE admin_user_id = $1 AND revoked_at IS NULL AND purpose = 'session'`,
      [targetId],
    );
    // An account whose second factor just became recoverable must not carry a
    // session minted under the old one.
    expect(rows[0]?.live).toBe("0");
  });
});

/**
 * Setting up a customer that has no project yet (P22-03).
 *
 * ## The hole
 *
 * `POST /admin/projects` is a tenant-scoped write, so it needed an
 * `X-DS-Project` header — which needed a project. A customer with none had no
 * way to get one, and **every customer has none on the day it is created**. A
 * fresh installation was the same case: it could not be set up through the
 * console it is set up with.
 *
 * Reported from the live deployment as `GET /admin/courses → 404 "Dieses
 * Projekt existiert nicht"`, one fix after the 401 that used to hide it.
 *
 * ## The way out
 *
 * `X-DS-Customer` names the customer directly. It carries an **id** and needs
 * no lookup: `staffTenantContext` already decides whether these grants reach
 * that customer, so an id the operator holds no grant for is refused whether or
 * not it exists — there is nothing here to enumerate with. That is also why it
 * is a staff-plane header with no learner equivalent.
 */
describe("a customer with no project can still be set up (P22-03)", () => {
  let freshCustomerId: string;

  beforeAll(async () => {
    freshCustomerId = await insert(
      "INSERT INTO customers (slug, name) VALUES ($1,$2) RETURNING id",
      [`fresh-${RUN}`, "Frisch GmbH"],
    );
  });

  async function asCustomer(
    session: StaffSession,
    customerId: string,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: any }> {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        cookie: session.cookie,
        "x-ds-csrf": session.csrf,
        "x-ds-customer": customerId,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, body: text === "" ? undefined : JSON.parse(text) };
  }

  it("reaches a tenant screen for a customer that has nothing in it", async () => {
    const result = await asCustomer(
      superSession,
      freshCustomerId,
      "GET",
      "/admin/courses",
    );
    expect(result.status).toBe(200);
    expect(result.body).toEqual([]);
  });

  it("creates the first department and the first project through the console", async () => {
    // The whole point: this is the sequence a fresh installation has to be able
    // to perform, and before P22-03 the second call was unreachable.
    const department = await asCustomer(
      superSession,
      freshCustomerId,
      "POST",
      "/admin/departments",
      { slug: `abteilung-${RUN}`, name: "Abteilung" },
    );
    expect(department.status).toBe(201);

    const project = await asCustomer(
      superSession,
      freshCustomerId,
      "POST",
      "/admin/projects",
      {
        slug: `erstes-projekt-${RUN}`,
        name: "Erstes Projekt",
        departmentSlug: `abteilung-${RUN}`,
      },
    );
    expect(project.status).toBe(201);
  });

  it("writes those rows into the named customer and no other", async () => {
    const { rows } = await seedPool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM projects WHERE customer_id = $1",
      [freshCustomerId],
    );
    expect(rows[0]?.n).toBe("1");
  });

  it("refuses a customer the operator holds no grant reaching", async () => {
    const result = await asCustomer(
      tenantSession,
      freshCustomerId,
      "GET",
      "/admin/courses",
    );
    // 403 whether or not the id exists, so the header is not an oracle.
    expect(result.status).toBe(403);
  });

  it("refuses an id that is not a customer at all, the same way", async () => {
    const result = await asCustomer(tenantSession, randomUUID(), "GET", "/admin/courses");
    expect(result.status).toBe(403);
  });

  it("still answers 422 when neither header is sent", async () => {
    const result = await asStaff(superSession, "GET", "/admin/courses");
    expect(result.status).toBe(422);
  });
});

/**
 * The console after a page reload (P22-04).
 *
 * ## What this reproduces
 *
 * The console kept its CSRF token in a module variable, set by `login` and
 * `verify` and by nothing else. The session cookie is httpOnly and survives a
 * reload; the variable does not. So a reloaded tab — or a second tab, or a
 * restored browser session — could **read everything and write nothing**:
 *
 *     GET  /admin/customers  ->  200
 *     POST /admin/customers  ->  403   (no detail)
 *
 * CSRF is only checked on unsafe methods, which is exactly why the reads went
 * on working and hid it. Reported from the live console failing to create the
 * very first customer.
 *
 * ## What the fix is, and what it must not become
 *
 * The token now also arrives in a cookie the page can read. That is the
 * textbook double-submit shape: the protection comes from a cross-origin
 * attacker being unable to **read** the token, not from the page being unable
 * to. The session cookie stays httpOnly, which is the property that matters —
 * a CSRF token on its own authenticates nothing.
 *
 * So the tests below assert both halves: a reloaded tab can write, and a
 * request with no token still cannot.
 */
describe("a reloaded tab can still write (P22-04)", () => {
  let reloaded: StaffSession;
  /** The sign-in response both cookie-attribute assertions read. */
  let signedIn: Response;

  beforeAll(async () => {
    // Sign in and keep *only* what survives a reload: the cookies. The JSON
    // body's `csrfToken` is deliberately thrown away — that is the variable the
    // reload loses.
    const email = await seedStaff("super_admin", null);
    const first = await post("/admin/auth/login", { email, password: PASSWORD });
    const body = first.body as { status: string; challenge?: string };

    const enrol = await post("/admin/auth/totp/enrol", { challenge: body.challenge });
    const secret = secretFromUri((enrol.body as { otpauthUri: string }).otpauthUri);
    const verified = await post("/admin/auth/totp/verify", {
      challenge: body.challenge,
      code: totpCode(secret, Math.floor(Date.now() / 1000 / 30)),
    });

    signedIn = verified.response;
    const csrf = cookieNamed(verified.response, "ds_staff_csrf");
    const session = cookieNamed(verified.response, "ds_staff_session");
    if (csrf === undefined || session === undefined) {
      throw new Error("no CSRF cookie — a reloaded tab would have nothing to send");
    }
    reloaded = { cookie: `ds_staff_session=${session}`, csrf };
  });

  it("sets the CSRF token in a cookie the page can read", () => {
    // `httpOnly` here would make the whole thing pointless: the page cannot
    // send what it cannot read.
    const csrfAttributes = attributesOf(signedIn, "ds_staff_csrf");
    expect(csrfAttributes).toBeDefined();
    expect(csrfAttributes?.toLowerCase()).not.toContain("httponly");
  });

  it("keeps the session cookie httpOnly, which is the half that matters", () => {
    // Read off the *same* response as the assertion above, so the two cannot
    // disagree about which sign-in they are describing — and so neither depends
    // on some other suite's second-factor policy having left the shared
    // customer in a state where a fresh login goes to enrolment instead.
    const sessionAttributes = attributesOf(signedIn, "ds_staff_session");
    expect(sessionAttributes).toBeDefined();
    expect(sessionAttributes?.toLowerCase()).toContain("httponly");
  });

  it("scopes both cookies identically, so neither can stop arriving alone", () => {
    const session = attributesOf(signedIn, "ds_staff_session") ?? "";
    const csrf = attributesOf(signedIn, "ds_staff_csrf") ?? "";
    const scope = (raw: string) =>
      raw
        .split(";")
        .slice(1)
        .map((a) => a.trim().toLowerCase())
        .filter((a) => a.startsWith("path=") || a.startsWith("domain=") || a === "secure")
        .sort();
    expect(scope(csrf)).toEqual(scope(session));
  });

  it("creates a customer with only what a reloaded tab has", async () => {
    // The reported failure, exactly.
    const result = await asStaff(reloaded, "POST", "/admin/customers", {
      slug: `reloaded-${RUN}`,
      name: "Nach dem Neuladen GmbH",
    });
    expect(result.status).toBe(201);
  });

  it("still refuses a write with no CSRF token at all", async () => {
    const response = await fetch(`${baseUrl}/admin/customers`, {
      method: "POST",
      headers: { cookie: reloaded.cookie, "content-type": "application/json" },
      body: JSON.stringify({ slug: `nocsrf-${RUN}`, name: "Ohne Token" }),
    });
    expect(response.status).toBe(403);
  });

  it("still refuses a write with somebody else's CSRF token", async () => {
    const response = await fetch(`${baseUrl}/admin/customers`, {
      method: "POST",
      headers: {
        cookie: reloaded.cookie,
        "x-ds-csrf": superSession.csrf,
        "content-type": "application/json",
      },
      body: JSON.stringify({ slug: `wrongcsrf-${RUN}`, name: "Falscher Token" }),
    });
    expect(response.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------

/**
 * The role the client asked for, and the hole it was in (P38-01).
 *
 * > two distinct customer roles: one that can create departments/projects/
 * > courses, and one that can create **only courses**
 *
 * `course_editor` was declared in `@ds/domain`, granted `course` and `content`
 * by the capability matrix, offered on the Konten screen as something to
 * assign — and accepted by **no route in the platform**. An account holding it
 * signed in and met "Ihr Konto hat keine Berechtigung für die Verwaltung",
 * because the console's first request is `GET /admin/courses` and that 403'd.
 *
 * These tests are the boundary itself, stated in both directions. The
 * "may not" half is the security property and is the reason this block is long:
 * widening a permission is one line, and the only thing that stops the next
 * line from widening it further is a test that fails when it does.
 */
describe("a course editor may write courses and nothing above them (P38-01)", () => {
  let editor: StaffSession;
  let editorProjectSlug: string;
  let editorCourseSlug: string;

  beforeAll(async () => {
    const departmentId = await insert(
      "INSERT INTO departments (customer_id, slug, name) VALUES ($1,$2,$3) RETURNING id",
      [existingCustomerId, `editor-dept-${RUN}`, "Redaktion"],
    );
    editorProjectSlug = `editor-projekt-${RUN}`;
    await insert(
      `INSERT INTO projects (customer_id, department_id, slug, name)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [existingCustomerId, departmentId, editorProjectSlug, "Redaktionsprojekt"],
    );

    const email = await seedStaff("course_editor", existingCustomerId);
    editor = await signIn(email);
    editorCourseSlug = `redaktion-kurs-${RUN}`;
  }, 30_000);

  // -- may ------------------------------------------------------------------

  it("can open the console at all, which is the whole defect", async () => {
    const result = await asStaffIn(editor, editorProjectSlug, "GET", "/admin/courses");
    expect(result.status).toBe(200);
  });

  it("can list projects, because creating a course means choosing one", async () => {
    const result = await asStaffIn(editor, editorProjectSlug, "GET", "/admin/projects");
    expect(result.status).toBe(200);
  });

  it("can create a course", async () => {
    const result = await asStaffIn(editor, editorProjectSlug, "POST", "/admin/courses", {
      projectSlug: editorProjectSlug,
      slug: editorCourseSlug,
      title: "Von der Redaktion angelegt",
      deliveryType: "on_demand",
    });
    expect(result.status).toBe(201);
  });

  it("can put a module, a chapter and a content into it", async () => {
    const moduleResult = await asStaffIn(
      editor,
      editorProjectSlug,
      "POST",
      `/admin/courses/${editorCourseSlug}/modules`,
      { title: "Modul 1" },
    );
    expect(moduleResult.status).toBe(201);

    const moduleId = moduleResult.body.modules[0].id as string;
    const chapterResult = await asStaffIn(
      editor,
      editorProjectSlug,
      "POST",
      `/admin/modules/${moduleId}/chapters`,
      { title: "Kapitel 1" },
    );
    expect(chapterResult.status).toBe(201);

    const chapterId = chapterResult.body.modules[0].chapters[0].id as string;
    const contentResult = await asStaffIn(
      editor,
      editorProjectSlug,
      "POST",
      `/admin/chapters/${chapterId}/contents`,
      // A real video draft: `contentProblems` requires at least one source and
      // a duration, because the watch gate is a percentage of a known length.
      {
        kind: "video",
        title: "Video 1",
        durationSec: 600,
        sources: [{ url: "https://media.example.org/v1.mp4", mimeType: "video/mp4" }],
      },
    );
    expect(contentResult.status).toBe(201);
  });

  it("can edit the course's own settings, so it can be made certifiable", async () => {
    const result = await asStaffIn(
      editor,
      editorProjectSlug,
      "PATCH",
      `/admin/courses/${editorCourseSlug}`,
      { requiredWatchPercent: 90 },
    );
    expect(result.status).toBe(200);
  });

  // -- may not --------------------------------------------------------------

  it("may not create a department", async () => {
    const result = await asStaffIn(
      editor,
      editorProjectSlug,
      "POST",
      "/admin/departments",
      { slug: `verboten-${RUN}`, name: "Verbotene Abteilung" },
    );
    expect(result.status).toBe(403);
  });

  it("may not create a project", async () => {
    const result = await asStaffIn(editor, editorProjectSlug, "POST", "/admin/projects", {
      departmentSlug: `editor-dept-${RUN}`,
      slug: `verboten-projekt-${RUN}`,
      name: "Verbotenes Projekt",
    });
    expect(result.status).toBe(403);
  });

  it("may not edit a project — the Keycloak binding is not theirs", async () => {
    const result = await asStaffIn(
      editor,
      editorProjectSlug,
      "PATCH",
      `/admin/projects/${editorProjectSlug}`,
      { name: "Umbenannt" },
    );
    expect(result.status).toBe(403);
  });

  it("may not read the participants of the course they wrote", async () => {
    // The sharpest line in the matrix: they author the content and never see
    // who took it. An agency writing for a customer gets no physician's record.
    const result = await asStaffIn(
      editor,
      editorProjectSlug,
      "GET",
      `/admin/courses/${editorCourseSlug}/participants`,
    );
    expect(result.status).toBe(403);
  });

  it("may not upload a certificate stamp", async () => {
    const result = await asStaffIn(
      editor,
      editorProjectSlug,
      "PUT",
      `/admin/courses/${editorCourseSlug}/certificate-assets`,
      { stampImage: null, signatureImage: null },
    );
    expect(result.status).toBe(403);
  });

  it("may not replace the project's typeface", async () => {
    const result = await asStaffIn(
      editor,
      editorProjectSlug,
      "GET",
      "/admin/branding/font",
    );
    expect(result.status).toBe(403);
  });

  it("may not reach the customer registry", async () => {
    const result = await asStaff(editor, "GET", "/admin/customers");
    expect(result.status).toBe(403);
  });

  it("may not list or invite operator accounts", async () => {
    const result = await asStaff(editor, "GET", "/admin/staff");
    expect(result.status).toBe(403);
  });

  it("left nothing behind from any of the refusals", async () => {
    // A 403 with a row behind it would be the worst of both. Checked from
    // outside the API, on the seed pool, so this is the database's answer.
    const { rows } = await seedPool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM departments WHERE slug = $1`,
      [`verboten-${RUN}`],
    );
    expect(Number(rows[0]?.n ?? "1")).toBe(0);
  });
});

// ---------------------------------------------------------------------------

/**
 * An invitation link is not a permanent key to the account (P39-01).
 *
 * `inviteStatus` and `resetStatus` were written in `@ds/domain`, exported,
 * unit-tested against their boundaries, and **called from nowhere**.
 * `redeemCredentialToken` looked the token up by hash and, if a row came back,
 * set the password — reading `created_at`, `accepted_at` and `revoked_at` and
 * using none of them.
 *
 * Each test below is one account takeover that used to work. They are written
 * against the HTTP surface rather than the service, because the thing being
 * asserted is what somebody holding a link can actually do with it.
 *
 * All three failures answer identically — "this link is no longer valid" — so
 * a spent link cannot be told from one that never existed. That indistinguish-
 * ability is why these have to be separated by *setup* rather than by response.
 */
describe("a credential token is single-use, expiring and revocable (P39-01)", () => {
  const email = () => `redeem-${randomUUID().slice(0, 8)}@ds.test`;

  /*
   * 422, not 400. `AppError.badRequest` builds a `validation` problem, which
   * the filter maps to 422 — and every refusal here comes back as the same
   * "this link is no longer valid" whatever the underlying verdict was, which
   * is the point: a spent link must not be distinguishable from one that never
   * existed.
   */
  const REFUSED = 422;

  /** Invite somebody and return the token the console would hand over. */
  async function invite(address: string): Promise<string> {
    const { status, body } = await asStaff(superSession, "POST", "/admin/staff", {
      email: address,
      displayName: "Eingeladene Person",
      role: "customer_admin",
      customerId: existingCustomerId,
      departmentId: null,
    });
    expect(status).toBe(201);
    return body.token as string;
  }

  /** `post` hands back the `Response`; only its status matters here. */
  async function redeem(token: string, password: string): Promise<number> {
    const { response } = await post("/admin/auth/credentials", { token, password });
    return response.status;
  }

  it("lets the invited person set a password once", async () => {
    const token = await invite(email());
    expect(await redeem(token, "erste-wahl-2026!")).toBe(201);
  });

  it("refuses the same link a second time", async () => {
    const token = await invite(email());
    expect(await redeem(token, "erste-wahl-2026!")).toBe(201);

    // The takeover: the link is in an inbox, and whoever reads it later chooses
    // a new password for an account that is now somebody's.
    expect(await redeem(token, "zweite-wahl-2026!")).toBe(REFUSED);
  });

  it("left the first password in place after refusing the replay", async () => {
    // A 400 with the password already written would be the worst of both, and
    // is exactly what `setPassword` running before the check produced.
    const address = email();
    const token = await invite(address);
    await redeem(token, "erste-wahl-2026!");

    const { rows: before } = await seedPool.query<{ password_hash: string }>(
      "SELECT password_hash FROM admin_users WHERE email = $1",
      [address],
    );
    await redeem(token, "zweite-wahl-2026!");
    const { rows: after } = await seedPool.query<{ password_hash: string }>(
      "SELECT password_hash FROM admin_users WHERE email = $1",
      [address],
    );

    expect(after[0]?.password_hash).toBe(before[0]?.password_hash);
  });

  it("refuses a link that has been revoked", async () => {
    /*
     * Revoked in the database rather than through a route, because there is no
     * route that revokes one — `issueCredentialToken` does it as a side effect
     * of issuing the next token, and `POST /admin/staff` creates an account so
     * it cannot be called twice for the same address. What is under test is
     * that redemption *reads* `revoked_at`, which it did not.
     */
    const address = email();
    const token = await invite(address);
    await seedPool.query(
      `UPDATE admin_credential_tokens SET revoked_at = now()
        WHERE admin_user_id = (SELECT id FROM admin_users WHERE email = $1)`,
      [address],
    );

    expect(await redeem(token, "zurueckgezogen-2026!")).toBe(REFUSED);
  });

  it("refuses a link older than the invitation window", async () => {
    const address = email();
    const token = await invite(address);

    // Eight days, against INVITE_VALID_DAYS = 7. Moved in the database rather
    // than by mocking a clock, because what is under test is the API's own
    // reading of its own row.
    await seedPool.query(
      `UPDATE admin_credential_tokens SET created_at = now() - interval '8 days'
        WHERE admin_user_id = (SELECT id FROM admin_users WHERE email = $1)`,
      [address],
    );

    expect(await redeem(token, "zu-spaet-2026!")).toBe(REFUSED);
  });

  it("holds a reset link to a much shorter window than an invitation", async () => {
    // Two hours is fine for an invitation and long dead for a reset: a reset
    // link is a live bypass of the password on an account that already exists,
    // sitting in an inbox. RESET_VALID_MINUTES = 60.
    const address = email();
    const token = await invite(address);

    await seedPool.query(
      `UPDATE admin_credential_tokens
          SET kind = 'reset', created_at = now() - interval '2 hours'
        WHERE admin_user_id = (SELECT id FROM admin_users WHERE email = $1)`,
      [address],
    );

    expect(await redeem(token, "zu-spaet-2026!")).toBe(REFUSED);
  });

  it("records the refusal, so a revoked link being presented is visible", async () => {
    // `audit_log`, not `admin_audit_log`: `recordSystem` writes the platform
    // log with `customer_id = NULL`, which is where an event belonging to no
    // tenant goes — and a refused token belongs to no tenant by definition.
    const { rows } = await seedPool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM audit_log
        WHERE action = 'staff.credential_token_refused'`,
    );
    expect(Number(rows[0]?.n ?? "0")).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------

/**
 * "Passwort vergessen", on the staff plane (P40-02).
 *
 * Everything here is about the endpoint refusing to answer the question it is
 * being asked. A console whose accounts are named after real people at a named
 * company must not have a form that says whether an address is one of them —
 * so the assertions are that the answers are *identical*, which is an awkward
 * thing to test and the entire security property.
 */
describe("asking for a password-reset link (P40-02)", () => {
  /*
   * The limiter is three a minute per IP, every request in every suite arrives
   * from 127.0.0.1, and Redis outlives a run. So without this the first ask
   * here inherits whatever the last run spent — which is how these four tests
   * failed with 429 on the second run and passed on the first, the signature of
   * shared state rather than a bug in either.
   *
   * Cleared per test rather than once, because the three asks below would
   * otherwise spend the whole allowance between them.
   */
  beforeEach(async () => {
    const redis = new Redis(process.env["REDIS_URL"] ?? "redis://127.0.0.1:6379");
    try {
      const keys = await redis.keys("ratelimit:staffPasswordReset:*");
      if (keys.length > 0) await redis.del(...keys);
    } finally {
      redis.disconnect();
    }
  });

  async function ask(email: string): Promise<number> {
    const { response } = await post("/admin/auth/password-reset", { email });
    return response.status;
  }

  it("accepts a request for an address that exists", async () => {
    const address = `vergessen-${randomUUID().slice(0, 8)}@ds.test`;
    await asStaff(superSession, "POST", "/admin/staff", {
      email: address,
      displayName: "Vergesslich",
      role: "customer_admin",
      customerId: existingCustomerId,
      departmentId: null,
    });

    expect(await ask(address)).toBe(202);
  });

  it("answers the same for an address that does not", async () => {
    expect(await ask(`niemand-${randomUUID().slice(0, 8)}@ds.test`)).toBe(202);
  });

  it("mints no token when there is no sender configured", async () => {
    /*
     * The platform has no SMTP settings in this suite, so there is nowhere to
     * send a link — and the service stops before issuing one. A token written
     * into a void is a live credential in the database that nobody asked for
     * and nobody will ever spend.
     *
     * Counted across the whole table because the endpoint deliberately reveals
     * nothing about which account it belonged to.
     */
    const address = `ohne-versand-${randomUUID().slice(0, 8)}@ds.test`;
    await asStaff(superSession, "POST", "/admin/staff", {
      email: address,
      displayName: "Ohne Versand",
      role: "customer_admin",
      customerId: existingCustomerId,
      departmentId: null,
    });

    const before = await countResetTokens();
    expect(await ask(address)).toBe(202);
    expect(await countResetTokens()).toBe(before);
  });

  it("records the attempt without recording the address", async () => {
    const { rows } = await seedPool.query<{ detail: unknown }>(
      `SELECT detail FROM audit_log
        WHERE action = 'staff.password_reset_requested'
        ORDER BY created_at DESC LIMIT 5`,
    );
    expect(rows.length).toBeGreaterThan(0);

    // An address in the audit log would rebuild exactly the list the endpoint
    // refuses to hand out, for anybody who can read it later.
    for (const row of rows) {
      expect(JSON.stringify(row.detail)).not.toMatch(/@/u);
    }
  });

  async function countResetTokens(): Promise<number> {
    const { rows } = await seedPool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM admin_credential_tokens WHERE kind = 'reset'`,
    );
    return Number(rows[0]?.n ?? "0");
  }
});

/**
 * The platform's own sender (P40-01).
 */
describe("configuring where platform mail comes from (P40-01)", () => {
  it("starts empty, and says it cannot send", async () => {
    const { status, body } = await asStaff(
      superSession,
      "GET",
      "/admin/auth/platform-smtp",
    );
    expect(status).toBe(200);
    expect(body).toMatchObject({ host: null, hasPassword: false, canSend: false });
  });

  it("is saved, and reports that it can send once host and sender are set", async () => {
    const saved = await asStaff(superSession, "PUT", "/admin/auth/platform-smtp", {
      host: "smtp.example.test",
      port: 587,
      username: "plattform",
      password: "geheim-und-lang-genug",
      secure: false,
      fromAddress: "no-reply@example.test",
      fromName: "DS Education",
    });
    expect(saved.status).toBe(200);

    const { body } = await asStaff(superSession, "GET", "/admin/auth/platform-smtp");
    expect(body).toMatchObject({
      host: "smtp.example.test",
      port: 587,
      hasPassword: true,
      canSend: true,
    });
  });

  it("never returns the password, in any form", async () => {
    const { body } = await asStaff(superSession, "GET", "/admin/auth/platform-smtp");
    expect(JSON.stringify(body)).not.toContain("geheim-und-lang-genug");
  });

  it("stores it as ciphertext, not as text", async () => {
    const { rows } = await seedPool.query<{ password_enc: Buffer | null }>(
      "SELECT password_enc FROM platform_smtp WHERE id = true",
    );
    const stored = rows[0]?.password_enc;
    expect(stored).not.toBeNull();
    expect(stored?.toString("utf8")).not.toContain("geheim-und-lang-genug");
  });

  it("keeps the stored password when the field is omitted", async () => {
    // The defect this prevents: an operator corrects the sender name and
    // silently clears the credential, and mail stops leaving days later.
    await asStaff(superSession, "PUT", "/admin/auth/platform-smtp", {
      host: "smtp.example.test",
      port: 587,
      username: "plattform",
      secure: false,
      fromAddress: "no-reply@example.test",
      fromName: "Anderer Name",
    });

    const { body } = await asStaff(superSession, "GET", "/admin/auth/platform-smtp");
    expect(body).toMatchObject({ fromName: "Anderer Name", hasPassword: true });
  });

  it("clears it when the field is an explicit null", async () => {
    await asStaff(superSession, "PUT", "/admin/auth/platform-smtp", {
      host: "smtp.example.test",
      port: 587,
      username: "plattform",
      password: null,
      secure: false,
      fromAddress: "no-reply@example.test",
      fromName: "Anderer Name",
    });

    const { body } = await asStaff(superSession, "GET", "/admin/auth/platform-smtp");
    expect(body).toMatchObject({ hasPassword: false });
  });

  it("refuses a customer administrator changing it", async () => {
    // Not one customer's setting: it is the address mail about *other people's*
    // accounts comes from.
    const { status } = await asStaff(tenantSession, "PUT", "/admin/auth/platform-smtp", {
      host: "smtp.woanders.test",
      port: 587,
      username: null,
      secure: false,
      fromAddress: "kunde@woanders.test",
      fromName: null,
    });
    expect(status).toBe(403);
  });
});

// ---------------------------------------------------------------------------

/**
 * A department administrator can open every screen their role is drawn (P41-02).
 *
 * Found by `scripts/role-matrix.mjs`, not by a person clicking — which is the
 * point of that script. The capability matrix grants `department_admin`
 * `project`, `learner_record` and `certificate`, so the console draws
 * Organisation, Teilnehmende and Bescheinigungen for them; three of the routes
 * those screens load on mount refused the role, so each could only render an
 * error.
 *
 * The corrections stay refused, and that half is asserted here too: the fix was
 * to open the *reads*, and a fix that quietly opened the writes as well would
 * let a department administrator withdraw a Teilnahmebescheinigung.
 */
/**
 * A staff session is not a participant session, even in one browser (P68-02).
 *
 * Both apps talk to the same API host, so an operator with the console open
 * sends `ds_staff_session` on every request the portal makes. CSRF is not
 * checked on a GET, so `GET /auth/participant/me` — the portal's entire test
 * for "am I signed in" — answered 200 for a staff cookie, and the portal drew a
 * signed-in catalogue for somebody who could not enrol in anything on it.
 *
 * Driven with a **real, valid** super-administrator session, because the fix
 * defers before the session is resolved: a made-up cookie would be refused by
 * the old code too, and the test would have been green on the bug.
 */
describe("the portal does not accept a staff session (P68-02)", () => {
  it("refuses /auth/participant/me for a valid staff cookie", async () => {
    const response = await fetch(`${baseUrl}/auth/participant/me`, {
      /*
       * The slug's value does not matter and cannot: the staff plane defers on
       * the path, and the learner path then refuses for want of a credential
       * before it ever resolves a project. What matters is that the header is
       * present at all, because that is the shape the portal sends.
       */
      headers: { cookie: superSession.cookie, "x-ds-project": `egal-${RUN}` },
    });

    expect(
      response.status,
      "a staff session authenticated the learner plane — the portal will draw a " +
        "signed-in catalogue for an operator who cannot enrol in anything on it",
    ).toBe(401);
  });

  it("still lets the same session use the console", async () => {
    // The other half, and the reason the fix is scoped to a path rather than to
    // a header: `X-DS-Project` is a legitimate staff tenant scope, and keying
    // on it would have signed every department administrator out.
    expect((await asStaff(superSession, "GET", "/admin/customers")).status).toBe(200);
  });
});

describe("a department administrator's screens actually load (P41-02)", () => {
  let departmental: StaffSession;
  let projectSlug: string;

  beforeAll(async () => {
    const departmentId = await insert(
      "INSERT INTO departments (customer_id, slug, name) VALUES ($1,$2,$3) RETURNING id",
      [existingCustomerId, `dept-abteilung-${RUN}`, "Abteilung"],
    );
    projectSlug = `abteilung-projekt-${RUN}`;
    await insert(
      `INSERT INTO projects (customer_id, department_id, slug, name)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [existingCustomerId, departmentId, projectSlug, "Abteilungsprojekt"],
    );

    const email = `dept-${randomUUID().slice(0, 8)}@ds.test`;
    const passwordHash = await hash(PASSWORD, { algorithm: 2 });
    const id = await insert(
      "INSERT INTO admin_users (email, display_name, password_hash) VALUES ($1,$2,$3) RETURNING id",
      [email, "Abteilungsleitung", passwordHash],
    );
    // `department_admin` is the one role whose grant carries a department, and
    // the CHECK constraint requires it.
    await seedPool.query(
      `INSERT INTO admin_user_roles (admin_user_id, role, customer_id, department_id)
       VALUES ($1,'department_admin',$2,$3)`,
      [id, existingCustomerId, departmentId],
    );

    departmental = await signIn(email);
  }, 30_000);

  it("opens Organisation — both of its loads, not just the first", async () => {
    // Departments passed and projects 403'd, so the screen errored on a read it
    // needed rather than on the one it was refused.
    expect(
      (await asStaffIn(departmental, projectSlug, "GET", "/admin/departments")).status,
    ).toBe(200);
    expect(
      (await asStaffIn(departmental, projectSlug, "GET", "/admin/projects")).status,
    ).toBe(200);
  });

  it("opens Teilnehmende and Bescheinigungen", async () => {
    expect(
      (await asStaffIn(departmental, projectSlug, "GET", "/admin/learners")).status,
    ).toBe(200);
    expect(
      (await asStaffIn(departmental, projectSlug, "GET", "/admin/certificates")).status,
    ).toBe(200);
  });

  it("still may not correct a physician's name", async () => {
    const result = await asStaffIn(
      departmental,
      projectSlug,
      "PATCH",
      `/admin/learners/${randomUUID()}/name`,
      { name: "Neuer Name" },
    );
    expect(result.status).toBe(403);
  });

  it("still may not withdraw a certificate", async () => {
    const result = await asStaffIn(
      departmental,
      projectSlug,
      "POST",
      `/admin/certificates/${randomUUID()}/revoke`,
      {},
    );
    expect(result.status).toBe(403);
  });

  it("still may not create a project it could now list", async () => {
    const result = await asStaffIn(departmental, projectSlug, "POST", "/admin/projects", {
      departmentSlug: `dept-abteilung-${RUN}`,
      slug: `dept-verboten-${RUN}`,
      name: "Verboten",
    });
    expect(result.status).toBe(403);
  });
});
