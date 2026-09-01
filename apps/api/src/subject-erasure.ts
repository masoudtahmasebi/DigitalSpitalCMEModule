/**
 * GDPR Art. 17 erasure, as a CLI (P10-10).
 *
 * ## Why a CLI and not an endpoint
 *
 * The data spans tenants. One physician has one EFN and may hold enrolments at
 * several customers, so a `customer_admin` erasing "their" learner would remove
 * an identifier another customer's pending Punktemeldung depends on. Erasure is
 * therefore performed by DigitalSpital as processor, on the controller's
 * documented instruction — a request that arrives as a signed letter, not as a
 * button somebody can click at 17:55 on a Friday.
 *
 * It also means the action needs a role no web request ever holds: the SQL
 * function is `REVOKE ALL ... FROM PUBLIC`, so `ds_app` cannot execute it. The
 * API could not do this if it wanted to.
 *
 * ## What it does
 *
 * `erase_subject` in migration 0009 — pseudonymisation rather than deletion,
 * because the participation record is retained under a legal obligation
 * (Art. 17(3)(b)) while every identifier is removed. The reasoning is in that
 * migration's header and in docs/gdpr.md.
 *
 * ## Usage
 *
 * ```
 * MIGRATION_DATABASE_URL=… node dist/subject-erasure.js --subject <keycloak-sub> --reason "Antrag 2026-07-28" --confirm
 * MIGRATION_DATABASE_URL=… node dist/subject-erasure.js --user-id <uuid> --reason … --confirm
 * ```
 *
 * Without `--confirm` it reports what it would remove and changes nothing.
 * That dry run is not a courtesy: this operation is irreversible by design, and
 * the one mistake worth guarding against is erasing the wrong person because
 * two physicians share a surname.
 */

import pg from "pg";
import type { Pool } from "pg";
import { createPool } from "@ds/postgres";
import { assertSchemaCurrent } from "./schema-freshness.js";
import { withDeadline } from "./shared/deadline-fetch.js";

interface Args {
  subject?: string;
  userId?: string;
  realm?: string;
  reason: string;
  confirm: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { reason: "", confirm: false };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];

    switch (flag) {
      // `value` may be absent when the flag is last. Assigning `undefined`
      // would read as "given but empty" under `exactOptionalPropertyTypes`;
      // a flag with no value is a usage error, caught by the checks below.
      case "--subject":
        if (value !== undefined) args.subject = value;
        i += 1;
        break;
      case "--user-id":
        if (value !== undefined) args.userId = value;
        i += 1;
        break;
      case "--realm":
        if (value !== undefined) args.realm = value;
        i += 1;
        break;
      case "--reason":
        args.reason = value ?? "";
        i += 1;
        break;
      case "--confirm":
        args.confirm = true;
        break;
      default:
        throw new Error(`unknown argument: ${flag}`);
    }
  }

  if (args.subject === undefined && args.userId === undefined) {
    throw new Error("one of --subject <keycloak-sub> or --user-id <uuid> is required");
  }
  if (args.subject !== undefined && args.userId !== undefined) {
    throw new Error("--subject and --user-id are mutually exclusive");
  }
  if (args.reason.trim() === "") {
    // Recorded in the audit row. An erasure with no stated basis is one nobody
    // can account for later, and Art. 5(2) makes accounting for it our problem.
    throw new Error("--reason is required and is recorded in the audit log");
  }

  return args;
}

/** Never prints a name or an email — that is what is being erased. */
interface Preview {
  userId: string;
  alreadyErased: boolean;
  enrolments: number;
  openSubmissions: number;
  freeTextResponses: number;
  hasEfn: boolean;
}

