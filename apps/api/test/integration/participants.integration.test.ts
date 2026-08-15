/**
 * Participant administration, end to end (P21-04).
 *
 * ## What this proves that a unit test cannot
 *
 * Three things, and all three are boundaries rather than behaviour:
 *
 * 1. **A participant an administrator creates can actually sign in.** That
 *    spans two connections and two transactions — the person and credential go
 *    in on the pool, the membership and role inside the tenant transaction —
 *    and either half missing produces a working sign-in followed by a 403 that
 *    names a user id nobody recognises. Only driving both ends catches it.
 * 2. **A participant of another customer is a 404, not a 403.** The tenant
 *    check is `user_customers` under RLS; a mocked repository would return
 *    whatever the mock was told to.
 * 3. **Disabling actually stops somebody.** The column exists on one plane and
 *    the check that reads it lives on the other, so the two can be written
 *    correctly and never meet.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { createPool } from "@ds/postgres";
import Redis from "ioredis";
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
process.env["EIV_WORKER_ENABLED"] = "no";

const ADMIN_PASSWORD = `pw-${randomUUID()}`;

let app: NestExpressApplication;
let baseUrl: string;
let pool: Pool;
let redis: Redis;

let alpha: Tenant;
let beta: Tenant;

interface Tenant {
  readonly customerId: string;
  readonly projectSlug: string;
  /** A `customer_admin` who signs in with a local credential, so the whole
   * flow can be driven with one mechanism rather than two. */
  readonly adminEmail: string;
  readonly adminCookie: string;
}

beforeAll(async () => {
  pool = createPool({ connectionString: SUPERUSER_URL });
  redis = new Redis(requireEnv("REDIS_URL"), { maxRetriesPerRequest: 3 });

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

  alpha = await seedTenant("alpha");
  beta = await seedTenant("beta");
}, 60_000);

beforeEach(async () => {
  for (const name of [
    "participantSignIn",
    "participantCreate",
    "participantPasswordChange",
  ]) {
    const keys = await redis.keys(`ratelimit:${name}:*`);
    if (keys.length > 0) await redis.del(...keys);
  }
});

afterAll(async () => {
  await app?.close();
  await pool?.end();
  redis?.disconnect();
});

/** A customer, a local project, and a `customer_admin` signed in through it. */
async function seedTenant(label: string): Promise<Tenant> {
  const suffix = randomUUID().slice(0, 8);
  const adminEmail = `${label}-admin-${suffix}@example.org`;

  const customerId = await one(
    "INSERT INTO customers (slug, name) VALUES ($1,$2) RETURNING id",
    [`padmin-${label}-${suffix}`, `PAdmin ${label} GmbH`],
  );
  const departmentId = await one(
    "INSERT INTO departments (customer_id, slug, name) VALUES ($1,'default','Default') RETURNING id",
    [customerId],
  );
  const projectSlug = `padmin-${label}-${suffix}`;
  await one(
    // No Keycloak columns: that is what `local` means, and what the console
    // writes. See `participant-auth.integration.test.ts` for why `''` here was
    // hiding a real refusal.
    `INSERT INTO projects (customer_id, department_id, slug, name, identity_provider)
     VALUES ($1,$2,$3,$4,'local') RETURNING id`,
    [customerId, departmentId, projectSlug, `PAdmin ${label}`],
  );

  const userId = await one(
    "INSERT INTO users (email, first_name, last_name) VALUES ($1,'Admin','Person') RETURNING id",
    [adminEmail],
  );
  const identityId = await one(
    `INSERT INTO user_identities (user_id, provider, realm, subject)
     VALUES ($1,'local',$2,$3) RETURNING id`,
    [userId, LOCAL_REALM, adminEmail],
  );
  await pool.query(
    `INSERT INTO learner_credentials (user_identity_id, password_hash, must_change)
     VALUES ($1,$2,false)`,
    [identityId, await argonHash(ADMIN_PASSWORD, { algorithm: 2 })],
  );
  await pool.query("INSERT INTO user_customers (user_id, customer_id) VALUES ($1,$2)", [
    userId,
    customerId,
  ]);
  await pool.query(
    "INSERT INTO user_roles (user_id, role, customer_id) VALUES ($1,'customer_admin',$2)",
    [userId, customerId],
  );

  const adminCookie = await signInFor(projectSlug, adminEmail, ADMIN_PASSWORD);
  return { customerId, projectSlug, adminEmail, adminCookie };
}

