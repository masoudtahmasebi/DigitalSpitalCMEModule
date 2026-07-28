/**
 * The migration entrypoint that ships inside the API image (P10-04).
 *
 * `db/migrate.ts` is the developer-facing runner and needs `tsx`, the
 * workspace and the repository checkout. None of those exist on the production
 * host, where the only artefact is a container — so the image carries its own
 * compiled runner and its own copy of the SQL.
 *
 * Deliberately the same algorithm, not a second one: read `migrations/*.sql`
 * in filename order, skip what `schema_migrations` already records, send each
 * file as one multi-statement query because each file is already its own
 * transaction. A production migrator that behaved differently from the one
 * developers run would be discovered on the night it mattered.
 *
 * Connects as `ds_migrator`, never `ds_app` (ADR-0002). `ds_app` is not the
 * schema owner and cannot create these objects — and if it could, RLS would
 * not be the guarantee this platform says it is.
 */

import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

/** Copied next to the compiled output by the Dockerfile. */
const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "migrations");

async function main(): Promise<void> {
  const connectionString = process.env["MIGRATION_DATABASE_URL"];
  if (connectionString === undefined || connectionString === "") {
    throw new Error("MIGRATION_DATABASE_URL is required (the ds_migrator role)");
  }

  const pool = new pg.Pool({ connectionString });

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename    text PRIMARY KEY,
        applied_at  timestamptz NOT NULL DEFAULT now()
      )
    `);

    const files = (await readdir(MIGRATIONS_DIR))
      .filter((n) => n.endsWith(".sql"))
      .sort();

    const { rows } = await pool.query<{ filename: string }>(
      "SELECT filename FROM schema_migrations",
    );
    const applied = new Set(rows.map((row) => row.filename));

    let count = 0;
    for (const file of files) {
      if (applied.has(file)) continue;

      // `file` comes from readdir of a directory baked into the image, not
      // from any request.
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const sql = await readFile(join(MIGRATIONS_DIR, file), "utf8");
      await pool.query(sql);
      await pool.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);

      // eslint-disable-next-line no-console -- this is a CLI; its output is the point
      console.log(`Applied: ${file}`);
      count += 1;
    }

    // eslint-disable-next-line no-console -- see above
    console.log(count === 0 ? "Already up to date." : `Applied ${count} migration(s).`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  // The connection string contains a password; the message must not echo it.
  console.error(
    "Migration failed:",
    error instanceof Error ? error.message : "unknown error",
  );
  process.exit(1);
});
