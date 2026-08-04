/**
 * The developer-facing migration entrypoint — `pnpm db:migrate` (P0-04).
 *
 * The algorithm lives in `@ds/migrator`, not here, and not in a second copy in
 * the API image. See that package's header for why the ledger row is written
 * inside the migration's own transaction and why an advisory lock is held; both
 * are properties a deploy depends on, and neither is something a developer
 * should be able to run a *different* version of.
 *
 * Connects via `MIGRATION_DATABASE_URL` — the `ds_migrator` role, never
 * `ds_app` (ADR-0002). `ds_app` is not the schema owner and cannot create the
 * objects these files define.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrations } from "@ds/migrator";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "migrations");

const connectionString = process.env["MIGRATION_DATABASE_URL"];

if (connectionString === undefined || connectionString === "") {
  console.error("MIGRATION_DATABASE_URL is not set.");
  process.exitCode = 1;
} else {
  const applied = await runMigrations({
    connectionString,
    migrationsDir: MIGRATIONS_DIR,
    log: (message) => console.warn(message),
  });

  console.warn(
    applied.length === 0 ? "Already up to date." : `Applied ${applied.length}.`,
  );
}
