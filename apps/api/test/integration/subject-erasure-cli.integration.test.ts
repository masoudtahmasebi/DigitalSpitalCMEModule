/**
 * A statutory erasure is never blocked by a diagnostic (P149-02).
 *
 * ## The decision this encodes
 *
 * P148-03 found that `subject-erasure.ts` does not assert schema freshness,
 * though `schema-freshness.ts`'s own header names "the erasure tool". A human
 * decided it should — **but that it must never refuse an erasure**:
 *
 * > If the schema check fails (stale schema, or the check itself errors for any
 * > reason — connection failure, permission error, etc.): log a clear,
 * > high-visibility warning and PROCEED WITH THE ERASURE ANYWAY. The erasure
 * > must never be delayed or refused because of this check, given the statutory
 * > one-month deadline.
 *
 * This is the mirror image of `bootstrap-admin`, which fails **closed** on the
 * same check (P149-01) because nothing downstream of it is time-critical. Same
 * check, opposite failure mode, and the reason is the deadline rather than the
 * code.
 *
 * ## Why the check is broken by its credential and not by a stale schema
 *
 * A genuinely stale schema cannot be arranged here without rolling the test
 * database back past a migration, which would break every other suite sharing
 * it. Pointing the reader at a database that refuses the connection exercises
 * the *same* branch — `assertSchemaCurrent` throwing — and is the case the
 * decision explicitly names ("connection failure, permission error, etc.").
 */

import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cpSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { createPool } from "@ds/postgres";
import { requireEnv } from "./support/env.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const SUPERUSER_URL = requireEnv("POSTGRES_SUPERUSER_URL");
const MIGRATION_URL = requireEnv("MIGRATION_DATABASE_URL");

/** Refuses every connection: nothing listens on port 1. */
const UNREACHABLE = "postgres://nobody:nobody@127.0.0.1:1/nothing";

/**
 * A copy of the compiled entrypoints two directories deeper than the real one,
 * so that **neither** path `schema-freshness.ts` looks in exists (P151-01).
 *
 * From `apps/api/build/probe/` its two candidates resolve to
 * `apps/api/build/probe/migrations` and `apps/api/db/migrations`, and there is
 * no such directory either side. `build/` is already gitignored at any depth,
 * which is why the copy lives there rather than beside `dist`.
 */
const PROBE_DIR = join(REPO, "apps/api/build/probe");

let admin: Pool;
let userId: string;
let email: string;

beforeAll(async () => {
  admin = createPool({ connectionString: SUPERUSER_URL });
  email = `erasure-cli-${randomUUID().slice(0, 8)}@example.org`;
  const { rows } = await admin.query<{ id: string }>(
    `INSERT INTO users (email, first_name, last_name)
     VALUES ($1, 'Erase', 'Me') RETURNING id`,
    [email],
  );
  userId = rows[0]!.id;
});

afterAll(async () => {
  await admin.query(`DELETE FROM users WHERE id = $1`, [userId]);
  await admin.end();
});

function runCli(schemaReaderUrl: string) {
  return spawnSync(
    "node",
    [
      "apps/api/dist/subject-erasure.js",
      "--user-id",
      userId,
      "--reason",
      "P149-02 integration test",
      "--confirm",
    ],
    {
      cwd: REPO,
      encoding: "utf8",
      env: {
        ...process.env,
        MIGRATION_DATABASE_URL: MIGRATION_URL,
        SCHEMA_READER_DATABASE_URL: schemaReaderUrl,
      },
    },
  );
}

function runCliFrom(entrypoint: string, subjectId: string, schemaReaderUrl: string) {
  return spawnSync(
    "node",
    [
      entrypoint,
      "--user-id",
      subjectId,
      "--reason",
      "P151-01 integration test",
      "--confirm",
    ],
    {
      cwd: REPO,
      encoding: "utf8",
      env: {
        ...process.env,
        MIGRATION_DATABASE_URL: MIGRATION_URL,
        SCHEMA_READER_DATABASE_URL: schemaReaderUrl,
      },
    },
  );
}

