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
import { createPool } from "@ds/postgres";

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
