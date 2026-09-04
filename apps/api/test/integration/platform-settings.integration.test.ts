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
 * `eiv-endpoint.test.sh` asserts what the deploy *concludes* from these three
 * values. It cannot assert what they **are**, because they are a database fact
 * — and the shell rows covering this state are defence in depth, green with
 * either guard removed. This is the check that goes red on its own if somebody
 * changes the migration.
 *
 * ## Why it reads the column default too
 *
 * The row and the default are two separate claims and 0053 makes both. Reading
 * only the row would pass on a migration that updated it and left the default
 * at `mock` — so the next installation, whose row is inserted by 0051 before
 * 0053 runs, would come up on `mock` while this test stayed green. That is the
 * §9.1 shape: a check that covers less than it appears to.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { createPool } from "@ds/postgres";
import { requireEnv } from "./support/env.js";

const SUPERUSER_URL = requireEnv("POSTGRES_SUPERUSER_URL");

let pool: Pool;

beforeAll(() => {
  pool = createPool({ connectionString: SUPERUSER_URL });
});

afterAll(async () => {
  await pool.end();
});

describe("the register a new installation points at (P188-01)", () => {
  it("is the production one, in the row the migrations leave behind", async () => {
    const { rows } = await pool.query<{ eiv_endpoint: string }>(
      "SELECT eiv_endpoint FROM platform_settings WHERE singleton",
    );

    expect(rows[0]?.eiv_endpoint).toBe("live");
  });

  it("is the production one for the next row too, in the column default", async () => {
    const { rows } = await pool.query<{ column_default: string | null }>(
      `SELECT column_default FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'platform_settings'
          AND column_name = 'eiv_endpoint'`,
    );

    // `'live'::text` — Postgres renders a defaulted text literal with its cast.
    expect(rows[0]?.column_default).toContain("live");
  });

  /*
   * The other half, and the one that keeps the first half safe.
   *
   * Pointed at production is not armed at production. A Punktemeldung reaches
   * the Ärztekammer only when the worker is on **and** a named person has
   * consented, and `platform_settings_live_needs_consent` makes the armed
   * combination without consent unrepresentable rather than merely refused by
   * the service.
   */
  it("is not armed, and has nobody's consent on record", async () => {
    const { rows } = await pool.query<{
      eiv_worker_enabled: boolean;
      eiv_live_confirmed_at: Date | null;
    }>(
      `SELECT eiv_worker_enabled, eiv_live_confirmed_at
         FROM platform_settings WHERE singleton`,
    );

    expect(rows[0]?.eiv_worker_enabled).toBe(false);
    expect(rows[0]?.eiv_live_confirmed_at).toBeNull();
  });

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
});