async function preview(pool: pg.Pool, userId: string): Promise<Preview> {
  // Through `preview_subject_erasure`, not with plain SELECTs — see migration
  // 0010. On this connection RLS filters every tenant-scoped count to zero,
  // so a hand-written query here reports a subject with three enrolments and a
  // queued Punktemeldung as having none. The plan a human reads before typing
  // `--confirm` has to see exactly what the erasure will see.
  const { rows } = await pool.query<{
    already_erased: boolean;
    enrolments: number;
    open_submissions: number;
    free_text_responses: number;
    has_efn: boolean;
  }>("SELECT * FROM preview_subject_erasure($1)", [userId]);

  const row = rows[0];
  if (row === undefined) throw new Error(`no such user: ${userId}`);

  return {
    userId,
    alreadyErased: row.already_erased,
    enrolments: row.enrolments,
    openSubmissions: row.open_submissions,
    freeTextResponses: row.free_text_responses,
    hasEfn: row.has_efn,
  };
}

async function resolveUserId(pool: pg.Pool, args: Args): Promise<string> {
  if (args.userId !== undefined) return args.userId;

  // Through `user_identities` since P21-01: a person may hold more than one
  // credential, and `users` no longer carries any of them. `DISTINCT user_id`
  // rather than a plain select, because two credentials belonging to the same
  // person are one answer, not an ambiguity — the ambiguity this refuses is two
  // *different people*.
  const { rows } = await pool.query<{ user_id: string }>(
    args.realm === undefined
      ? "SELECT DISTINCT user_id FROM user_identities WHERE subject = $1"
      : "SELECT DISTINCT user_id FROM user_identities WHERE subject = $1 AND realm = $2",
    args.realm === undefined ? [args.subject] : [args.subject, args.realm],
  );

  if (rows.length === 0) throw new Error("no user matches that subject");
  if (rows.length > 1) {
    // The same `sub` in two realms is possible; erasing the wrong one would be
    // irreversible, so this stops rather than guessing.
    throw new Error(
      "that subject exists in more than one realm — pass --realm to disambiguate",
    );
  }

  return rows[0]!.user_id;
}

/**
 * Ask whether the schema is current, and never let the answer stop an erasure
 * (P149-02).
 *
 * ## The decision, as given
 *
 * P148-03 flagged that this tool does not assert schema freshness while every
 * seed does, and `schema-freshness.ts`'s own header names "the erasure tool".
 * A human decided it should — and that it must **never** refuse:
 *
 * > If the schema check fails … log a clear, high-visibility warning and
 * > PROCEED WITH THE ERASURE ANYWAY. The erasure must never be delayed or
 * > refused because of this check, given the statutory one-month deadline.
 *
 * `bootstrap-admin` runs the same check and fails **closed** (P149-01). The
 * difference is not the code, it is the deadline: nothing downstream of a
 * bootstrap is time-critical, and a data subject's Article 17 right is.
 *
 * ## Why this returns instead of throwing
 *
 * A `try`/`catch` around the call site would work and would be one `return`
 * away from a future edit that lets an exception escape. A function that
 * *cannot* fail makes the guarantee structural: every path here ends in a
 * value, and `main` has nothing to catch.
 */
async function schemaCheckOutcome(): Promise<{ ok: boolean; reason?: string }> {
  const url = process.env["SCHEMA_READER_DATABASE_URL"];
  if (url === undefined || url === "") {
    return {
      ok: false,
      reason:
        "SCHEMA_READER_DATABASE_URL is not set, so schema freshness could not be checked",
    };
  }

  try {
    await assertSchemaCurrent(url);
    return { ok: true };
  } catch (error) {
    // The message only. A connection string carries a password, and this text
    // reaches a log, a webhook and an audit row.
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "unknown error",
    };
  }
}

/**
 * Say that the erasure went ahead on a schema nobody could verify.
 *
 * Three places, because each fails differently: the terminal the operator is
 * standing at, the webhook that reaches somebody who is not, and an
 * append-only row that outlives both. §9.10a — a warning with one audience is
 * a warning nobody receives.
 *
 * Every one of them is best-effort. This function throws nothing: it runs
 * *because* something already went wrong, and turning that into a second
 * failure would take the erasure with it.
 */
