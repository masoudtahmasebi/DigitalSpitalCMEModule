/**
 * What a freshly migrated installation is pointed at (P188-01).
 *
 * ## Why this is a test and not a line in a migration comment
 *
 * The client's instruction was:
 *
 *   > by default for new customers everything should be set to prod, for
 *   > testing now i will set it to test.
 *
 * That is a shipped default with two properties, and they pull in opposite
 * directions: the register must be the **real** one, and nothing must actually
 * be filed until a named person says so. Getting either wrong is silent.
 *
 * - Default back to `mock` and every new installation ships pointed at a
 *   fiction that somebody has to notice and change, which CLAUDE.md §9.9's
 *   corollary says nobody does.
 * - Default the worker on and a fresh host starts filing statutory
 *   Punktemeldungen against real physicians the moment a course is completed.
 *
 * `eiv-endpoint.test.sh` asserts what the deploy *concludes* from these values.
 * It cannot assert what they **are**, because they are a database fact.
 *
 * ## Why it does not read the installed row
 *
 * It did, and CI caught it — which is the finding worth writing down.
 *
 * `platform_settings` is a **singleton every other suite can write**:
 * `hierarchy.integration.test.ts` drives `PATCH /admin/platform/eiv` through
 * its whole refusal table. Locally the file order put this suite first and it
 * was green; in CI it ran last and read `mock` with another suite's
 * `updated_by` still on the row. A test whose subject is shared mutable state
 * is asserting whatever ran before it — §9.8's "state that outlives a test",
 * one layer out from jsdom.
 *
 * So the state is **made here, not found**, and the rule under test is executed
 * from the shipped migration file rather than restated:
 *
 * | Claim | How it is checked |
 * | --- | --- |
 * | a new row is `live` | the column default, a schema fact no suite can write |
 * | 0051's row becomes `live` | 0053's own `UPDATE`, run against an untouched row |
 * | an operator's choice survives | the same `UPDATE`, run against a touched one |
 *
 * The second and third are the interesting ones and neither is covered by the
 * column default: 0051 inserts its row *before* 0053 runs, so a migration that
 * moved the default and dropped the `UPDATE` would leave every installation on
 * `mock` while the default read `live`. That is the §9.1 shape — a check that
 * covers less than it appears to — and it is why the statement is extracted
 * from the file instead of typed again here (§9.7: a copy would pass on a
 * migration that had it backwards).
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";
import { createPool } from "@ds/postgres";
import { requireEnv } from "./support/env.js";

const SUPERUSER_URL = requireEnv("POSTGRES_SUPERUSER_URL");

const MIGRATION = fileURLToPath(
  new URL(
    "../../../../db/migrations/0053_default_to_the_production_register.sql",
    import.meta.url,
  ),
);

/**
 * 0053's `UPDATE`, read out of the shipped file.
 *
 * Throws rather than skipping when it cannot be found: a migration rewritten so
 * this no longer matches is a migration somebody has to look at, and a test
 * that quietly stopped covering it would be the green gate §9.1 is about.
 */
function shippedUpdate(): string {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- a path built from this file's own URL
  const sql = readFileSync(MIGRATION, "utf8");
  const match = /^UPDATE platform_settings$.*?;$/msu.exec(sql);
  if (match === null) {
    throw new Error(
      `no UPDATE statement found in ${MIGRATION}. If the migration was ` +
        "rewritten, this test has to be rewritten with it — it exists to run " +
        "the shipped rule rather than a copy of it.",
    );
  }
  return match[0];
}

let pool: Pool;

beforeAll(() => {
  pool = createPool({ connectionString: SUPERUSER_URL });
});

afterAll(async () => {
  await pool.end();
});

/**
 * Put the row back the way `resetDatabase` leaves it.
 *
 * This suite writes the singleton, so it puts it back — the courtesy the file
 * that broke this one did not extend, and the reason it broke.
 */
