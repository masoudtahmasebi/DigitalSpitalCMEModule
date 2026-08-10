/**
 * Merging two credentials onto one person (P21-05), end to end.
 *
 * ## Why this cannot be a unit test
 *
 * The merge is one transaction over nine tables on two planes, and every
 * interesting property is a database fact:
 *
 * 1. **Nothing is half-moved.** A refusal must leave both people exactly as
 *    they were, and a success must leave nothing behind. Only a real database
 *    can be asked.
 * 2. **The records follow the enrolment.** `certificates` and `eiv_submissions`
 *    hang off `enrolment_id`, not `user_id` — asserted rather than assumed,
 *    because a merge that moved the enrolment and left the certificate would
 *    produce a PDF in one person's name against another's record and nothing
 *    would have failed.
 * 3. **`super_admin` only.** The guard chain is what enforces it, and a mocked
 *    principal would answer whatever the mock was told to.
 *
 * ## What it deliberately does not test
 *
 * The refusal *rules*. Those are `planCredentialMerge` in `@ds/domain`, tested
 * exhaustively there. What is tested here is that a refusal reaches the caller
 * as a 409 and changes nothing — the wiring, not the verdict.
 */

import { randomUUID } from "node:crypto";
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
process.env["CERTIFICATE_DELIVERY_ENABLED"] = "no";

const PASSWORD = `pw-${randomUUID()}`;

let app: NestExpressApplication;
let baseUrl: string;
let pool: Pool;
let redis: Redis;

let customerId: string;
let projectSlug: string;
let superCookie: string;
let tenantCookie: string;
/** Two courses, so a merge can be arranged with and without an overlap. */
let courseA: string;
let courseB: string;

beforeAll(async () => {
  pool = new Pool({ connectionString: SUPERUSER_URL });
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

  const suffix = randomUUID().slice(0, 8);
  customerId = await one(
    "INSERT INTO customers (slug, name) VALUES ($1,$2) RETURNING id",
    [`merge-${suffix}`, `Merge ${suffix} GmbH`],
  );
  const departmentId = await one(
    "INSERT INTO departments (customer_id, slug, name) VALUES ($1,'default','Default') RETURNING id",
    [customerId],
  );
  projectSlug = `merge-${suffix}`;
  const projectId = await one(
    // No Keycloak columns: that is what `local` means, and what the console
    // writes. See `participant-auth.integration.test.ts` for why `''` here was
    // hiding a real refusal.
    `INSERT INTO projects (customer_id, department_id, slug, name, identity_provider)
     VALUES ($1,$2,$3,$4,'local') RETURNING id`,
    [customerId, departmentId, projectSlug, `Merge ${suffix}`],
  );

  courseA = await seedCourse(projectId, `merge-a-${suffix}`);
  courseB = await seedCourse(projectId, `merge-b-${suffix}`);

  superCookie = await seedOperator("super", "super_admin");
  tenantCookie = await seedOperator("tenant", "customer_admin");
}, 60_000);

afterAll(async () => {
  await app?.close();
  await pool?.end();
  redis?.disconnect();
});

beforeEach(async () => {
  for (const name of ["participantSignIn", "participantCreate"]) {
    const keys = await redis.keys(`ratelimit:${name}:*`);
    if (keys.length > 0) await redis.del(...keys);
  }
});

async function one(sql: string, values: unknown[]): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(sql, values);
  const id = rows[0]?.id;
  if (id === undefined) throw new Error(`fixture returned no id:\n${sql}`);
  return id;
}

async function seedCourse(projectId: string, slug: string): Promise<string> {
  return one(
    `INSERT INTO courses (customer_id, project_id, slug, title, delivery_type,
                          required_watch_percent, pass_threshold_percent)
     VALUES ($1,$2,$3,$4,'on_demand',80,70) RETURNING id`,
    [customerId, projectId, slug, `Kurs ${slug}`],
  );
}

/** A staff-plane operator who signs in through the learner plane, as the
 *  P21-04 suite does — one mechanism rather than two. */
async function seedOperator(label: string, role: string): Promise<string> {
  const email = `${label}-${randomUUID().slice(0, 8)}@example.org`;
  const userId = await createPerson(email);
  await pool.query(
    "INSERT INTO user_roles (user_id, role, customer_id) VALUES ($1,$2,$3)",
    [userId, role, customerId],
  );
  return signIn(email);
}

async function createPerson(email: string): Promise<string> {
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
    [identityId, await argonHash(PASSWORD, { algorithm: 2 })],
  );
  await pool.query("INSERT INTO user_customers (user_id, customer_id) VALUES ($1,$2)", [
    userId,
    customerId,
  ]);
  return userId;
}

