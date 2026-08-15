/**
 * The one migration runner (P10-05).
 *
 * ## Why this package exists
 *
 * There were two runners: `db/migrate.ts` for developers and
 * `apps/api/src/db-migrate.ts` inside the production image, because the image
 * has no repository checkout and no `tsx`. The second one's header said
 * "deliberately the same algorithm, not a second one" — and it was already a
 * second one, differing in its logging, its error handling and its variable
 * names, with nothing to keep the two in step.
 *
 * A migration runner that behaves differently in production from the one
 * developers exercise is discovered on the night it matters. So the algorithm
 * lives here once, and both entrypoints are thin `main()` wrappers over it.
 *
 * ## The bug this package was extracted to fix
 *
 * Both runners did this:
 *
 * ```ts
 * await pool.query(sql);                                   // the file COMMITs
 * await pool.query("INSERT INTO schema_migrations …");      // a second transaction
 * ```
 *
 * Every migration file carries its own `BEGIN; … COMMIT;`, so the ledger write
 * landed in a *separate* transaction from the schema change it recorded. A
 * crash, a killed container, a dropped connection or a deploy timeout in that
 * window leaves the database migrated and the ledger saying otherwise.
 *
 * That is not theoretical. It is the exact state this repository's own
 * development database was found in: `0016_media_sources.sql` fully applied —
 * both columns, both constraints, RLS restored — and no row in
 * `schema_migrations`. The next `db:migrate` re-ran it and died with
 * `42701 column "media_sources" of relation "contents" already exists`.
 *
 * In production that is a failed deploy that no retry can clear, because every
 * retry re-runs the same file and hits the same error. It needs someone with
 * `ds_migrator` credentials to hand-inspect the schema and hand-write a ledger
 * row — at whatever hour the deploy ran.
 *
 * So: **the ledger row is written inside the migration's own transaction.**
 * Either both land or neither does, and a crash at any point is a clean retry.
 *
 * ## How the transaction is taken over
 *
 * The files keep their `BEGIN;` and `COMMIT;`. That is worth preserving — a
 * migration stays runnable by hand with `psql -f`, transactionally, which is
 * how they are read and debugged. But those statements have to be *neutralised*
 * before the runner can add anything to the transaction, because the file's own
 * `COMMIT` would close it before the ledger write.
 *
 * `stripTransactionControl` removes exactly the leading `BEGIN;` and the
 * trailing `COMMIT;` and asserts that both were there. A file that does not
 * follow the convention is rejected by name rather than silently half-run —
 * which is what a naive `.replace()` would do to a file whose author forgot the
 * `COMMIT;`.
 *
 * The runner then owns the transaction:
 *
 * ```
 * BEGIN → body → INSERT INTO schema_migrations → COMMIT
 * ```
 *
 * ## Why the advisory lock
 *
 * Two API containers rolling at once, or a deploy racing a developer's
 * `pnpm db:migrate`, both read the same "not yet applied" set and both run the
 * file. One wins; the other fails on a duplicate object and takes the deploy
 * down with it. `pg_advisory_lock` serialises them, and the applied set is
 * re-read *after* the lock is held so the loser sees the winner's work and does
 * nothing.
 *
 * The lock is session-scoped and taken on a dedicated client, so it survives
 * the per-migration transactions and is released by `finally` — or by the
 * connection dying, which is the property that matters when a container is
 * killed mid-migration.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type pg from "pg";
import { createPool } from "@ds/postgres";

/**
 * Advisory lock key, arbitrary but fixed forever.
 *
 * Advisory locks share one namespace across the whole database, so the value
 * only has to not collide with another subsystem's. Nothing else in this
 * platform takes an advisory lock; the EIV worker claims rows with
 * `FOR UPDATE SKIP LOCKED` instead.
 */
const LOCK_KEY = 8_147_206_531;

