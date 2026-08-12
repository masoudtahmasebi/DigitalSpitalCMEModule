/**
 * The local participant path, end to end over real HTTP (P25-02).
 *
 * ## Why this suite exists
 *
 * `https://fortbildung.digitalspital.com/medice` showed an empty page. The
 * catalogue sits behind the auth guard, the only credential the guard accepted
 * was a JWT from a customer's Keycloak realm, and nobody had one — so an empty
 * page was the *only* possible outcome, and no unit test could have said so,
 * because every one of them stubs the guard or the provider.
 *
 * This drives the whole thing the way a browser does: a password into
 * `POST /auth/participant/sign-in`, a `Set-Cookie` back, and that cookie alone
 * carrying `GET /courses`. Nothing here is mocked but the clock.
 *
 * ## The test that matters most
 *
 * `refuses a session presented against another tenant`. `local-identity-
 * provider.test.ts` already asserts it against a fake lookup, which proves the
 * *check* is written. This proves the check is actually *reached* — that the
 * cookie survives to the provider, that the binding is the one from the header,
 * and that nothing between the two quietly falls back. A cross-tenant read is
 * the failure the whole architecture exists to prevent, and it is worth
 * asserting twice at two different levels.
 */

import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
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

/**
 * A password chosen here, at run time, from a value that is never a secret
 * anywhere else. Not a literal in the file: a plausible-looking password in a
 * repository is a gitleaks finding at best and something somebody reuses at
 * worst.
 */
const PASSWORD = `pw-${randomUUID()}`;

let app: NestExpressApplication;
let baseUrl: string;
let pool: Pool;
let redis: Redis;

/** Two tenants, because one tenant cannot demonstrate isolation. */
let alpha: Tenant;
let beta: Tenant;

interface Tenant {
  readonly customerId: string;
  readonly projectSlug: string;
  readonly courseSlug: string;
  readonly email: string;
}

beforeAll(async () => {
  pool = new Pool({ connectionString: SUPERUSER_URL });
  redis = new Redis(requireEnv("REDIS_URL"), { maxRetriesPerRequest: 3 });
  const passwordHash = await argonHash(PASSWORD, { algorithm: 2 });

  alpha = await seedTenant("alpha", passwordHash);
  beta = await seedTenant("beta", passwordHash);

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
}, 60_000);

/**
 * Clear the sign-in rate limit between tests.
 *
 * Not a workaround — the first run of this suite failed with a string of 429s,
 * which was the limiter working exactly as `rate-limit.ts` says it should:
 * `participantSignIn` allows five a minute per IP, and a suite that signs in a
 * dozen times from 127.0.0.1 is indistinguishable from the guessing attack the
 * limit exists to stop.
 *
 * Resetting per test keeps each one independent, and the limit itself is
 * asserted deliberately in "the rate limit" below rather than being tripped by
 * accident somewhere unrelated.
 */
beforeEach(async () => {
  /*
   * Both buckets this suite can trip, and for the same reason.
   *
   * `staffPasswordReset` allows three a minute per IP — every request here
   * arrives from 127.0.0.1 — and the reset tests below make more than three
   * between them. Left alone, the last one 429s for a reason that has nothing
   * to do with what it is asserting, which is the definition of a test that
   * will be deleted rather than understood.
   *
   * The limits themselves are asserted deliberately in "the rate limit" below,
   * where tripping one is the point.
   */
  const keys = [
    ...(await redis.keys("ratelimit:participantSignIn:*")),
    ...(await redis.keys("ratelimit:staffPasswordReset:*")),
  ];
  if (keys.length > 0) await redis.del(...keys);
});

afterAll(async () => {
  await app?.close();
  await pool?.end();
  redis?.disconnect();
});

/**
 * One tenant, complete: a customer, a department, a project whose
 * `identity_provider` is `local`, a course, and a participant who can sign in.
 *
 * Written out rather than calling `@ds/seed`, on purpose. The seed is a
 * *subject* of this work — using it as the fixture would mean a bug in it and a
 * matching bug here cancel out, and the suite would pass while the thing the
 * user is asking to look at stayed broken.
 */
