/**
 * Migration runner (P0-04).
 *
 * Applies every `db/migrations/*.sql` file in filename order, exactly once,
 * tracked in `schema_migrations`. Each file is already its own transaction
 * (`BEGIN` … `COMMIT`), so this runner sends the file's text as one
 * multi-statement query rather than wrapping it in a second, redundant
 * transaction.
 *
 * Connects via `MIGRATION_DATABASE_URL` — the `ds_migrator` role, never
 * `ds_app` (ADR-0002). `ds_app` is not the schema owner and cannot create the
 * objects these files define.
 */

import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "migrations");

export async function migrate(connectionString: string): Promise<readonly string[]> {
  const pool = new pg.Pool({ connectionString });

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename    text PRIMARY KEY,
        applied_at  timestamptz NOT NULL DEFAULT now()
      )
    `);

    const files = (await readdir(MIGRATIONS_DIR))
      .filter((name) => name.endsWith(".sql"))
      .sort();

    const { rows: appliedRows } = await pool.query<{ filename: string }>(
      "SELECT filename FROM schema_migrations",
    );
    const applied = new Set(appliedRows.map((row) => row.filename));

    const newlyApplied: string[] = [];

    for (const file of files) {
      if (applied.has(file)) continue;

      // `file` is one of MIGRATIONS_DIR's own readdir() results, not external input.
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const sql = await readFile(join(MIGRATIONS_DIR, file), "utf8");
      await pool.query(sql);
      await pool.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
      newlyApplied.push(file);
    }

    return newlyApplied;
  } finally {
    await pool.end();
  }
}

// Run standalone: pnpm db:migrate
if (process.argv[1]?.endsWith("migrate.ts")) {
  const connectionString = process.env["MIGRATION_DATABASE_URL"];
  if (connectionString === undefined) {
    console.error("MIGRATION_DATABASE_URL is not set.");
    process.exitCode = 1;
  } else {
    const applied = await migrate(connectionString);
    console.warn(
      applied.length === 0 ? "Already up to date." : `Applied: ${applied.join(", ")}`,
    );
  }
}
