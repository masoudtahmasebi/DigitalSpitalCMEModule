/**
 * What every seed needs, so that a second one is not a copy of the first
 * (P20-01).
 *
 * ## Why this file exists
 *
 * `adhs.ts` was the only seed, so its connection handling, its non-local
 * refusal, its RLS context and its content-teardown all lived inside it. Adding
 * the DS test tenant would have meant a second copy of each — and the copies
 * that matter are the safety ones. A seed whose "refuse against a non-local
 * database" check was pasted and then edited is a seed that will one day delete
 * a physician's progress on production because somebody widened the host list
 * in one file and not the other.
 *
 * So the guard exists once, the teardown exists once, and a new seed is a data
 * file with a `main` around it.
 *
 * ## What is deliberately not here
 *
 * Anything that decides *content*. This file knows how to open a connection
 * and how to delete a course's tree; it knows nothing about CME points,
 * thresholds or accreditation. Those differ per customer and belong in the
 * seed that states them, where a reviewer can read them beside the requirement
 * they came from.
 */

import { randomBytes } from "node:crypto";
import { hash as argonHash } from "@node-rs/argon2";
import pg from "pg";

/**
 * Open the seeding connection, refusing anything that is not obviously a
 * development database unless the caller insisted.
 *
 * `MIGRATION_DATABASE_URL` and not the application's own: a seed creates the
 * customer row, which no application role may do. It still sets
 * `app.customer_id` per transaction, so every statement passes through the same
 * RLS policies a request does — the alternative, seeding as the superuser,
 * would leave the one script that creates the reference data as the only path
 * never exercising the isolation everything else depends on (ADR-0002).
 */
export function openSeedPool(what: string): pg.Pool {
  const connectionString = process.env["MIGRATION_DATABASE_URL"];
  if (connectionString === undefined) {
    throw new Error("MIGRATION_DATABASE_URL is not set.");
  }

  const force = process.argv.includes("--force");
  const host = new URL(connectionString.replace(/^postgres/, "http")).hostname;
  const isLocal = host === "127.0.0.1" || host === "localhost" || host === "postgres";
  if (!isLocal && !force) {
    throw new Error(
      `Refusing to seed ${what} into a non-local database (${host}). ` +
        "Pass --force if you are certain — it discards learner progress on the " +
        "courses it rebuilds.",
    );
  }

  return new pg.Pool({ connectionString });
}

/**
 * Enter the tenant, transaction-locally, exactly as `runInTenant` does for a
 * request.
 *
 * Called after `BEGIN` and never outside a transaction: `set_config(..., true)`
 * is transaction-scoped, and calling it outside one sets it for the session —
 * which on a pooled connection means the next borrower inherits somebody else's
 * tenant.
 */
export async function enterTenant(pool: pg.Pool, customerId: string): Promise<void> {
  await pool.query("SELECT set_config('app.customer_id', $1, true)", [customerId]);
  await pool.query("SELECT set_config('app.role', 'system', true)");
}

/** Run a statement that must return exactly one `id`, and return it. */
export async function upsert(
  pool: pg.Pool,
  sql: string,
  values: unknown[],
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(sql, values);
  const id = rows[0]?.id;
  if (id === undefined) throw new Error(`seed statement returned no id:\n${sql}`);
  return id;
}

/**
 * Delete a course's whole content tree, child-first.
 *
 * Rebuilt rather than reconciled: content has no stable external key, so a
 * partial update would leave orphans. Child-first because the foreign keys are
 * `RESTRICT` rather than `CASCADE` — deliberately, since in production nothing
 * should be able to delete content that a learner's progress or a quiz attempt
 * still references.
 *
 * **That this deletes such rows at all is why `openSeedPool` refuses a
 * non-local database.** It discards learner data for this course.
 */
export async function resetCourseContent(pool: pg.Pool, courseId: string): Promise<void> {
  const contentScope = `chapter_id IN (
     SELECT c.id FROM chapters c JOIN modules m ON m.id = c.module_id
      WHERE m.course_id = $1)`;

  for (const statement of [
    `DELETE FROM quiz_answers WHERE attempt_id IN (
       SELECT id FROM quiz_attempts WHERE content_id IN (SELECT id FROM contents WHERE ${contentScope}))`,
    `DELETE FROM quiz_attempts WHERE content_id IN (SELECT id FROM contents WHERE ${contentScope})`,
    `DELETE FROM quiz_options WHERE question_id IN (
       SELECT id FROM quiz_questions WHERE content_id IN (SELECT id FROM contents WHERE ${contentScope}))`,
    `DELETE FROM quiz_questions WHERE content_id IN (SELECT id FROM contents WHERE ${contentScope})`,
    `DELETE FROM content_progress WHERE content_id IN (SELECT id FROM contents WHERE ${contentScope})`,
    `UPDATE enrolments SET last_content_id = NULL WHERE course_id = $1`,
    `DELETE FROM contents WHERE ${contentScope}`,
    `DELETE FROM chapters WHERE module_id IN (SELECT id FROM modules WHERE course_id = $1)`,
    `DELETE FROM modules WHERE course_id = $1`,
  ]) {
    await pool.query(statement, [courseId]);
  }
}