async function seedTenant(label: string, passwordHash: string): Promise<Tenant> {
  const suffix = randomUUID().slice(0, 8);
  const email = `${label}-${suffix}@example.org`;

  const customerId = await one(
    "INSERT INTO customers (slug, name) VALUES ($1,$2) RETURNING id",
    [`participant-${label}-${suffix}`, `Participant ${label} GmbH`],
  );
  const departmentId = await one(
    "INSERT INTO departments (customer_id, slug, name) VALUES ($1,'default','Default') RETURNING id",
    [customerId],
  );
  const projectSlug = `participant-${label}-${suffix}`;
  // No `keycloak_issuer`, no `keycloak_audience` — exactly what the console
  // writes for a `local` project, and what a local project means.
  //
  // This fixture used to insert `''` into both, and that is the only reason the
  // whole suite passed while the product was broken: `resolve_project_binding`
  // was refused for a NULL issuer, so every console-created local project
  // answered 401 on the request *after* a successful sign-in, while this
  // placeholder-carrying one worked. A fixture that writes a value production
  // never writes is a suite that tests a system nobody runs.
  const projectId = await one(
    `INSERT INTO projects
       (customer_id, department_id, slug, name, identity_provider)
     VALUES ($1,$2,$3,$4,'local') RETURNING id`,
    [customerId, departmentId, projectSlug, `Participant ${label}`],
  );

  const courseSlug = `course-${label}-${suffix}`;
  await pool.query(
    `INSERT INTO courses (customer_id, project_id, slug, title,
                          required_watch_percent, pass_threshold_percent, status)
     VALUES ($1,$2,$3,$4,100,70,'published')`,
    [customerId, projectId, courseSlug, `Kurs ${label}`],
  );

  const userId = await one(
    "INSERT INTO users (email, first_name, last_name) VALUES ($1,'Demo','Teilnehmende') RETURNING id",
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
    [identityId, passwordHash],
  );
  await pool.query("INSERT INTO user_customers (user_id, customer_id) VALUES ($1,$2)", [
    userId,
    customerId,
  ]);
  await pool.query(
    "INSERT INTO user_roles (user_id, role, customer_id) VALUES ($1,'learner',$2)",
    [userId, customerId],
  );

  return { customerId, projectSlug, courseSlug, email };
}

async function one(sql: string, values: unknown[]): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(sql, values);
  const id = rows[0]?.id;
  if (id === undefined) throw new Error(`fixture statement returned no id:\n${sql}`);
  return id;
}

// ---------------------------------------------------------------------------
// Driving it the way a browser does
// ---------------------------------------------------------------------------

async function signIn(
  tenant: Tenant,
  overrides: { email?: string; password?: string } = {},
): Promise<Response> {
  return fetch(`${baseUrl}/auth/participant/sign-in`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-ds-project": tenant.projectSlug },
    body: JSON.stringify({
      email: overrides.email ?? tenant.email,
      password: overrides.password ?? PASSWORD,
    }),
  });
}

/**
 * The cookie value out of `Set-Cookie`, or `undefined`.
 *
 * Parsed rather than assumed, because the attributes are part of what this
 * suite asserts — a session cookie that is not `HttpOnly` is a session a
 * cross-site scripting bug can steal, and that is worth failing a build over.
 */
function sessionCookie(response: Response): string | undefined {
  const header = response.headers
    .getSetCookie()
    .find((c) => c.startsWith(PARTICIPANT_COOKIE));
  const value = header?.split(";")[0]?.split("=")[1];
  return value === undefined || value === "" ? undefined : value;
}

/** A problem document minus the field that is supposed to be unique per call. */
async function withoutCorrelation(response: Response): Promise<unknown> {
  const { correlationId: _ignored, ...rest } = (await response.json()) as Record<
    string,
    unknown
  >;
  return rest;
}