async function reportUnverifiedSchema(
  pool: Pool,
  userId: string,
  reason: string,
  now: Date,
): Promise<void> {
  const at = now.toISOString();
  const text =
    `GDPR erasure proceeded on an UNVERIFIED SCHEMA at ${at}. ` +
    `subject=${userId}. The schema check said: ${reason}. ` +
    `The erasure was not delayed — this is by design (P149-02) — but the ` +
    `database may be older than the code that erased against it, so confirm ` +
    `the erasure covered every column the current schema has.`;

  // eslint-disable-next-line no-console -- this is a CLI; its output is the point
  console.error(`\n!! ${text}\n`);

  const webhook = process.env["ALERT_WEBHOOK_URL"];
  if (webhook !== undefined && webhook !== "") {
    try {
      await withDeadline()(webhook, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // The same envelope `EivAlertService` posts, so one receiver can read
        // both without knowing which subsystem spoke.
        body: JSON.stringify({
          source: "ds-education",
          kind: "gdpr_erasure_unverified_schema",
          level: "warning",
          text,
          userId,
          at,
        }),
      });
    } catch {
      // eslint-disable-next-line no-console -- see above
      console.error("!! the alert webhook could not be reached either.");
    }
  }

  try {
    await pool.query(
      `INSERT INTO audit_log (customer_id, actor_id, actor_identity, action, subject, detail)
       VALUES (NULL, NULL, 'system', 'gdpr.erasure_schema_check_failed', $1, $2::jsonb)`,
      [userId, JSON.stringify({ reason, at })],
    );
  } catch (error) {
    // eslint-disable-next-line no-console -- see above
    console.error(
      "!! and the audit row could not be written:",
      error instanceof Error ? error.message : "unknown error",
    );
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const connectionString = process.env["MIGRATION_DATABASE_URL"];
  if (connectionString === undefined || connectionString === "") {
    throw new Error(
      "MIGRATION_DATABASE_URL is required — erasure runs as ds_migrator, never as ds_app",
    );
  }

  // `createPool`, not `new pg.Pool` — see @ds/postgres (P76-04).
  const pool = createPool({ connectionString });

  try {
    const userId = await resolveUserId(pool, args);
    const plan = await preview(pool, userId);

    // eslint-disable-next-line no-console -- this is a CLI; its output is the point
    console.log(JSON.stringify(plan, null, 2));

    if (plan.alreadyErased) {
      // eslint-disable-next-line no-console -- see above
      console.log("Already erased. Nothing to do.");
      return;
    }

    if (plan.openSubmissions > 0) {
      throw new Error(
        `${plan.openSubmissions} Punktemeldung(en) still open. Erasing the EFN now would leave a report that cannot be completed or corrected — wait for the reporting window to close.`,
      );
    }

    if (!args.confirm) {
      // eslint-disable-next-line no-console -- see above
      console.log("Dry run. Re-run with --confirm to erase. This cannot be undone.");
      return;
    }

    /*
     * The schema check, which may warn and may never refuse (P149-02).
     *
     * Placed after `--confirm` so a dry run does not alarm anybody, and before
     * `erase_subject` so the audit row exists even if the erasure itself then
     * fails — an operator reading the log afterwards needs to know the schema
     * was unverified whichever way the next statement went.
     */
    const schema = await schemaCheckOutcome();
    if (!schema.ok) {
      await reportUnverifiedSchema(pool, userId, schema.reason ?? "unknown", new Date());
    }

    const { rows } = await pool.query("SELECT * FROM erase_subject($1, $2)", [
      userId,
      args.reason,
    ]);

    // eslint-disable-next-line no-console -- see above
    console.log("Erased:", JSON.stringify(rows[0]));
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  // The connection string contains a password; the message must not echo it.
  console.error(
    "Erasure failed:",
    error instanceof Error ? error.message : "unknown error",
  );
  process.exit(1);
});