/**
 * A 1×1 PNG, for the stamp and signature a certificate cannot render without.
 *
 * Deliberately, obviously not real artwork. Seeding a convincing-looking fake
 * stamp would be worse than seeding an obvious placeholder: somebody would
 * eventually ship it.
 */
export const PLACEHOLDER_IMAGE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

// ---------------------------------------------------------------------------
// The portal channel, and the participant who can walk in through it
// ---------------------------------------------------------------------------

/**
 * The realm on a local credential. Must equal `LOCAL_REALM` in
 * `apps/api/src/auth/local-identity-provider.ts` — it is part of
 * `user_identities`' unique key, and if the two disagree the guard provisions a
 * *second* person on first sign-in, with no membership and therefore a 403.
 *
 * Duplicated rather than imported because `@ds/seed` deliberately does not
 * depend on the API (it runs from a checkout, from the image, and one day from
 * a migration job). `seed.integration.test.ts` asserts the two are equal, so
 * the duplication cannot drift silently.
 */
export const LOCAL_REALM = "ds:local";

/**
 * Argon2id's numeric identifier. The same constant, and the same reasoning, as
 * `apps/api/src/modules/staff/credentials.ts`: the number is fixed by the
 * Argon2 specification (0 = Argon2d, 1 = Argon2i, 2 = Argon2id), so writing it
 * out is safe in a way that inlining a library's enum value would not be.
 */
const ARGON2ID = 2;

/**
 * Decide the demo participant's password, and hash it the way the API verifies.
 *
 * Returns the plaintext as well, because the caller has to print it exactly
 * once — a seeded account whose password nobody knows is an account nobody can
 * use, and the whole point of this one is being able to look at the portal.
 *
 * `SEED_PARTICIPANT_PASSWORD` wins when set, so a re-run against a shared
 * environment does not silently invalidate a password somebody wrote down.
 * Otherwise 24 bytes from the CSPRNG: strong enough that printing it in a
 * deploy log is not a finding, and — because it changes on every run — not a
 * value that can be baked into anything.
 */
export async function participantPassword(): Promise<{
  plaintext: string;
  hash: string;
  supplied: boolean;
}> {
  const supplied = process.env["SEED_PARTICIPANT_PASSWORD"];
  const plaintext =
    supplied !== undefined && supplied !== ""
      ? supplied
      : randomBytes(24).toString("base64url");

  return {
    plaintext,
    hash: await argonHash(plaintext, { algorithm: ARGON2ID }),
    supplied: supplied !== undefined && supplied !== "",
  };
}

/**
 * Give a customer a **second project** whose learners sign in here.
 *
 * ## Why a second project rather than flipping the first one
 *
 * A project is the binding for one *channel*, not for one customer. MEDICE's
 * physicians reach the course through the WordPress plugin, which carries a
 * token from MEDICE's own Keycloak — that binding is correct and must not
 * change. The standalone portal at `fortbildung.digitalspital.com/<slug>` is a
 * different channel, and flipping `medice-adhs.identity_provider` to `'local'`
 * to serve it would break the WordPress path to fix the portal.
 *
 * Both projects belong to the same customer, and the catalogue is scoped by
 * *customer* under RLS, so the two channels show the same courses without the
 * content being seeded twice.
 *
 * ## Why the slug is the customer's
 *
 * The portal reads its tenant from the first path segment and sends it as
 * `X-DS-Project`, so `/medice` looks for a project slugged exactly `medice`.
 * That is why `/medice` answered "Dieses Projekt existiert nicht." — the only
 * project was `medice-adhs`.
 */
export async function seedPortalProject(
  pool: pg.Pool,
  input: { customerId: string; departmentId: string; slug: string; name: string },
): Promise<string> {
  return upsert(
    pool,
    // The Keycloak columns are left NULL, which is what `local` means — this
    // project authenticates a password against our own tables and has no
    // issuer. It used to write `''` into all three, and that placeholder was
    // load-bearing by accident: `ProjectBindingRepository.resolve` refused any
    // project with a NULL issuer, so a `local` project created through the
    // *console* — which writes NULL — could not authenticate anybody, while
    // this seeded one could. The refusal is now scoped to federating providers,
    // so the placeholder has nothing left to hide and is gone.
    //
    // The `DO UPDATE` clears them too, so re-running the seed repairs a row
    // written by the old version rather than leaving two spellings of absent in
    // the same table.
    `INSERT INTO projects
       (customer_id, department_id, slug, name, identity_provider)
     VALUES ($1,$2,$3,$4,'local')
     ON CONFLICT (department_id, slug) DO UPDATE
       SET name = EXCLUDED.name,
           identity_provider = 'local',
           keycloak_issuer = NULL,
           keycloak_audience = NULL,
           keycloak_realm = NULL,
           updated_at = now()
     RETURNING id`,
    [input.customerId, input.departmentId, input.slug, input.name],
  );
}

