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