async function signIn(email: string): Promise<string> {
  const response = await fetch(`${baseUrl}/auth/participant/sign-in`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-ds-project": projectSlug },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const token = response.headers
    .getSetCookie()
    .find((c) => c.startsWith(PARTICIPANT_COOKIE))
    ?.split(";")[0]
    ?.split("=")[1];
  if (token === undefined || token === "") {
    throw new Error(`sign-in failed for ${email}: ${String(response.status)}`);
  }
  return token;
}

function as(cookie: string, init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: {
      ...init.headers,
      "content-type": "application/json",
      cookie: `${PARTICIPANT_COOKIE}=${cookie}`,
      "x-ds-project": projectSlug,
    },
  };
}

/** A participant with an optional enrolment and an optional EFN. */
async function seedParticipant(options: {
  courseId?: string;
  efn?: string;
}): Promise<{ userId: string; email: string; enrolmentId?: string }> {
  const email = `merge-${randomUUID().slice(0, 8)}@example.org`;
  const userId = await createPerson(email);
  await pool.query(
    "INSERT INTO user_roles (user_id, role, customer_id) VALUES ($1,'learner',$2)",
    [userId, customerId],
  );

  let enrolmentId: string | undefined;
  if (options.courseId !== undefined) {
    enrolmentId = await one(
      // The two thresholds are copied onto the enrolment at enrol time and are
      // NOT NULL, because a gate that could change under a learner mid-course
      // is not a gate. The fixture has to supply them for the same reason.
      `INSERT INTO enrolments (customer_id, user_id, course_id,
                               required_watch_percent, pass_threshold_percent)
       VALUES ($1,$2,$3,80,70) RETURNING id`,
      [customerId, userId, options.courseId],
    );
  }
  if (options.efn !== undefined) {
    await pool.query("INSERT INTO efn_profiles (user_id, efn) VALUES ($1,$2)", [
      userId,
      options.efn,
    ]);
  }
  return enrolmentId === undefined ? { userId, email } : { userId, email, enrolmentId };
}

const count = async (sql: string, values: unknown[]): Promise<number> => {
  const { rows } = await pool.query<{ n: string }>(sql, values);
  return Number(rows[0]?.n ?? "0");
};

function merge(
  cookie: string,
  body: Record<string, unknown>,
  path = "/admin/participants/merge",
): Promise<Response> {
  return fetch(
    `${baseUrl}${path}`,
    as(cookie, { method: "POST", body: JSON.stringify(body) }),
  );
}

// ---------------------------------------------------------------------------

describe("who may merge", () => {
  it("refuses a customer_admin", async () => {
    // Not an oversight. A merge routinely spans two customers, and a
    // customer-scoped administrator is correctly unable to see the other side —
    // so they would be confirming against a record they cannot read.
    const source = await seedParticipant({});
    const target = await seedParticipant({});

    const response = await merge(tenantCookie, {
      sourceUserId: source.userId,
      targetUserId: target.userId,
      confirm: target.userId,
    });

    expect(response.status).toBe(403);
    expect(
      await count("SELECT count(*) AS n FROM users WHERE id = $1", [source.userId]),
    ).toBe(1);
  });
});

describe("the confirmation", () => {
  it("must name the target", async () => {
    const source = await seedParticipant({});
    const target = await seedParticipant({});

    const response = await merge(superCookie, {
      sourceUserId: source.userId,
      targetUserId: target.userId,
      confirm: source.userId,
    });

    // 422, not 400: `AppError.badRequest` maps to the contract's
    // ValidationFailed response, which is what every other malformed payload on
    // this API answers with.
    expect(response.status).toBe(422);
    expect(
      await count("SELECT count(*) AS n FROM users WHERE id = $1", [source.userId]),
    ).toBe(1);
  });
});

describe("a merge that would have to choose", () => {
  it("is refused, and moves nothing, when both are on the same course", async () => {
    const source = await seedParticipant({ courseId: courseA });
    const target = await seedParticipant({ courseId: courseA });

    const response = await merge(superCookie, {
      sourceUserId: source.userId,
      targetUserId: target.userId,
      confirm: target.userId,
    });

    expect(response.status).toBe(409);
    // The effect, not the status. A 409 returned after a partial write would
    // be the worst of both.
    expect(
      await count("SELECT count(*) AS n FROM enrolments WHERE user_id = $1", [
        source.userId,
      ]),
    ).toBe(1);
    expect(
      await count("SELECT count(*) AS n FROM users WHERE id = $1", [source.userId]),
    ).toBe(1);
  });

  it("is refused when the two sides carry different EFNs", async () => {
    const source = await seedParticipant({ efn: "111111111111111" });
    const target = await seedParticipant({ efn: "222222222222222" });

    const response = await merge(superCookie, {
      sourceUserId: source.userId,
      targetUserId: target.userId,
      confirm: target.userId,
    });

    expect(response.status).toBe(409);
    expect(
      await count("SELECT count(*) AS n FROM efn_profiles WHERE user_id = $1", [
        source.userId,
      ]),
    ).toBe(1);
  });
});

