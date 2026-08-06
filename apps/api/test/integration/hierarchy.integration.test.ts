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
  });

  it("creates the account without a password, so the invitation is not a credential", async () => {
    const { rows } = await seedPool.query<{ password_hash: string | null }>(
      "SELECT password_hash FROM admin_users WHERE email = $1",
      [`invited-${RUN}@ds.test`],
    );
    expect(rows[0]?.password_hash).toBeNull();
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