describe("subject-erasure with a schema check that cannot run", () => {
  it("erases anyway, warns loudly, and records that it proceeded", async () => {
    const result = runCli(UNREACHABLE);

    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;

    // 1. The erasure completed. This is the property that must never regress:
    //    a diagnostic may not cost a data subject their statutory right.
    expect(result.status, `the CLI exited non-zero:\n${output}`).toBe(0);

    const { rows } = await admin.query<{ email: string | null }>(
      `SELECT email FROM users WHERE id = $1`,
      [userId],
    );
    expect(rows[0]?.email, "the subject was not erased").not.toBe(email);

    // 2. It said so, loudly, with enough to act on: which subject, what the
    //    check reported, and when.
    expect(output).toMatch(/schema/iu);
    expect(output, "the warning does not name the subject").toContain(userId);
    expect(output, "the warning carries no timestamp").toMatch(
      /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/u,
    );

    // 3. And it is visible after the fact even if the alert was missed — a
    //    row distinct from the ordinary `gdpr.subject.erased` one.
    const audit = await admin.query(
      `SELECT 1 FROM audit_log WHERE action = 'gdpr.erasure_schema_check_failed'`,
    );
    expect(
      audit.rows.length,
      "no audit row records that the erasure proceeded on an unverified schema",
    ).toBeGreaterThan(0);
  }, 60_000);
});

/**
 * The same guarantee, broken a second way — and the way that used to escape it
 * (P151-01).
 *
 * `schemaCheckOutcome()` wraps `assertSchemaCurrent` in a `try`/`catch`, which
 * is what makes a failed check unable to refuse an erasure. That reasoning has
 * one hole in it: a module-evaluation throw happens *before* any caller exists,
 * so no `try`/`catch` in this repository can see it. `MIGRATIONS_DIR` was such a
 * throw — `const MIGRATIONS_DIR = resolveMigrationsDir()` at the top of
 * `schema-freshness.ts` — and with neither candidate directory present the CLI
 * died at `ModuleJob.run` with a stack trace, before `main()` ran at all.
 *
 * The test above cannot see it: it breaks the check through the *credential*,
 * which fails inside `assertSchemaCurrent` where the `catch` is. This one breaks
 * it through the **layout**, which is the case the `catch` never reached.
 *
 * It runs the compiled entrypoint from a directory where both candidate paths
 * miss. On the old code it fails with a non-zero exit and no erasure; on the
 * new one the resolution throw lands inside `schemaCheckOutcome`, so the subject
 * is erased and the warning says why the schema could not be verified.
 */
describe("subject-erasure when the migrations directory cannot be resolved", () => {
  let probeUserId: string;
  let probeEmail: string;

  beforeAll(async () => {
    // Copied rather than symlinked: the resolver reads `import.meta.url`, and a
    // symlinked module still reports its real path.
    cpSync(join(REPO, "apps/api/dist"), PROBE_DIR, { recursive: true });
    // A local build makes no `dist/migrations`; the Dockerfile does (line 216).
    // Removing it unconditionally keeps the test honest wherever it runs.
    rmSync(join(PROBE_DIR, "migrations"), { recursive: true, force: true });

    // Its own subject: the case above erases the shared one, and an erasure of
    // an already-erased subject would exercise a different path entirely.
    probeEmail = `erasure-layout-${randomUUID().slice(0, 8)}@example.org`;
    const { rows } = await admin.query<{ id: string }>(
      `INSERT INTO users (email, first_name, last_name)
       VALUES ($1, 'Layout', 'Probe') RETURNING id`,
      [probeEmail],
    );
    probeUserId = rows[0]!.id;
  });

  afterAll(async () => {
    rmSync(PROBE_DIR, { recursive: true, force: true });
    await admin.query(`DELETE FROM users WHERE id = $1`, [probeUserId]);
  });

  it("erases anyway, and the process reaches its own error handling at all", async () => {
    // A *reachable* reader URL on purpose: the only thing wrong here is the
    // layout, so nothing but the resolution can be what fails.
    const result = runCliFrom(
      join(PROBE_DIR, "subject-erasure.js"),
      probeUserId,
      MIGRATION_URL,
    );

    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;

    // The tell of the old failure, named so a regression is recognisable: the
    // process died during module evaluation, so nothing it printed came from
    // the CLI.
    expect(
      output,
      "the process threw at module load, before main() — the erasure never ran",
    ).not.toMatch(/at ModuleJob\.run/u);

    expect(result.status, `the CLI exited non-zero:\n${output}`).toBe(0);

    const { rows } = await admin.query<{ email: string | null }>(
      `SELECT email FROM users WHERE id = $1`,
      [probeUserId],
    );
    expect(rows[0]?.email, "the subject was not erased").not.toBe(probeEmail);

    expect(output, "the warning does not say the schema was unverified").toMatch(
      /schema/iu,
    );
    expect(output, "the warning does not name the subject").toContain(probeUserId);
  }, 60_000);
});
