/**
 * Refuse to write to a database older than the code writing to it (P43-02).
 *
 * ## The failure this exists to prevent
 *
 * `deploy.sh` is the only thing that runs migrations. The seeds and the erasure
 * tool are separate entrypoints in the same image, launched by hand through
 * `./dsc`, and nothing connected the two — so a host whose last successful
 * deploy predates a migration runs new seed code against an old schema.
 *
 * What that looks like from the terminal:
 *
 * ```
 * Seeding the DS tenant failed: new row for relation "projects"
 *   violates check constraint "projects_identity_provider_check"
 * ```
 *
 * Every word of which is true and none of which is the problem. The seed writes
 * `identity_provider = 'local'`, legal since `0030_local_participants`; the
 * constraint that refused it was written by `0019`, because the deploy that
 * would have replaced it never ran. The message names the innocent statement,
 * and an operator reasonably reads it as a broken seed — CLAUDE.md §9.9, the
 * repository's state is not the installation's state.
 *
 * ## Why a refusal rather than migrating here
 *
 * A seed that migrated on the way past would be a second migration path, run
 * without the backup `deploy.sh` takes first (`deploy.sh` §3: back up *before*
 * any migration touches it). One command that both seeds and migrates is a
 * command whose blast radius nobody can state.
 *
 * So this answers the question and names the command, and the operator runs it.
 */

import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { pendingMigrations } from "@ds/migrator";

/**
 * Copied next to the compiled output by the Dockerfile — the same directory
 * `db-migrate.ts` applies from, so "pending" here means exactly "pending for
 * the migrator in this image".
 *
 * ## And the repository checkout, when this runs from source (P147-02)
 *
 * `join(dirname(here), "migrations")` is right in the image and wrong
 * everywhere else: run through `tsx` from `apps/api/src/`, it looks for
 * `apps/api/src/migrations`, which has never existed. Nothing noticed because
 * every existing caller is a `dist/` entrypoint — until `bootstrap-admin`
 * started asserting, and the journey suite runs *that* from source.
 *
 * The failure was `ENOENT: scandir '.../apps/api/src/migrations'`, which is
 * §9.9's shape one more time: an error naming the wrong thing. It reads as a
 * missing directory; it is a path that means two different things in two
 * environments.
 *
 * So: the image's directory when it exists, and the checkout's `db/migrations`
 * otherwise. Resolved once, at module load, so a caller cannot get a different
 * answer than the check it is about to run.
 */
const MIGRATIONS_DIR = resolveMigrationsDir();

function resolveMigrationsDir(): string {
  const beside = join(dirname(fileURLToPath(import.meta.url)), "migrations");
  if (existsSync(beside)) return beside;

  // `apps/api/src` → repository root → `db/migrations`. Checked rather than
  // assumed: returning a path that does not exist would move the same ENOENT
  // three lines later and explain nothing.
  const fromCheckout = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
    "db",
    "migrations",
  );
  if (existsSync(fromCheckout)) return fromCheckout;

  throw new Error(
    `schema-freshness: no migrations directory at ${beside} or ${fromCheckout}. ` +
      `In the image they sit beside the compiled output; in a checkout they are ` +
      `db/migrations. Neither is present, so the schema check cannot run.`,
  );
}

/**
 * Read `MIGRATION_DATABASE_URL`, or say which variable is missing.
 *
 * Shared by every entrypoint that connects as `ds_migrator` so the four of them
 * cannot drift on the variable's name — the one before this was three copies of
 * the same four lines, and `./dsc as-migrator` exists because the *fourth* place
 * that needed it (the deployment guide) spelled it wrong for three releases.
 */
export function migrationDatabaseUrl(): string {
  const connectionString = process.env["MIGRATION_DATABASE_URL"];
  if (connectionString === undefined || connectionString === "") {
    throw new Error(
      "MIGRATION_DATABASE_URL is required (the ds_migrator role). " +
        "Run this through `./dsc as-migrator`, which assembles it from the " +
        "host's config.env and secrets.env.",
    );
  }
  return connectionString;
}

/**
 * Throw unless the database has applied every migration this image carries.
 *
 * Called before the first write of any entrypoint that is not the migrator
 * itself. The message names the gap and the command that closes it, because the
 * operator reading it is standing at a terminal on the host and the next thing
 * they need is a line to type.
 */
export async function assertSchemaCurrent(connectionString: string): Promise<void> {
  const pending = await pendingMigrations({
    connectionString,
    migrationsDir: MIGRATIONS_DIR,
  });
  if (pending.length === 0) return;

  const shown = pending.slice(0, 3);
  const rest = pending.length - shown.length;

  throw new Error(
    [
      `this database is ${String(pending.length)} migration(s) behind the image.`,
      "",
      "  pending:  " +
        shown.join("\n            ") +
        (rest > 0 ? `\n            … and ${String(rest)} more` : ""),
      "",
      "  Writing to it would fail somewhere deep in a statement, as a constraint",
      "  name that describes the schema's age rather than anything wrong here.",
      "",
      "  Migrate first — `./deploy.sh` does it after taking a backup, which is",
      "  the supported path. To migrate alone, with no backup and no restart:",
      "",
      "      ./dsc as-migrator dist/db-migrate.js",
    ].join("\n"),
  );
}