afterEach(async () => {
  await pool.query(
    `UPDATE platform_settings
        SET eiv_worker_enabled = false, eiv_endpoint = DEFAULT,
            eiv_live_confirmed_at = NULL, eiv_live_confirmed_by = NULL,
            updated_by = NULL
      WHERE singleton`,
  );
});

describe("the register a new installation points at (P188-01)", () => {
  it("is the production one for any row the schema creates", async () => {
    const { rows } = await pool.query<{ column_default: string | null }>(
      `SELECT column_default FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'platform_settings'
          AND column_name = 'eiv_endpoint'`,
    );

    // `'live'::text` — Postgres renders a defaulted text literal with its cast.
    expect(rows[0]?.column_default).toContain("live");
  });

  it("moves the row 0051 inserted, which no default can reach", async () => {
    await pool.query(
      `UPDATE platform_settings
          SET eiv_endpoint = 'mock', eiv_worker_enabled = false,
              eiv_live_confirmed_at = NULL, eiv_live_confirmed_by = NULL,
              updated_by = NULL
        WHERE singleton`,
    );

    await pool.query(shippedUpdate());

    const { rows } = await pool.query<{ eiv_endpoint: string }>(
      "SELECT eiv_endpoint FROM platform_settings WHERE singleton",
    );
    expect(rows[0]?.eiv_endpoint).toBe("live");
  });

  /*
   * The guard, and the reason the migration is not simply `SET eiv_endpoint =
   * 'live'`. An operator who has chosen `test` in the console must still be on
   * `test` after the next deploy — a migration overruling a decision somebody
   * made in a screen is the seed-overwrite defect `check:seed-overwrites`
   * exists to catch (§9.10b), one layer down.
   */
  it("leaves an endpoint an operator has already chosen", async () => {
    /*
     * An operator of this suite's own, created here rather than found.
     *
     * `resetDatabase` truncates `admin_users`, so "SELECT … LIMIT 1" answers
     * nothing — and a null `updated_by` would make this case pass for the
     * wrong reason, since `updated_by IS NULL` is the guard under test. That is
     * §9.6 in a fixture: an absent row and an untouched setting look identical
     * from the query.
     */
    const [operator] = (
      await pool.query<{ id: string }>(
        `INSERT INTO admin_users (email, display_name)
              VALUES ($1, $2) RETURNING id`,
        [`p188-${Date.now()}@ds.example`, "P188 operator"],
      )
    ).rows;
    expect(operator?.id, "the suite could not create an operator").toBeDefined();

    await pool.query(
      `UPDATE platform_settings
          SET eiv_endpoint = 'test', eiv_worker_enabled = false,
              eiv_live_confirmed_at = NULL, eiv_live_confirmed_by = NULL,
              updated_by = $1
        WHERE singleton`,
      [operator?.id],
    );

    await pool.query(shippedUpdate());

    const { rows } = await pool.query<{ eiv_endpoint: string }>(
      "SELECT eiv_endpoint FROM platform_settings WHERE singleton",
    );
    expect(rows[0]?.eiv_endpoint).toBe("test");
  });

  /*
   * The other half, and the one that keeps the first half safe.
   *
   * Pointed at production is not armed at production. A Punktemeldung reaches
   * the Ärztekammer only when the worker is on **and** a named person has
   * consented, and this makes the armed combination without consent
   * unrepresentable rather than merely refused by the service — which is what
   * lets the endpoint default to `live` at all.
   */
  it("cannot be armed against the live register without consent, in the database", async () => {
    await expect(
      pool.query(
        `UPDATE platform_settings
            SET eiv_worker_enabled = true, eiv_endpoint = 'live',
                eiv_live_confirmed_at = NULL, eiv_live_confirmed_by = NULL
          WHERE singleton`,
      ),
    ).rejects.toThrow(/platform_settings_live_needs_consent/u);
  });

  it("still defaults the worker off, which is what stops anything being filed", async () => {
    const { rows } = await pool.query<{ column_default: string | null }>(
      `SELECT column_default FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'platform_settings'
          AND column_name = 'eiv_worker_enabled'`,
    );

    expect(rows[0]?.column_default).toContain("false");
  });
});
