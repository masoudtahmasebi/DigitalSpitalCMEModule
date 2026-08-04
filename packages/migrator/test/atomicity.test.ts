/**
 * Proof that the ledger row and the schema change move together.
 *
 * ## Why this suite is worth its runtime
 *
 * The bug it guards against does not show up in any unit test, because the
 * thing that goes wrong is *where a transaction boundary falls*. You need a
 * real server to observe that, and you need a migration that fails partway to
 * observe it going wrong.
 *
 * The failure mode, once more, because it is what every test below is aimed at:
 * the old runner sent the migration file (which committed itself) and *then*
 * wrote `schema_migrations` in a second statement. Interrupted in between, the
 * database is migrated and the ledger denies it. Every subsequent deploy re-runs
 * the file and dies on a duplicate object, forever, until a human intervenes.
 *
 * `rolls the schema change back when the ledger write fails` is the direct
 * test, and its own comment records why the obvious version of it was not.
 */

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../src/index.js";

const SUPERUSER = process.env["POSTGRES_SUPERUSER_URL"];

/** A throwaway database per test, so a failed migration cannot poison another. */
async function createDatabase(): Promise<{ url: string; drop: () => Promise<void> }> {
  const name = `ds_migrator_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Client({ connectionString: SUPERUSER });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();

  const url = new URL(SUPERUSER ?? "");
  url.pathname = `/${name}`;

  return {
    url: url.toString(),
    drop: async () => {
      const cleaner = new pg.Client({ connectionString: SUPERUSER });
      await cleaner.connect();
      await cleaner.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await cleaner.end();
    },
  };
}

async function query<T extends pg.QueryResultRow>(
  url: string,
  sql: string,
): Promise<T[]> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return (await client.query<T>(sql)).rows;
  } finally {
    await client.end();
  }
}

// Runs only where a real Postgres is configured — CI sets this, and so does
// `.env.example` for local runs.
describe.runIf(SUPERUSER !== undefined && SUPERUSER !== "")("runMigrations", () => {
  let db: { url: string; drop: () => Promise<void> };
  let dir: string;

  beforeEach(async () => {
    db = await createDatabase();
    dir = await mkdtemp(join(tmpdir(), "ds-migrations-"));
  });

  afterEach(async () => {
    await db.drop();
  });

  async function writeMigration(name: string, body: string): Promise<void> {
    await writeFile(join(dir, name), `BEGIN;\n${body}\nCOMMIT;\n`, "utf8");
  }

  it("applies pending migrations in filename order and records each one", async () => {
    await writeMigration("0002_second.sql", "ALTER TABLE t ADD COLUMN b text;");
    await writeMigration("0001_first.sql", "CREATE TABLE t (a text);");

    const applied = await runMigrations({ connectionString: db.url, migrationsDir: dir });

    // 0002 depends on 0001, so a wrong order fails rather than merely reordering.
    expect(applied).toEqual(["0001_first.sql", "0002_second.sql"]);
    expect(
      await query(db.url, "SELECT filename FROM schema_migrations ORDER BY filename"),
    ).toEqual([{ filename: "0001_first.sql" }, { filename: "0002_second.sql" }]);
  });

  it("is a no-op on the second run", async () => {
    await writeMigration("0001_first.sql", "CREATE TABLE t (a text);");
    await runMigrations({ connectionString: db.url, migrationsDir: dir });

    expect(await runMigrations({ connectionString: db.url, migrationsDir: dir })).toEqual(
      [],
    );
  });

  it("does not record a migration that failed", async () => {
    await writeMigration("0001_broken.sql", "CREATE TABLE t (a text);\nSELECT 1 / 0;");

    await expect(
      runMigrations({ connectionString: db.url, migrationsDir: dir }),
    ).rejects.toThrow(/division by zero/);

    const tables = await query<{ count: string }>(
      db.url,
      "SELECT count(*)::text AS count FROM information_schema.tables WHERE table_name = 't'",
    );
    expect(tables[0]?.count, "the half-applied table survived the rollback").toBe("0");

    const ledger = await query(db.url, "SELECT filename FROM schema_migrations");
    expect(ledger, "a failed migration was recorded as applied").toEqual([]);
  });

  it("rolls the schema change back when the ledger write fails", async () => {
    // ## This is the test for the actual bug, and it took two attempts
    //
    // The obvious version — a migration that fails partway — does *not*
    // distinguish the two implementations. Each file carries its own
    // `BEGIN; … COMMIT;`, so when a statement inside it fails, Postgres turns
    // the trailing COMMIT into a rollback and the file's own work disappears
    // either way. That test passes against the broken runner, which is how it
    // was caught: reverting the fix and re-running it changed nothing.
    //
    // What actually differed was narrower: a failure *between* the file's
    // COMMIT and the ledger INSERT — a killed container, a dropped connection,
    // a deploy timeout. To reproduce that deterministically the ledger write
    // itself has to fail, so a trigger makes it fail on demand.
    //
    //   old runner: file COMMITs → INSERT raises → schema changed, ledger empty
    //   this one:   INSERT raises inside the same transaction → both roll back
    //
    // The first outcome is precisely the state this repository's development
    // database was found in, and the one that wedges a production deploy.
    await query(
      db.url,
      `CREATE TABLE schema_migrations (
         filename text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       );
       CREATE FUNCTION refuse() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN RAISE EXCEPTION 'ledger write interrupted'; END $$;
       CREATE TRIGGER refuse_ledger BEFORE INSERT ON schema_migrations
         FOR EACH ROW EXECUTE FUNCTION refuse();`,
    );

    await writeMigration("0001_x.sql", "CREATE TABLE t (a text);");

    await expect(
      runMigrations({ connectionString: db.url, migrationsDir: dir }),
    ).rejects.toThrow(/ledger write interrupted/);

    const tables = await query<{ count: string }>(
      db.url,
      "SELECT count(*)::text AS count FROM information_schema.tables WHERE table_name = 't'",
    );
    expect(
      tables[0]?.count,
      "the schema change committed without its ledger row — the deploy is now wedged",
    ).toBe("0");
  });

  it("retries cleanly after a failure — the deploy is not stuck", async () => {
    // This is the production symptom: fail once, fix the file, run again.
    // If the ledger and the schema had drifted, this second run would die on a
    // duplicate object instead of succeeding.
    await writeMigration("0001_x.sql", "CREATE TABLE t (a text);\nSELECT 1 / 0;");
    await expect(
      runMigrations({ connectionString: db.url, migrationsDir: dir }),
    ).rejects.toThrow();

    await writeMigration("0001_x.sql", "CREATE TABLE t (a text);");

    expect(await runMigrations({ connectionString: db.url, migrationsDir: dir })).toEqual(
      ["0001_x.sql"],
    );
  });

  it("stops at the first failure and leaves later migrations untouched", async () => {
    await writeMigration("0001_ok.sql", "CREATE TABLE a (x text);");
    await writeMigration("0002_broken.sql", "SELECT 1 / 0;");
    await writeMigration("0003_never.sql", "CREATE TABLE c (x text);");

    await expect(
      runMigrations({ connectionString: db.url, migrationsDir: dir }),
    ).rejects.toThrow(/division by zero/);

    // 0001 is committed and recorded; 0003 has not run.
    expect(
      await query(db.url, "SELECT filename FROM schema_migrations ORDER BY filename"),
    ).toEqual([{ filename: "0001_ok.sql" }]);
    expect(
      await query<{ count: string }>(
        db.url,
        "SELECT count(*)::text AS count FROM information_schema.tables WHERE table_name = 'c'",
      ),
    ).toEqual([{ count: "0" }]);
  });

  it("serialises concurrent runners, so a rolling deploy applies each file once", async () => {
    // Two containers starting together. Without the advisory lock both read an
    // empty ledger, both run the file, and the loser fails on "relation already
    // exists" — taking the deploy down.
    await writeMigration("0001_first.sql", "CREATE TABLE t (a text);");

    const results = await Promise.all([
      runMigrations({ connectionString: db.url, migrationsDir: dir }),
      runMigrations({ connectionString: db.url, migrationsDir: dir }),
    ]);

    // Exactly one of them did the work; the other found it already done.
    expect(results.flat()).toEqual(["0001_first.sql"]);
    expect(await query(db.url, "SELECT filename FROM schema_migrations")).toHaveLength(1);
  });

  it("refuses a migration that does not manage its own transaction", async () => {
    await writeFile(join(dir, "0001_bare.sql"), "CREATE TABLE t (a text);\n", "utf8");

    await expect(
      runMigrations({ connectionString: db.url, migrationsDir: dir }),
    ).rejects.toThrow(/0001_bare\.sql/);

    expect(await query(db.url, "SELECT filename FROM schema_migrations")).toEqual([]);
  });
});
