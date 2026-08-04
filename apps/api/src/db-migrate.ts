/**
 * The migration entrypoint that ships inside the API image (P10-04).
 *
 * `db/migrate.ts` is the developer-facing runner and needs `tsx`, the
 * workspace and the repository checkout. None of those exist on the production
 * host, where the only artefact is a container — so the image carries its own
 * entrypoint and its own copy of the SQL.
 *
 * It does **not** carry its own algorithm. It used to, with a header claiming
 * the two were "deliberately the same algorithm, not a second one" while being
 * exactly that — and both copies shared a bug that only production could
 * expose (see `@ds/migrator`). There is now one implementation, and this file
 * is the container's `main()` over it: read the environment, call it, report.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrations } from "@ds/migrator";

/** Copied next to the compiled output by the Dockerfile. */
const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "migrations");

async function main(): Promise<void> {
  const connectionString = process.env["MIGRATION_DATABASE_URL"];
  if (connectionString === undefined || connectionString === "") {
    throw new Error("MIGRATION_DATABASE_URL is required (the ds_migrator role)");
  }

  const applied = await runMigrations({
    connectionString,
    migrationsDir: MIGRATIONS_DIR,
    // eslint-disable-next-line no-console -- this is a CLI; its output is the point
    log: (message) => console.log(message),
  });

  // eslint-disable-next-line no-console -- see above
  console.log(
    applied.length === 0
      ? "Already up to date."
      : `Applied ${applied.length} migration(s).`,
  );
}

main().catch((error: unknown) => {
  // The connection string contains a password; the message must not echo it.
  console.error(
    "Migration failed:",
    error instanceof Error ? error.message : "unknown error",
  );
  process.exit(1);
});