export interface MigrationOptions {
  /** `ds_migrator`, never `ds_app` — see ADR-0002. */
  readonly connectionString: string;
  /** Directory holding the ordered `*.sql` files. */
  readonly migrationsDir: string;
  /** Where progress goes. Defaults to silence, which is what tests want. */
  readonly log?: (message: string) => void;
}

/**
 * Apply every pending migration, exactly once, atomically with its ledger row.
 *
 * Returns the filenames applied by *this* call — empty when another process
 * had already applied them, which is the normal result of the second container
 * in a rolling deploy.
 */
export async function runMigrations(
  options: MigrationOptions,
): Promise<readonly string[]> {
  const log = options.log ?? ((): void => {});
  /*
   * `createPool`, never `new pg.Pool` — an idle connection dying is a routine
   * event and an unlistened `'error'` makes it fatal (P76-04). A deploy is
   * precisely when a database restarts under you, so the migrator is the worst
   * place to lose the process to one.
   */
  const pool = createPool({
    connectionString: options.connectionString,
    onIdleError: (error) => {
      log(`postgres connection lost while idle: ${error.message}`);
    },
  });

  try {
    const lockHolder = await pool.connect();
    try {
      // The lock comes first, before even the ledger table exists.
      //
      // `CREATE TABLE IF NOT EXISTS` is **not** race-safe in Postgres: the
      // existence check and the create are not atomic, so two sessions running
      // it together can both pass the check and the loser fails with
      // `duplicate key value violates unique constraint "pg_type_typname_nsp_index"`
      // — an error about a system catalogue, from a statement whose whole point
      // is to be safe to repeat. Two containers in a rolling deploy hit this on
      // the very first deploy, when the table genuinely is absent.
      //
      // An advisory lock needs no table of its own, so it can be taken before
      // anything else and cover the create as well as the migrations.
      //
      // Blocks rather than failing: the other holder is a deploy doing the same
      // work, and waiting for it is the correct behaviour.
      await lockHolder.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);

      try {
        await lockHolder.query(`
          CREATE TABLE IF NOT EXISTS schema_migrations (
            filename    text PRIMARY KEY,
            applied_at  timestamptz NOT NULL DEFAULT now()
          )
        `);

        return await applyPending(pool, options.migrationsDir, log);
      } finally {
        await lockHolder.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]);
      }
    } finally {
      lockHolder.release();
    }
  } finally {
    await pool.end();
  }
}

/**
 * Which migrations this build carries that the database has not applied — the
 * read-only half of `runMigrations` (P43-02).
 *
 * ## Why anything other than the migrator needs to ask
 *
 * Only `deploy.sh` runs migrations. Every *other* image entrypoint —
 * the seeds, the erasure tool — is launched by hand against whatever schema
 * happens to be there, and a schema older than the code fails deep inside a
 * statement, as a constraint name:
 *
 * ```
 * Seeding the DS tenant failed: new row for relation "projects"
 *   violates check constraint "projects_identity_provider_check"
 * ```
 *
 * That is a true sentence about a database eleven migrations behind the image
 * writing to it, and it reads as a bug in the seed. It cost a full debugging
 * round: the value `'local'` has been legal since `0030_local_participants`,
 * and the constraint refusing it was the one `0019` wrote.
 *
 * So the entrypoints ask this first and refuse by *name*: the answer "your
 * database is at 0029 and this image expects 0041" is one an operator can act
 * on, and the constraint violation is not.
 *
 * Returns the pending filenames in application order. An absent
 * `schema_migrations` table means nothing has ever been applied, which is a
 * pending list of everything rather than an error — a fresh database is a
 * legitimate state, just not one a seed may write to.
 */
