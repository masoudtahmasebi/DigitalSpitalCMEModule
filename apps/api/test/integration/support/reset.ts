/**
 * Emptying the test database, and putting back what was never tenant data
 * (P32-01, P32-02).
 *
 * Two callers, one implementation: `setup.ts` runs this once before the first
 * test file, and `reset-each-file.ts` runs it before every file. They are the
 * same operation and must stay the same operation — a second truncation list
 * would drift, and the table it forgot would be the one holding the row that
 * makes a suite pass for the wrong reason.
 *
 * ## Why `admin_2fa_policy` is restored rather than spared
 *
 * It is deliberately absent from `TENANT_TABLES`: migration 0027 seeds its
 * platform row (`customer_id IS NULL`), which is ADR-0012's strict default and
 * not something a test created.
 *
 * Leaving it out of the list is **not enough**, and the reason is a genuinely
 * surprising piece of Postgres: `TRUNCATE ... CASCADE` truncates every table
 * that references one being truncated — the *whole table*, not the referencing
 * rows. `admin_2fa_policy.customer_id` has a foreign key to `customers`, so
 * truncating customers empties it completely, platform row included. That is
 * not how `DELETE ... CASCADE` behaves.
 *
 * Nor does re-running the migrations put it back: the ledger says 0027 has
 * applied, so its `INSERT` never runs again. A database truncated once is
 * permanently missing that row unless something restores it, which is how a
 * security default disappears without anybody deciding to remove it.
 */

import { Pool } from "pg";

/**
 * Every table holding tenant or account data, children before parents.
 *
 * `schema_migrations` is deliberately absent: truncating it would make the
 * migrator replay every migration against a schema that already has them.
 */
const TENANT_TABLES = [
  "quiz_answers",
  "quiz_attempts",
  "quiz_options",
  "quiz_questions",
  "evaluation_responses",
  "evaluations",
  "content_progress",
  "contents",
  "chapters",
  "modules",
  "course_experts",
  "certificates",
  "eiv_submissions",
  "enrolments",
  "efn_profiles",
  "courses",
  "projects",
  "departments",
  "user_customers",
  "user_roles",
  "user_identities",
  "learner_credentials",
  "learner_sessions",
  "users",
  "admin_sessions",
  "admin_credential_tokens",
  "admin_user_roles",
  "admin_users",
  "audit_log",
  "admin_audit_log",
  "storage_audit_log",
  "customers",
];

/**
 * The platform's second-factor policy, as migration 0027 establishes it.
 *
 * Duplicated from the migration on purpose and pinned by a test: `hierarchy`
 * asserts the platform starts `required`, and if this and the migration ever
 * disagreed, that test would be checking this file rather than ADR-0012.
 */
const PLATFORM_SECOND_FACTOR = "required";

/**
 * The one destructive operation in the suite, so the refusal lives here.
 *
 * `setup.ts` checks the same thing before the run starts, which is where a
 * misconfiguration should be reported. This is the choke point every truncation
 * passes through regardless of who called it — a guard on the caller is a guard
 * somebody can add a caller around.
 */
function assertLocal(url: string): void {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error("The database URL given to the integration reset is not a valid URL");
  }

  if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
    throw new Error(
      `Refusing to truncate a database on ${host}. ` +
        "The integration suite may only ever point at a local cluster.",
    );
  }
}

/** Empty every tenant table on `url`, then restore the platform configuration. */
export async function resetDatabase(url: string): Promise<void> {
  assertLocal(url);

  const pool = new Pool({ connectionString: url });
  try {
    // One statement, so foreign keys never see a half-empty schema. CASCADE
    // covers anything added since this list was written — the list exists to
    // give a readable order, not to be the only defence.
    await pool.query(
      `TRUNCATE TABLE ${TENANT_TABLES.join(", ")} RESTART IDENTITY CASCADE`,
    );

    await pool.query(
      "INSERT INTO admin_2fa_policy (customer_id, policy) VALUES (NULL, $1)",
      [PLATFORM_SECOND_FACTOR],
    );

    /*
     * The platform's sender, back to how migration 0036 leaves it (P40-01).
     *
     * A singleton outside `TENANT_TABLES` — it belongs to no customer, so the
     * truncation does not reach it — which meant a suite that configured SMTP
     * left it configured for the next run, and "starts empty, and says it
     * cannot send" passed once and never again. Exactly the class of thing
     * P32 exists to stop: an assertion silently encoding whatever the last run
     * happened to do.
     */
    await pool.query(
      `UPDATE platform_smtp
          SET host = NULL, port = NULL, username = NULL, password_enc = NULL,
              secure = false, from_address = NULL, from_name = NULL,
              updated_by = NULL
        WHERE id = true`,
    );
  } finally {
    await pool.end();
  }
}