async function one(sql: string, values: unknown[]): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(sql, values);
  const id = rows[0]?.id;
  if (id === undefined) throw new Error(`fixture returned no id:\n${sql}`);
  return id;
}

async function signInFor(
  projectSlug: string,
  email: string,
  password: string,
): Promise<string> {
  const response = await fetch(`${baseUrl}/auth/participant/sign-in`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-ds-project": projectSlug },
    body: JSON.stringify({ email, password }),
  });
  const header = response.headers
    .getSetCookie()
    .find((c) => c.startsWith(PARTICIPANT_COOKIE));
  const token = header?.split(";")[0]?.split("=")[1];
  if (token === undefined || token === "") {
    throw new Error(`sign-in failed for ${email}: ${String(response.status)}`);
  }
  return token;
}

function asAdmin(tenant: Tenant, init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: {
      ...init.headers,
      "content-type": "application/json",
      cookie: `${PARTICIPANT_COOKIE}=${tenant.adminCookie}`,
      "x-ds-project": tenant.projectSlug,
    },
  };
}

async function createParticipant(
  tenant: Tenant,
  overrides: Record<string, unknown> = {},
): Promise<{ status: number; userId: string; temporaryPassword: string; email: string }> {
  const email = `p-${randomUUID().slice(0, 8)}@example.org`;
  const response = await fetch(
    `${baseUrl}/admin/participants`,
    asAdmin(tenant, {
      method: "POST",
      body: JSON.stringify({
        email,
        firstName: "Neue",
        lastName: "Teilnehmende",
        ...overrides,
      }),
    }),
  );
  if (response.status !== 201 && response.status !== 200) {
    return { status: response.status, userId: "", temporaryPassword: "", email };
  }
  const body = (await response.json()) as { userId: string; temporaryPassword: string };
  return { status: response.status, ...body, email };
}

// ---------------------------------------------------------------------------

describe("creating a participant", () => {
  it("creates somebody who can immediately sign in and see the catalogue", async () => {
    // The whole feature in one test. Two connections and two transactions are
    // involved — the person on the pool, the membership in the tenant
    // transaction — and either half missing gives a successful sign-in
    // followed by a 403.
    const created = await createParticipant(alpha);
    expect(created.userId).not.toBe("");

    const cookie = await signInFor(
      alpha.projectSlug,
      created.email,
      created.temporaryPassword,
    );

    const courses = await fetch(`${baseUrl}/courses`, {
      headers: {
        cookie: `${PARTICIPANT_COOKIE}=${cookie}`,
        "x-ds-project": alpha.projectSlug,
      },
    });
    expect(courses.status).toBe(200);
  });

  it("returns the password once and never again", async () => {
    // The password exists in exactly one response body and nowhere else. If it
    // could be read back, "temporary" would be a description rather than a
    // property.
    const created = await createParticipant(alpha);
    expect(created.temporaryPassword.length).toBeGreaterThan(16);

    const list = await fetch(`${baseUrl}/admin/participants`, asAdmin(alpha));
    expect(await list.text()).not.toContain(created.temporaryPassword);
  });

  it("stores the password only as a hash", async () => {
    const created = await createParticipant(alpha);
    const { rows } = await pool.query<{ password_hash: string }>(
      `SELECT c.password_hash FROM learner_credentials c
         JOIN user_identities i ON i.id = c.user_identity_id
        WHERE i.user_id = $1`,
      [created.userId],
    );
    expect(rows[0]?.password_hash).not.toContain(created.temporaryPassword);
    expect(rows[0]?.password_hash).toMatch(/^\$argon2id\$/);
  });

  it("forces a password change on the new account", async () => {
    // A password an administrator read off a screen is a password an
    // administrator knows. `must_change` is what stops it being the
    // physician's password for the next three years.
    const created = await createParticipant(alpha);
    const response = await fetch(`${baseUrl}/auth/participant/sign-in`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-ds-project": alpha.projectSlug },
      body: JSON.stringify({
        email: created.email,
        password: created.temporaryPassword,
      }),
    });

    expect(await response.json()).toEqual({ mustChangePassword: true });
  });

  it("refuses a second account for the same address", async () => {
    const created = await createParticipant(alpha);
    const again = await createParticipant(alpha, { email: created.email });
    expect(again.status).toBe(409);
  });

  it("refuses a participant with no name", async () => {
    // A Teilnahmebescheinigung prints a name and cannot be issued without one,
    // so a nameless participant is somebody who finishes a course and cannot
    // be given the point they earned.
    const response = await fetch(
      `${baseUrl}/admin/participants`,
      asAdmin(alpha, {
        method: "POST",
        body: JSON.stringify({ email: "x@example.org", firstName: "", lastName: "" }),
      }),
    );
    // 422, not 400: `ValidationFailed` is the shape `contracts/openapi.yaml`
    // uses for a well-formed request whose contents are wrong, and every other
    // route in this API already answers that way.
    expect(response.status).toBe(422);
  });
});