/**
 * A participant who can sign in at the portal with an e-mail and a password.
 *
 * ## The password is never in this repository
 *
 * It comes from `SEED_PARTICIPANT_PASSWORD`, or is generated from the CSPRNG
 * and returned so the caller can print it exactly once. A literal in a seed
 * file is a credential in git history that outlives every rotation, and on a
 * platform where an account is a CME record it is a credential that can earn
 * points in somebody's name.
 *
 * ## `must_change` stays false here, now for a different reason
 *
 * It was false because there was no password-change screen and a flag
 * demanding one the portal could not offer is worse than no flag. P21-04 built
 * the screen, so that reason is gone — and this stays `false` anyway, because
 * the *purpose* of these two accounts changed nothing: they exist so somebody
 * can open `/medice` and look at it. An account that demands a new password
 * before showing anything is an account that cannot be used for a two-minute
 * check of the layout.
 *
 * Anything an administrator creates through the console gets `must_change`
 * **true**, unconditionally and not configurably (`ParticipantRepository`).
 * That is the path a real physician arrives by.
 *
 * Idempotent on the e-mail: re-running resets the password rather than adding a
 * second account, which also means a forgotten demo password is one re-run
 * away from fixed.
 */
export async function seedParticipant(
  pool: pg.Pool,
  input: {
    customerId: string;
    email: string;
    firstName: string;
    lastName: string;
    /** Argon2id, computed by the caller — `@ds/seed` holds no crypto policy. */
    passwordHash: string;
  },
): Promise<{ userId: string }> {
  // `users` is global, not tenant-scoped: a person may learn with several
  // customers, and the row that says *which* is `user_customers` below.
  const userId = await upsert(
    pool,
    `WITH existing AS (
       SELECT u.id FROM users u
         JOIN user_identities i ON i.user_id = u.id
        WHERE i.provider = 'local' AND i.realm = $4 AND i.subject = $1
        LIMIT 1
     ), created AS (
       INSERT INTO users (email, first_name, last_name)
       SELECT $1, $2, $3 WHERE NOT EXISTS (SELECT 1 FROM existing)
       RETURNING id
     ), updated AS (
       UPDATE users SET email = $1, first_name = $2, last_name = $3, updated_at = now()
        WHERE id = (SELECT id FROM existing)
       RETURNING id
     )
     SELECT id FROM created UNION ALL SELECT id FROM updated`,
    [input.email, input.firstName, input.lastName, LOCAL_REALM],
  );

  // The credential. `subject` is the e-mail rather than the user id because the
  // sign-in resolves by e-mail and the guard then provisions by subject; using
  // the id would mean those two agree only by a join nobody would notice
  // breaking.
  const identityId = await upsert(
    pool,
    `INSERT INTO user_identities (user_id, provider, realm, subject)
     VALUES ($1, 'local', $2, $3)
     ON CONFLICT (provider, realm, subject) DO UPDATE SET user_id = EXCLUDED.user_id
     RETURNING id`,
    [userId, LOCAL_REALM, input.email],
  );

  await pool.query(
    `INSERT INTO learner_credentials (user_identity_id, password_hash, must_change)
     VALUES ($1, $2, false)
     ON CONFLICT (user_identity_id) DO UPDATE
       SET password_hash = EXCLUDED.password_hash,
           must_change = false,
           failed_attempts = 0,
           locked_until = NULL,
           updated_at = now()`,
    [identityId, input.passwordHash],
  );

  // Membership, then the grant. Both are needed and they answer different
  // questions: `user_customers` is *whether this person learns with this
  // customer*, `user_roles` is *what they may do there*. `resolveTenantContext`
  // reads the second; a participant with neither signs in and is refused with a
  // 403 that names a user id nobody recognises.
  await pool.query(
    `INSERT INTO user_customers (user_id, customer_id) VALUES ($1,$2)
     ON CONFLICT (user_id, customer_id) DO NOTHING`,
    [userId, input.customerId],
  );
  // `NOT EXISTS` rather than `ON CONFLICT`, and the difference is not cosmetic.
  // `user_roles`' unique key includes `department_id`, which is NULL for a
  // customer-wide grant — and in PostgreSQL two NULLs are distinct, so the
  // constraint never fires and `ON CONFLICT DO NOTHING` would insert a fresh
  // duplicate row on every re-run.
  await pool.query(
    `INSERT INTO user_roles (user_id, role, customer_id)
     SELECT $1,'learner',$2
      WHERE NOT EXISTS (
        SELECT 1 FROM user_roles
         WHERE user_id = $1 AND role = 'learner'
           AND customer_id = $2 AND department_id IS NULL)`,
    [userId, input.customerId],
  );

  return { userId };
}