describe("a merge that goes through", () => {
  it("moves every credential, membership, enrolment and EFN, and leaves nothing behind", async () => {
    const source = await seedParticipant({ courseId: courseA, efn: "333333333333333" });
    const target = await seedParticipant({ courseId: courseB });

    // A certificate on the source's enrolment. It hangs off `enrolment_id`, so
    // moving the enrolment must carry it — the assertion that made listing the
    // tables in the repository a decision rather than a guess.
    const certificateId = await one(
      `INSERT INTO certificates (customer_id, enrolment_id, participant_name)
       VALUES ($1,$2,'Vor Nach') RETURNING id`,
      [customerId, source.enrolmentId],
    );

    const response = await merge(superCookie, {
      sourceUserId: source.userId,
      targetUserId: target.userId,
      confirm: target.userId,
    });

    expect(response.status).toBe(204);

    expect(
      await count("SELECT count(*) AS n FROM user_identities WHERE user_id = $1", [
        target.userId,
      ]),
    ).toBe(2);
    expect(
      await count("SELECT count(*) AS n FROM enrolments WHERE user_id = $1", [
        target.userId,
      ]),
    ).toBe(2);
    expect(
      await count("SELECT count(*) AS n FROM efn_profiles WHERE user_id = $1", [
        target.userId,
      ]),
    ).toBe(1);

    // The certificate followed its enrolment rather than being orphaned.
    const { rows } = await pool.query<{ user_id: string }>(
      `SELECT e.user_id FROM certificates c JOIN enrolments e ON e.id = c.enrolment_id
        WHERE c.id = $1`,
      [certificateId],
    );
    expect(rows[0]?.user_id).toBe(target.userId);

    // The source person is gone, not left as a nameless row in every future
    // participant list.
    expect(
      await count("SELECT count(*) AS n FROM users WHERE id = $1", [source.userId]),
    ).toBe(0);
  });

  it("ends every session on both sides", async () => {
    // A session was minted for a credential whose person has just changed. The
    // safe answer to "is it still valid?" is no.
    const source = await seedParticipant({});
    const target = await seedParticipant({});
    const sourceCookie = await signIn(source.email);
    await signIn(target.email);

    await merge(superCookie, {
      sourceUserId: source.userId,
      targetUserId: target.userId,
      confirm: target.userId,
    });

    expect(
      await count(
        "SELECT count(*) AS n FROM learner_sessions WHERE user_id = $1 AND revoked_at IS NULL",
        [target.userId],
      ),
    ).toBe(0);

    // And the token itself is refused, not merely marked.
    const me = await fetch(
      `${baseUrl}/auth/participant/me`,
      as(sourceCookie, { method: "GET" }),
    );
    expect(me.status).toBe(401);
  });

  it("records itself in admin_audit_log, in the same transaction", async () => {
    const source = await seedParticipant({});
    const target = await seedParticipant({});

    await merge(superCookie, {
      sourceUserId: source.userId,
      targetUserId: target.userId,
      confirm: target.userId,
    });

    const { rows } = await pool.query<{ detail: Record<string, unknown> }>(
      `SELECT detail FROM admin_audit_log
        WHERE action = 'participant.merge' AND subject_id = $1`,
      [target.userId],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.detail).toMatchObject({
      sourceId: source.userId,
      targetId: target.userId,
    });
    // Ids and counts only. An audit row is read by more people than the record
    // it describes (CLAUDE.md §4 invariant 7).
    expect(JSON.stringify(rows[0]?.detail)).not.toContain("@");
  });
});

describe("the preview", () => {
  it("reports both sides and the verdict, without ever returning an EFN", async () => {
    const source = await seedParticipant({ courseId: courseA, efn: "444444444444444" });
    const target = await seedParticipant({ courseId: courseA });

    const response = await merge(
      superCookie,
      { sourceUserId: source.userId, targetUserId: target.userId },
      "/admin/participants/merge/preview",
    );

    expect(response.status).toBe(201);
    const body = await response.text();
    expect(body).not.toContain("444444444444444");

    const preview = JSON.parse(body) as {
      source: { hasEfn: boolean; enrolledCourseSlugs: string[] };
      target: { hasEfn: boolean };
      plan: { allowed: boolean; refusal?: { reason: string } };
    };
    expect(preview.source.hasEfn).toBe(true);
    expect(preview.target.hasEfn).toBe(false);
    expect(preview.plan.allowed).toBe(false);
    expect(preview.plan.refusal?.reason).toBe("overlapping_courses");

    // Reads only: the preview must not be a merge that reports afterwards.
    expect(
      await count("SELECT count(*) AS n FROM users WHERE id = $1", [source.userId]),
    ).toBe(1);
  });
});