describe("the tenant boundary", () => {
  it("lists only this customer's participants", async () => {
    const mine = await createParticipant(alpha);
    const theirs = await createParticipant(beta);

    const response = await fetch(`${baseUrl}/admin/participants`, asAdmin(alpha));
    const body = await response.text();

    expect(body).toContain(mine.email);
    expect(body).not.toContain(theirs.email);
  });

  it("answers 404 — not 403 — for another customer's participant", async () => {
    // 404 rather than 403 on purpose. A 403 confirms the id names somebody,
    // which turns this route into an oracle for enumerating another tenant's
    // participants one uuid at a time.
    const theirs = await createParticipant(beta);

    const response = await fetch(
      `${baseUrl}/admin/participants/${theirs.userId}/reset-password`,
      asAdmin(alpha, { method: "POST" }),
    );
    expect(response.status).toBe(404);
  });

  it("cannot disable another customer's participant", async () => {
    const theirs = await createParticipant(beta);

    const response = await fetch(
      `${baseUrl}/admin/participants/${theirs.userId}/disabled`,
      asAdmin(alpha, { method: "POST", body: JSON.stringify({ disabled: true }) }),
    );
    expect(response.status).toBe(404);

    // …and it really did nothing, rather than answering 404 after the write.
    const { rows } = await pool.query<{ disabled_at: Date | null }>(
      `SELECT c.disabled_at FROM learner_credentials c
         JOIN user_identities i ON i.id = c.user_identity_id
        WHERE i.user_id = $1`,
      [theirs.userId],
    );
    expect(rows[0]?.disabled_at).toBeNull();
  });

  it("creates into the caller's own customer, whatever the body says", async () => {
    // `customerId` is taken from the principal. If the body could set it, one
    // edited request would plant a participant inside another tenant.
    const created = await createParticipant(alpha, { customerId: beta.customerId });

    const { rows } = await pool.query<{ customer_id: string }>(
      "SELECT customer_id FROM user_customers WHERE user_id = $1",
      [created.userId],
    );
    expect(rows.map((r) => r.customer_id)).toEqual([alpha.customerId]);
  });
});

describe("disabling an account", () => {
  it("stops the participant signing in", async () => {
    // The check lives in `ParticipantAuthService` and the column in a migration
    // — two planes that can each be written correctly and never meet. Without
    // the check, "sperren" writes a timestamp nothing reads.
    const created = await createParticipant(alpha);
    await fetch(
      `${baseUrl}/admin/participants/${created.userId}/disabled`,
      asAdmin(alpha, { method: "POST", body: JSON.stringify({ disabled: true }) }),
    );

    const response = await fetch(`${baseUrl}/auth/participant/sign-in`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-ds-project": alpha.projectSlug },
      body: JSON.stringify({
        email: created.email,
        password: created.temporaryPassword,
      }),
    });
    expect(response.status).toBe(401);
  });

  it("ends the sessions they already had", async () => {
    // Disabling an account while leaving a twelve-hour session open means a
    // compromised account stays usable for the rest of the day — which is the
    // window the button is there to close.
    const created = await createParticipant(alpha);
    const cookie = await signInFor(
      alpha.projectSlug,
      created.email,
      created.temporaryPassword,
    );

    await fetch(
      `${baseUrl}/admin/participants/${created.userId}/disabled`,
      asAdmin(alpha, { method: "POST", body: JSON.stringify({ disabled: true }) }),
    );

    const after = await fetch(`${baseUrl}/courses`, {
      headers: {
        cookie: `${PARTICIPANT_COOKIE}=${cookie}`,
        "x-ds-project": alpha.projectSlug,
      },
    });
    expect(after.status).toBe(401);
  });

  it("lets them back in when re-enabled", async () => {
    const created = await createParticipant(alpha);
    for (const disabled of [true, false]) {
      await fetch(
        `${baseUrl}/admin/participants/${created.userId}/disabled`,
        asAdmin(alpha, { method: "POST", body: JSON.stringify({ disabled }) }),
      );
    }

    await expect(
      signInFor(alpha.projectSlug, created.email, created.temporaryPassword),
    ).resolves.toBeTruthy();
  });
});