function withCookie(token: string, projectSlug: string): RequestInit {
  return {
    headers: {
      cookie: `${PARTICIPANT_COOKIE}=${token}`,
      "x-ds-project": projectSlug,
    },
  };
}

// ---------------------------------------------------------------------------

describe("signing in and seeing a catalogue", () => {
  it("mints a session and returns the tenant's courses", async () => {
    // The whole point of the ticket, in one test: a password goes in and the
    // customer's courses come out, with nothing but a cookie in between.
    const response = await signIn(alpha);
    expect(response.status).toBe(200);

    const token = sessionCookie(response);
    expect(token).toBeDefined();

    const courses = await fetch(
      `${baseUrl}/courses`,
      withCookie(token!, alpha.projectSlug),
    );
    expect(courses.status).toBe(200);

    const body = (await courses.json()) as { items: Array<{ slug: string }> };
    expect(body.items.map((c) => c.slug)).toContain(alpha.courseSlug);
  });

  it("answers /auth/participant/me for the session it just minted", async () => {
    // The portal's "am I still signed in?" — and the route that a real browser
    // run found returning **403** after a perfectly good sign-in, because the
    // handler declared no `@Roles` and `RolesGuard` fails closed. Everything
    // else worked; the page just showed the login form for ever.
    //
    // Asserted separately from `/courses` because the two fail for different
    // reasons and a passing catalogue call hid this one completely.
    const token = sessionCookie(await signIn(alpha));

    const me = await fetch(
      `${baseUrl}/auth/participant/me`,
      withCookie(token!, alpha.projectSlug),
    );
    expect(me.status).toBe(200);

    const body = (await me.json()) as { customerId: string; role: string };
    expect(body.customerId).toBe(alpha.customerId);
    expect(body.role).toBe("learner");
  });

  it("names the account it is a session for, in terms the person recognises", async () => {
    /*
     * P54-01. `userId` and `customerId` are ours and mean nothing to a
     * physician looking at a header; the address they signed in with is the
     * one thing that answers "which account is this". `subject` is the
     * identity provider's `sub`, which is what a support conversation about a
     * federated sign-in has to quote.
     *
     * Both are the session's own — there is no parameter here — so the case
     * that matters is the one below it: another tenant's session still gets
     * 401 rather than somebody else's address.
     */
    const token = sessionCookie(await signIn(alpha));

    const me = await fetch(
      `${baseUrl}/auth/participant/me`,
      withCookie(token!, alpha.projectSlug),
    );

    const body = (await me.json()) as { email?: string; subject?: string };
    expect(body.email).toBe(alpha.email);
    expect(body.subject).toBeTypeOf("string");
    expect(body.subject).not.toBe("");
  });

  it("does not answer /me for a session from another tenant", async () => {
    const token = sessionCookie(await signIn(alpha));
    const crossed = await fetch(
      `${baseUrl}/auth/participant/me`,
      withCookie(token!, beta.projectSlug),
    );
    expect(crossed.status).toBe(401);
  });

  it("sets the cookie HttpOnly, SameSite=Lax and path-wide", async () => {
    // `httpOnly` is the one that matters: it is what stops an XSS bug on the
    // portal from reading the session out of `document.cookie`, which is
    // precisely what a token in `localStorage` would allow.
    const header = (await signIn(alpha)).headers
      .getSetCookie()
      .find((c) => c.startsWith(PARTICIPANT_COOKIE));

    expect(header).toMatch(/HttpOnly/i);
    expect(header).toMatch(/SameSite=Lax/i);
    expect(header).toMatch(/Path=\//i);
  });

  it("never puts the session token in the response body", async () => {
    // The token belongs in the cookie and nowhere else. A copy in the body is
    // a copy script can read, which undoes `httpOnly` entirely.
    const response = await signIn(alpha);
    const token = sessionCookie(response);
    expect(JSON.stringify(await response.json())).not.toContain(token);
  });
});

describe("the tenant boundary, over the wire", () => {
  it("refuses a session presented against another tenant", async () => {
    // The one that matters. Without the project check in
    // `LocalIdentityProvider`, this returns beta's catalogue to alpha's
    // participant — and RLS would scope it faithfully, so nothing downstream
    // could tell it was wrong.
    const token = sessionCookie(await signIn(alpha));
    expect(token).toBeDefined();

    const crossed = await fetch(
      `${baseUrl}/courses`,
      withCookie(token!, beta.projectSlug),
    );
    expect(crossed.status).toBe(401);
  });

  it("does not leak the other tenant's courses in the refusal", async () => {
    const token = sessionCookie(await signIn(alpha));
    const crossed = await fetch(
      `${baseUrl}/courses`,
      withCookie(token!, beta.projectSlug),
    );

    expect(await crossed.text()).not.toContain(beta.courseSlug);
  });

  it("gives each tenant only its own courses", async () => {
    const betaToken = sessionCookie(await signIn(beta));
    const response = await fetch(
      `${baseUrl}/courses`,
      withCookie(betaToken!, beta.projectSlug),
    );

    const body = (await response.json()) as { items: Array<{ slug: string }> };
    const slugs = body.items.map((c) => c.slug);
    expect(slugs).toContain(beta.courseSlug);
    expect(slugs).not.toContain(alpha.courseSlug);
  });
});

describe("refusals", () => {
  it("refuses a wrong password", async () => {
    const response = await signIn(alpha, { password: "not-the-password" });
    expect(response.status).toBe(401);
    expect(sessionCookie(response)).toBeUndefined();
  });

  it("refuses an unknown address with the same answer as a wrong password", async () => {
    // Identical bodies, not merely identical statuses. A different `detail`
    // between the two is an account-enumeration oracle any script can read,
    // and the list it builds is a list of physicians.
    const unknown = await signIn(alpha, { email: `nobody-${randomUUID()}@example.org` });
    const wrong = await signIn(alpha, { password: "not-the-password" });

    expect(unknown.status).toBe(wrong.status);
    // `correlationId` is per-request by design and is the one field that must
    // differ — it is what makes the two findable in the log separately.
    expect(await withoutCorrelation(unknown)).toEqual(await withoutCorrelation(wrong));
  });

  it("refuses a participant of one tenant signing in at another", async () => {
    // alpha's participant exists, and their password is right — but they have
    // no membership with beta. `findParticipant` joins `user_customers`, so
    // this must not authenticate.
    const response = await signIn(beta, { email: alpha.email });
    expect(response.status).toBe(401);
  });

  it("refuses a session after sign-out", async () => {
    const token = sessionCookie(await signIn(alpha));

    const out = await fetch(`${baseUrl}/auth/participant/sign-out`, {
      method: "POST",
      ...withCookie(token!, alpha.projectSlug),
    });
    expect(out.status).toBe(204);

    // Revoked in the database, not merely cleared in the browser. A sign-out
    // that only drops the cookie leaves a live session behind for anybody who
    // captured it.
    const after = await fetch(
      `${baseUrl}/courses`,
      withCookie(token!, alpha.projectSlug),
    );
    expect(after.status).toBe(401);
  });

  it("refuses an expired session", async () => {
    const token = sessionCookie(await signIn(alpha));
    await pool.query(
      "UPDATE learner_sessions SET expires_at = now() - interval '1 second' WHERE token_hash = digest($1,'sha256')",
      [token],
    );

    const after = await fetch(
      `${baseUrl}/courses`,
      withCookie(token!, alpha.projectSlug),
    );
    expect(after.status).toBe(401);
  });

  it("refuses a made-up cookie", async () => {
    const after = await fetch(
      `${baseUrl}/courses`,
      withCookie("not-a-real-session-token", alpha.projectSlug),
    );
    expect(after.status).toBe(401);
  });
});

describe("the rate limit", () => {
  it("stops an online guessing run", async () => {
    // Five a minute, per `rate-limit.ts`. This is the only unauthenticated
    // write on the learner plane, so it is the only door a credential-stuffing
    // script can knock on — and the persisted lockout behind it only helps once
    // the attacker has found a real address.
    const statuses: number[] = [];
    for (let i = 0; i < 8; i += 1) {
      statuses.push((await signIn(alpha, { password: `guess-${i}` })).status);
    }

    expect(statuses).toContain(429);
    // …and it refuses the *correct* password too while the window is open.
    // A limit that let the right password through would be a limit an attacker
    // could ignore, since getting it right is the whole objective.
    expect((await signIn(alpha)).status).toBe(429);
  });
});

describe("what is stored", () => {
  it("stores the session as a hash, never as the token", async () => {
    // A database dump must not be a set of live sessions. If the token itself
    // were stored, anybody with a backup could resume any participant's
    // session — which is exactly what the backup work in P23-03 makes easy to
    // obtain.
    const token = sessionCookie(await signIn(alpha));

    const { rows } = await pool.query<{ n: string }>(
      "SELECT count(*) AS n FROM learner_sessions WHERE encode(token_hash,'hex') LIKE $1",
      [`%${Buffer.from(token!, "utf8").toString("hex")}%`],
    );
    expect(rows[0]?.n).toBe("0");

    // …and the hash of it is there, so the lookup above was looking for
    // something that could have existed.
    const found = await pool.query<{ n: string }>(
      "SELECT count(*) AS n FROM learner_sessions WHERE token_hash = digest($1,'sha256')",
      [token],
    );
    expect(found.rows[0]?.n).toBe("1");
  });

  it("advances last_seen_at when the session is used", async () => {
    // The test that would have caught a statement broken from the day it
    // shipped. `touch` is best-effort and its failure is deliberately swallowed
    // — a `last_seen_at` write must never turn a valid session into a 401 — so
    // nothing anywhere reports that it did not work. The first version's
    // `$2 - interval '1 minute'` typed the parameter as an interval and failed
    // on every authenticated request; the column simply never moved, and the
    // only trace was ERROR lines in a Postgres log nobody reads.
    //
    // Asserting the *effect* is the only thing that can catch that, which is
    // the general rule for any write whose failure is intentionally ignored.
    const token = sessionCookie(await signIn(alpha));

    // Backdate it well past the one-minute threshold the statement guards with,
    // so this asserts the update rather than the guard.
    await pool.query(
      `UPDATE learner_sessions SET last_seen_at = now() - interval '1 hour'
        WHERE token_hash = digest($1,'sha256')`,
      [token],
    );

    await fetch(`${baseUrl}/courses`, withCookie(token!, alpha.projectSlug));

    // `touch` is fire-and-forget inside the provider, so the write may land
    // just after the response. Poll rather than sleep a fixed amount.
    let moved = false;
    for (let attempt = 0; attempt < 20 && !moved; attempt += 1) {
      const { rows } = await pool.query<{ stale: boolean }>(
        `SELECT last_seen_at < now() - interval '5 minutes' AS stale
           FROM learner_sessions WHERE token_hash = digest($1,'sha256')`,
        [token],
      );
      moved = rows[0]?.stale === false;
      if (!moved) await new Promise((resolve) => setTimeout(resolve, 50));
    }

    expect(moved).toBe(true);
  });

  it("stores the IP as a hash, or not at all", async () => {
    // `docs/gdpr.md` §7: an IP address is personal data. The column answers
    // "was this the same client?" and must not answer "which client".
    const token = sessionCookie(await signIn(alpha));
    const { rows } = await pool.query<{ ip_hash: Buffer | null }>(
      "SELECT ip_hash FROM learner_sessions WHERE token_hash = digest($1,'sha256')",
      [token],
    );

    const stored = rows[0]?.ip_hash;
    if (stored !== null && stored !== undefined) {
      expect(stored.byteLength).toBe(32);
      expect(stored.toString("utf8")).not.toContain("127.0.0.1");
    }
  });

  it("counts failures and clears the count on success", async () => {
    // The lockout is in the database rather than in Redis because a lockout a
    // container restart clears is not a lockout, and this API is restarted by
    // every deploy.
    await signIn(alpha, { password: "wrong-once" });

    const failed = await failedAttempts(alpha.email);
    expect(failed).toBeGreaterThan(0);

    await signIn(alpha);
    expect(await failedAttempts(alpha.email)).toBe(0);
  });
});

async function failedAttempts(email: string): Promise<number> {
  const { rows } = await pool.query<{ failed_attempts: number }>(
    `SELECT c.failed_attempts
       FROM learner_credentials c
       JOIN user_identities i ON i.id = c.user_identity_id
      WHERE i.provider = 'local' AND i.subject = $1`,
    [email],
  );
  return rows[0]?.failed_attempts ?? -1;
}

// ---------------------------------------------------------------------------

/**
 * "Passwort vergessen", on the learner plane (P40-03).
 *
 * The mail cannot be delivered from here — there is no SMTP server — so the
 * seam is the token table: the request writes one when it can send and refuses
 * to when it cannot, and redemption is driven with the value read back out.
 * That is the same shape the flow has in production, minus the transport.
 *
 * What is asserted about the *responses* is mostly that they are identical.
 * Asking whether a given physician has an account with a named pharmaceutical
 * company is close enough to health-adjacent information about a named person
 * that the form must not answer it, and an assertion that two things are the
 * same is the only way to state that.
 */
describe("resetting a forgotten password (P40-03)", () => {
  let tenant: Tenant;

  /*
   * 422, not 400: `AppError.badRequest` builds a `validation` problem and the
   * filter maps it there. Every refusal on the confirm endpoint answers with
   * it — a link that expired, one already spent, one that never existed and a
   * password the policy rejects alike — so the status says nothing a caller
   * could use to tell them apart.
   */
  const REFUSED = 422;

  beforeAll(async () => {
    // The same hash the file-level fixture uses. `seedTenant` takes it as an
    // argument rather than computing one, so that every participant in this
    // suite shares a single Argon2 call — it is the slowest thing here.
    tenant = await seedTenant("reset", await argonHash(PASSWORD, { algorithm: 2 }));
    // A sender on the project, because a project with none cannot deliver and
    // the service declines to mint a token it could never send.
    await pool.query(
      `UPDATE projects
          SET smtp_host = 'smtp.invalid.test', smtp_port = 587,
              smtp_from_address = 'no-reply@invalid.test', smtp_from_name = 'Portal'
        WHERE slug = $1`,
      [tenant.projectSlug],
    );
  }, 30_000);

  async function ask(email: string, projectSlug = tenant.projectSlug): Promise<number> {
    const response = await fetch(`${baseUrl}/auth/participant/password-reset`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-ds-project": projectSlug },
      body: JSON.stringify({ email }),
    });
    return response.status;
  }

  /** The token cannot be read from the mail, so it is read from the row. */
  async function openTokenHashes(): Promise<number> {
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM learner_credential_tokens
        WHERE accepted_at IS NULL AND revoked_at IS NULL`,
    );
    return Number(rows[0]?.n ?? "0");
  }

  it("accepts a request for an address that exists", async () => {
    expect(await ask(tenant.email)).toBe(202);
  });

  it("answers identically for one that does not", async () => {
    expect(await ask(`niemand-${randomUUID().slice(0, 8)}@example.org`)).toBe(202);
  });

  it("wrote a token for the real address and none for the invented one", async () => {
    // The response cannot say which happened, so the database is asked instead
    // — this is the assertion the identical statuses above are hiding.
    expect(await openTokenHashes()).toBe(1);
  });

  it("revokes the previous link when a second is asked for", async () => {
    // A link already in a mailbox — forwarded, quoted in a ticket — stops
    // working the moment a newer one is issued.
    expect(await ask(tenant.email)).toBe(202);
    expect(await openTokenHashes()).toBe(1);

    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM learner_credential_tokens WHERE revoked_at IS NOT NULL`,
    );
    expect(Number(rows[0]?.n ?? "0")).toBe(1);
  });

  it("sets the password, and the participant can sign in with it", async () => {
    const token = await freshToken();

    const confirmed = await confirm(token, "ein-ganz-neues-passwort-2026");
    expect(confirmed).toBe(204);

    const signedIn = await signIn(tenant, { password: "ein-ganz-neues-passwort-2026" });
    expect(signedIn.status).toBe(200);
  });

  it("refuses the same link a second time", async () => {
    // P39-01 on this plane: without the state check a link is a permanent key
    // to the account, replayable by anybody who ever saw the mail.
    const token = await freshToken();
    expect(await confirm(token, "erste-wahl-2026-lang")).toBe(204);
    expect(await confirm(token, "zweite-wahl-2026-lang")).toBe(REFUSED);
  });

  it("refuses a link older than its window", async () => {
    const token = await freshToken();
    // Two hours against RESET_VALID_MINUTES = 60. Moved in the database rather
    // than by mocking a clock: what is under test is the API reading its row.
    await pool.query(
      `UPDATE learner_credential_tokens SET created_at = now() - interval '2 hours'
        WHERE accepted_at IS NULL AND revoked_at IS NULL`,
    );
    expect(await confirm(token, "zu-spaet-2026-lang")).toBe(REFUSED);
  });

  it("refuses a password the policy rejects, without spending the link", async () => {
    const token = await freshToken();
    expect(await confirm(token, "kurz")).toBe(REFUSED);
    // Still usable: a rejected password must not consume a single-use link and
    // strand somebody who simply chose badly the first time.
    expect(await confirm(token, "danach-doch-noch-lang-genug")).toBe(204);
  });

  it("mints nothing for a project whose participants sign in elsewhere", async () => {
    // A federated participant's password is not ours to reset, and offering to
    // would send them a link that cannot work.
    await pool.query(
      "UPDATE projects SET identity_provider = 'keycloak' WHERE slug = $1",
      [tenant.projectSlug],
    );

    const before = await openTokenHashes();
    expect(await ask(tenant.email)).toBe(202);
    expect(await openTokenHashes()).toBe(before);

    await pool.query("UPDATE projects SET identity_provider = 'local' WHERE slug = $1", [
      tenant.projectSlug,
    ]);
  });

  /** Ask for a link and read the token straight back out of the row. */
  async function freshToken(): Promise<string> {
    /*
     * The table stores only a hash, so the value cannot be recovered from it —
     * which is the point of storing a hash. The token is therefore generated
     * here and written in, standing in for the one the mail would have carried.
     * What that still exercises is everything after delivery: the lookup, the
     * state check, the policy, and the write.
     */
    const token = randomUUID().replace(/-/gu, "") + randomUUID().replace(/-/gu, "");
    const hash = createHash("sha256").update(token).digest();

    const { rows } = await pool.query<{ id: string; project_id: string }>(
      `SELECT ui.id, p.id AS project_id
         FROM user_identities ui
         JOIN users u ON u.id = ui.user_id
         JOIN projects p ON p.slug = $2
        WHERE u.email = $1 AND ui.provider = 'local'`,
      [tenant.email, tenant.projectSlug],
    );
    const row = rows[0];
    if (row === undefined)
      throw new Error("no local identity for the seeded participant");

    await pool.query(
      `UPDATE learner_credential_tokens SET revoked_at = now()
        WHERE user_identity_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL`,
      [row.id],
    );
    await pool.query(
      `INSERT INTO learner_credential_tokens (user_identity_id, project_id, token_hash)
       VALUES ($1, $2, $3)`,
      [row.id, row.project_id, hash],
    );

    return token;
  }

  async function confirm(token: string, newPassword: string): Promise<number> {
    const response = await fetch(`${baseUrl}/auth/participant/password-reset/confirm`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ds-project": tenant.projectSlug,
      },
      body: JSON.stringify({ token, newPassword }),
    });
    return response.status;
  }
});