export async function pendingMigrations(
  options: Pick<MigrationOptions, "connectionString" | "migrationsDir">,
): Promise<readonly string[]> {
  const pool = createPool({ connectionString: options.connectionString });
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- a path from the caller's own configuration, not from a request
    const files = (await readdir(options.migrationsDir))
      .filter((name) => name.endsWith(".sql"))
      .sort();

    // `to_regclass` rather than catching the undefined-table error: this runs
    // on a pool that other statements will reuse, and a failed query inside a
    // transaction would poison it.
    const { rows: ledger } = await pool.query<{ present: string | null }>(
      "SELECT to_regclass('public.schema_migrations')::text AS present",
    );
    // Two spellings of absent, and both mean the same thing here: no row at all
    // (impossible, but the type says so) and a NULL `to_regclass` (the table
    // does not exist).
    const ledgerTable = ledger[0]?.present;
    if (ledgerTable === undefined || ledgerTable === null) return files;

    const { rows } = await pool.query<{ filename: string }>(
      "SELECT filename FROM schema_migrations",
    );
    const applied = new Set(rows.map((row) => row.filename));
    return files.filter((file) => !applied.has(file));
  } finally {
    await pool.end();
  }
}

async function applyPending(
  pool: pg.Pool,
  migrationsDir: string,
  log: (message: string) => void,
): Promise<readonly string[]> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- a path from the caller's own configuration, not from a request
  const files = (await readdir(migrationsDir)).filter((n) => n.endsWith(".sql")).sort();

  // Read *after* the lock: whoever held it before us may have applied some.
  const { rows } = await pool.query<{ filename: string }>(
    "SELECT filename FROM schema_migrations",
  );
  const applied = new Set(rows.map((row) => row.filename));

  const newlyApplied: string[] = [];

  for (const file of files) {
    if (applied.has(file)) continue;

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- see above; `file` is a readdir result
    const sql = await readFile(join(migrationsDir, file), "utf8");
    const body = stripTransactionControl(sql, file);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(body);
      await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
      await client.query("COMMIT");
    } catch (error) {
      // Best-effort: if the failure was the connection itself, the server has
      // already rolled the transaction back.
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }

    log(`Applied: ${file}`);
    newlyApplied.push(file);
  }

  return newlyApplied;
}

/**
 * Remove the file's own `BEGIN;` / `COMMIT;` so the runner can own the
 * transaction, and refuse anything that does not carry both.
 *
 * Line-oriented on purpose. A parser would have to understand dollar-quoted
 * bodies — `0016` ends with a `DO $$ … END $$;` block, and a regex hunting for
 * `COMMIT` inside the whole text is exactly how such a block gets mangled. Only
 * the first and last *significant* lines are considered, and only when they are
 * the bare statement on their own.
 *
 * Removed lines are blanked rather than deleted so that a Postgres error's
 * reported position still lines up with the file a developer opens.
 */
export function stripTransactionControl(sql: string, filename: string): string {
  const lines = sql.split("\n");

  const significant = (line: string): boolean => {
    const trimmed = line.trim();
    return trimmed !== "" && !trimmed.startsWith("--");
  };

  const first = lines.findIndex(significant);
  // Not `findLastIndex`: that is ES2023 and this repository's floor is ES2022
  // (tsconfig.base.json). One package quietly reaching past the shared target
  // is how a build breaks on the one runtime that honours it.
  let last = -1;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (significant(lines[i] ?? "")) {
      last = i;
      break;
    }
  }

  if (first === -1) {
    throw new Error(`${filename}: contains no statements`);
  }

  const isBegin = /^begin\s*;$/i.test(lines[first]?.trim() ?? "");
  const isCommit = /^commit\s*;$/i.test(lines[last]?.trim() ?? "");

  if (!isBegin || !isCommit) {
    throw new Error(
      `${filename}: every migration must open with "BEGIN;" and close with "COMMIT;" ` +
        `so it stays runnable by hand, and so the runner can write the ledger row in ` +
        `the same transaction. Found ${isBegin ? "" : "no leading BEGIN;"}` +
        `${!isBegin && !isCommit ? " and " : ""}${isCommit ? "" : "no trailing COMMIT;"}.`,
    );
  }

  lines[first] = "";
  lines[last] = "";
  return lines.join("\n");
}