describe("resetting a password", () => {
  it("replaces the old one and ends every session", async () => {
    const created = await createParticipant(alpha);
    const oldCookie = await signInFor(
      alpha.projectSlug,
      created.email,
      created.temporaryPassword,
    );

    const reset = await fetch(
      `${baseUrl}/admin/participants/${created.userId}/reset-password`,
      asAdmin(alpha, { method: "POST" }),
    );
    const { temporaryPassword } = (await reset.json()) as { temporaryPassword: string };
    expect(temporaryPassword).not.toBe(created.temporaryPassword);

    // The old session is gone…
    const stale = await fetch(`${baseUrl}/courses`, {
      headers: {
        cookie: `${PARTICIPANT_COOKIE}=${oldCookie}`,
        "x-ds-project": alpha.projectSlug,
      },
    });
    expect(stale.status).toBe(401);

    // …the old password no longer works, and the new one does.
    await expect(
      signInFor(alpha.projectSlug, created.email, created.temporaryPassword),
    ).rejects.toThrow();
    await expect(
      signInFor(alpha.projectSlug, created.email, temporaryPassword),
    ).resolves.toBeTruthy();
  });
});

describe("a participant changing their own password", () => {
  it("accepts a strong one and clears mustChangePassword", async () => {
    const created = await createParticipant(alpha);
    const cookie = await signInFor(
      alpha.projectSlug,
      created.email,
      created.temporaryPassword,
    );
    const chosen = `Eigenes-Passwort-${randomUUID().slice(0, 8)}`;

    const change = await fetch(`${baseUrl}/auth/participant/password`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `${PARTICIPANT_COOKIE}=${cookie}`,
        "x-ds-project": alpha.projectSlug,
      },
      body: JSON.stringify({
        currentPassword: created.temporaryPassword,
        newPassword: chosen,
      }),
    });
    expect(change.status).toBe(204);

    // Signing in with the chosen password no longer demands another change —
    // a forced-change flow that never clears the flag is a wall.
    const response = await fetch(`${baseUrl}/auth/participant/sign-in`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-ds-project": alpha.projectSlug },
      body: JSON.stringify({ email: created.email, password: chosen }),
    });
    expect(await response.json()).toEqual({ mustChangePassword: false });
  });

  it("reports the requirement on /me, so a reload cannot skip it", async () => {
    // The bypass this closes. If `mustChangePassword` lived only in the
    // sign-in response, the portal would show the change screen and F5 would
    // land in the catalogue — the session is already valid and nothing else
    // would object. The requirement has to be re-derivable from the database
    // on every page load, or it is advice.
    const created = await createParticipant(alpha);
    const cookie = await signInFor(
      alpha.projectSlug,
      created.email,
      created.temporaryPassword,
    );

    const me = await fetch(`${baseUrl}/auth/participant/me`, {
      headers: {
        cookie: `${PARTICIPANT_COOKIE}=${cookie}`,
        "x-ds-project": alpha.projectSlug,
      },
    });
    expect(await me.json()).toMatchObject({ mustChangePassword: true });
  });

  it("stops reporting it once the password is the participant's own", async () => {
    const created = await createParticipant(alpha);
    const cookie = await signInFor(
      alpha.projectSlug,
      created.email,
      created.temporaryPassword,
    );

    await fetch(`${baseUrl}/auth/participant/password`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `${PARTICIPANT_COOKIE}=${cookie}`,
        "x-ds-project": alpha.projectSlug,
      },
      body: JSON.stringify({
        currentPassword: created.temporaryPassword,
        newPassword: `Selbst-Gewaehlt-${randomUUID().slice(0, 8)}`,
      }),
    });

    const me = await fetch(`${baseUrl}/auth/participant/me`, {
      headers: {
        cookie: `${PARTICIPANT_COOKIE}=${cookie}`,
        "x-ds-project": alpha.projectSlug,
      },
    });
    expect(await me.json()).toMatchObject({ mustChangePassword: false });
  });

  it("raises the requirement again after an administrator resets", async () => {
    // A reset is the same situation as a fresh account: the password is one an
    // administrator read off a screen. If the flag stayed clear, a reset would
    // leave the administrator's password in place indefinitely.
    const created = await createParticipant(alpha);
    const chosen = `Selbst-Gewaehlt-${randomUUID().slice(0, 8)}`;
    const first = await signInFor(
      alpha.projectSlug,
      created.email,
      created.temporaryPassword,
    );
    await fetch(`${baseUrl}/auth/participant/password`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `${PARTICIPANT_COOKIE}=${first}`,
        "x-ds-project": alpha.projectSlug,
      },
      body: JSON.stringify({
        currentPassword: created.temporaryPassword,
        newPassword: chosen,
      }),
    });

    const reset = await fetch(
      `${baseUrl}/admin/participants/${created.userId}/reset-password`,
      asAdmin(alpha, { method: "POST" }),
    );
    const { temporaryPassword } = (await reset.json()) as { temporaryPassword: string };

    const after = await signInFor(alpha.projectSlug, created.email, temporaryPassword);
    const me = await fetch(`${baseUrl}/auth/participant/me`, {
      headers: {
        cookie: `${PARTICIPANT_COOKIE}=${after}`,
        "x-ds-project": alpha.projectSlug,
      },
    });
    expect(await me.json()).toMatchObject({ mustChangePassword: true });
  });

  it("refuses a new password containing the participant's own address", async () => {
    // The policy is `checkPassword` from `packages/domain`, which checks more
    // than length. A password long enough to pass a client-side hint and still
    // built out of the account's own identifiers is the one a credential-
    // stuffing list opens first.
    const created = await createParticipant(alpha);
    const cookie = await signInFor(
      alpha.projectSlug,
      created.email,
      created.temporaryPassword,
    );

    const local = created.email.split("@")[0]!;
    const change = await fetch(`${baseUrl}/auth/participant/password`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `${PARTICIPANT_COOKIE}=${cookie}`,
        "x-ds-project": alpha.projectSlug,
      },
      body: JSON.stringify({
        currentPassword: created.temporaryPassword,
        newPassword: `${local}-Sicheres-Passwort`,
      }),
    });
    expect(change.status).toBe(422);
  });

  it("refuses without the current password", async () => {
    // A session is a bearer credential. Without this, a cookie captured on a
    // shared clinic computer is enough to lock a physician out of their own
    // CME record.
    const created = await createParticipant(alpha);
    const cookie = await signInFor(
      alpha.projectSlug,
      created.email,
      created.temporaryPassword,
    );

    const change = await fetch(`${baseUrl}/auth/participant/password`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `${PARTICIPANT_COOKIE}=${cookie}`,
        "x-ds-project": alpha.projectSlug,
      },
      body: JSON.stringify({
        currentPassword: "not-the-current-one",
        newPassword: `Etwas-Langes-${randomUUID().slice(0, 8)}`,
      }),
    });
    expect(change.status).toBe(401);
  });

  it("refuses a password shorter than the domain's policy", async () => {
    const created = await createParticipant(alpha);
    const cookie = await signInFor(
      alpha.projectSlug,
      created.email,
      created.temporaryPassword,
    );

    const change = await fetch(`${baseUrl}/auth/participant/password`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `${PARTICIPANT_COOKIE}=${cookie}`,
        "x-ds-project": alpha.projectSlug,
      },
      body: JSON.stringify({
        currentPassword: created.temporaryPassword,
        newPassword: "kurz",
      }),
    });
    expect(change.status).toBe(422);
  });
});
