/**
 * What a seed asks before it writes anything (P43-02).
 *
 * ## The report this came from
 *
 * ```
 * Seeding the DS tenant failed: new row for relation "projects"
 *   violates check constraint "projects_identity_provider_check"
 * ```
 *
 * A true sentence about the wrong thing. The value `'local'` has been legal
 * since `0030_local_participants`; the constraint refusing it was written by
 * `0019`, and it was still there because that host's last successful deploy —
 * the only thing that runs migrations — predated the migration. The seed is
 * innocent, the schema is eleven versions behind the image writing to it, and
 * nothing said so.
 *
 * `pendingMigrations` is the question that turns that into a sentence naming
 * the gap. These tests are about the two answers that must not be confused:
 * **nothing pending** on a fully migrated database, and **everything pending**
 * on one that has never been migrated at all — because a fresh database has no
 * `schema_migrations` table, and the naive implementation of this function
 * raises `relation "schema_migrations" does not exist`, which is one more
 * unhelpful error in exactly the position the helpful one was supposed to go.
 */

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { attachClientErrorHandler } from "@ds/postgres";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pendingMigrations, runMigrations } from "../src/index.js";

const SUPERUSER = process.env["POSTGRES_SUPERUSER_URL"];

async function createDatabase(): Promise<{ url: string; drop: () => Promise<void> }> {
  const name = `ds_pending_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Client({ connectionString: SUPERUSER });
  attachClientErrorHandler(admin);
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();

  const url = new URL(SUPERUSER ?? "");
  url.pathname = `/${name}`;

  return {
    url: url.toString(),
    drop: async () => {
      const cleaner = new pg.Client({ connectionString: SUPERUSER });
      attachClientErrorHandler(cleaner);
      await cleaner.connect();
      await cleaner.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await cleaner.end();
    },
  };
}

describe.runIf(SUPERUSER !== undefined && SUPERUSER !== "")("pendingMigrations", () => {
  let db: { url: string; drop: () => Promise<void> };
  let dir: string;

  beforeEach(async () => {
    db = await createDatabase();
    dir = await mkdtemp(join(tmpdir(), "ds-pending-"));
  });

  afterEach(async () => {
    await db.drop();
  });

  async function writeMigration(name: string, body: string): Promise<void> {
    await writeFile(join(dir, name), `BEGIN;\n${body}\nCOMMIT;\n`, "utf8");
  }

  it("reports every migration on a database that has never been migrated", async () => {
    await writeMigration("0001_first.sql", "CREATE TABLE t (a text);");
    await writeMigration("0002_second.sql", "ALTER TABLE t ADD COLUMN b text;");

    // No `schema_migrations` table exists yet. This is the case that has to
    // answer rather than throw: it is the state of a brand-new installation,
    // and a seed run against it must be refused with a sentence, not a
    // `relation does not exist`.
    expect(
      await pendingMigrations({ connectionString: db.url, migrationsDir: dir }),
    ).toEqual(["0001_first.sql", "0002_second.sql"]);
  });

  it("reports nothing once they have all been applied", async () => {
    await writeMigration("0001_first.sql", "CREATE TABLE t (a text);");
    await runMigrations({ connectionString: db.url, migrationsDir: dir });

    expect(
      await pendingMigrations({ connectionString: db.url, migrationsDir: dir }),
    ).toEqual([]);
  });

  it("reports exactly the gap when the code is ahead of the database", async () => {
    await writeMigration("0001_first.sql", "CREATE TABLE t (a text);");
    await runMigrations({ connectionString: db.url, migrationsDir: dir });

    // The deployment's shape: the database was migrated by an older image, and
    // a newer one is now trying to seed it.
    await writeMigration("0002_second.sql", "ALTER TABLE t ADD COLUMN b text;");
    await writeMigration("0003_third.sql", "ALTER TABLE t ADD COLUMN c text;");

    expect(
      await pendingMigrations({ connectionString: db.url, migrationsDir: dir }),
    ).toEqual(["0002_second.sql", "0003_third.sql"]);
  });

  it("ignores files that are not migrations", async () => {
    await writeMigration("0001_first.sql", "CREATE TABLE t (a text);");
    await runMigrations({ connectionString: db.url, migrationsDir: dir });
    await writeFile(join(dir, "README.md"), "not a migration\n", "utf8");

    expect(
      await pendingMigrations({ connectionString: db.url, migrationsDir: dir }),
    ).toEqual([]);
  });
});
