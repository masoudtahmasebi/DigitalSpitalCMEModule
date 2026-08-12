/**
 * Every shipped seed, run against the real schema (P63-03).
 *
 * ## The gap this closes
 *
 * `packages/seed` ships three tenant seeds and `deploy.sh`/`./dsc seed` can run
 * all three. Until this file, **one** of them was executed by any test —
 * `seedDsDefault`, in `seed-default.integration.test.ts` — and it is the only
 * one of the three whose course awards no CME points, so it is exempt from
 * every constraint the other two are subject to.
 *
 * The consequence, found on 12.08 by running them by hand:
 *
 * ```
 * SEED ds:     new row for relation "courses" violates check constraint
 *              "courses_no_answer_key_for_points"
 * SEED medice: new row for relation "courses" violates check constraint
 *              "courses_published_cme_is_complete"
 * ```
 *
 * The first had been failing since migration 0039 — five phases. Neither was
 * visible from any screen, because the QA database holds rows an *older* schema
 * accepted: CLAUDE.md §9.9's corollary, with the installation hiding the break
 * rather than revealing it.
 *
 * `scripts/check-seed-structure.mjs` did not catch it and could not: it reads
 * the seed's source and never opens a connection, so no constraint can fail it
 * (§9.1, second form — a check that covers less than its name says).
 *
 * ## Why it runs each seed twice
 *
 * `deploy.sh` runs a seed on every deploy. Re-runnability is not a nicety here,
 * it is the property the deploy depends on, and it is exactly what an
 * `ON CONFLICT DO UPDATE` is easy to get subtly wrong about — a column added to
 * the INSERT and forgotten in the DO UPDATE fails only on the second run.
 *
 * ## Why the list is derived
 *
 * A hand-written list of three is a list that will be a list of three after the
 * fourth seed is added. `apps/api/src/seed-*.ts` is the set of seeds the
 * production image can actually run, so that directory is the authority and the
 * first case below fails if this file does not cover all of it.
 */

import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { seedDsDefault, seedDsDemo, seedMediceAdhs } from "@ds/seed";
import { requireEnv } from "./support/env.js";

const SUPERUSER_URL = requireEnv("POSTGRES_SUPERUSER_URL");

/**
 * Name → the function `apps/api/src/seed-<name>.ts` calls.
 *
 * The names are the ones `./dsc seed` takes, so a failure here reads as the
 * command an operator would have typed.
 */
const SEEDS: ReadonlyArray<[string, (pool: Pool) => Promise<string>]> = [
  ["ds-default", (pool) => seedDsDefault(pool, { revealPassword: false })],
  ["ds", seedDsDemo],
  ["medice", seedMediceAdhs],
];

/**
 * One connection, not a pool.
 *
 * Every seed runs `BEGIN`, `set_config(…, true)` and its statements as separate
 * `pool.query` calls, which is only coherent on a single backend — with two,
 * the tenant context is set on a connection the inserts do not use.
 */
function openSeeder(): Pool {
  return new Pool({ connectionString: SUPERUSER_URL, max: 1 });
}

let admin: Pool;

beforeAll(() => {
  admin = new Pool({ connectionString: SUPERUSER_URL });
});

afterAll(async () => {
  await admin.end();
});

describe("the set of seeds under test", () => {
  it("is every seed the production image can run", () => {
    // Derived from the image's entrypoints rather than from memory: adding
    // `seed-foo.ts` fails here until it is covered, which is the whole point.
    const directory = fileURLToPath(new URL("../../src/", import.meta.url));
    const shipped = readdirSync(directory)
      .filter((file) => file.startsWith("seed-") && file.endsWith(".ts"))
      .map((file) => file.slice("seed-".length, -".ts".length))
      .sort();

    expect(shipped).toEqual(SEEDS.map(([name]) => name).sort());
  });
});

describe.each(SEEDS)("./dsc seed %s", (name, run) => {
  it("completes against the current schema", async () => {
    const seeder = openSeeder();
    try {
      // The assertion is that it does not throw. A constraint violation
      // arrives here as a rejected promise naming the constraint, which is
      // the failure message somebody reading CI needs.
      await expect(run(seeder)).resolves.toBeTypeOf("string");
    } finally {
      await seeder.end();
    }
  }, 60_000);

  it("completes again, because the deploy runs it every time", async () => {
    const seeder = openSeeder();
    try {
      await expect(run(seeder)).resolves.toBeTypeOf("string");
    } finally {
      await seeder.end();
    }
  }, 60_000);
});

describe("what the seeds leave behind", () => {
  /*
   * Not a restatement of the constraints — those are the database's job and it
   * does it. This asserts the *decision* P63-02 made, which is the thing a
   * later edit would silently reverse: the accredited courses arrive as drafts
   * because no seed can furnish a VNR password, and the point-free ones do not.
   */
  it("leaves a course awarding CME points as a draft", async () => {
    const { rows } = await admin.query<{ slug: string; status: string }>(
      `SELECT slug, status FROM courses
        WHERE cme_points IS NOT NULL AND cme_points > 0
          AND slug IN ('adhs-akademie-adult', 'ds-cme-demo')
        ORDER BY slug`,
    );

    expect(rows).toEqual([
      { slug: "adhs-akademie-adult", status: "draft" },
      { slug: "ds-cme-demo", status: "draft" },
    ]);
  });

  it("publishes a course awarding none, which has nothing to be incomplete for", async () => {
    const { rows } = await admin.query<{ status: string }>(
      "SELECT status FROM courses WHERE slug = 'ds-ohne-punkte'",
    );
    expect(rows[0]?.status).toBe("published");
  });

  it("never reveals the answer key on an accredited course", async () => {
    // P63-01: this was `true` for both DS demo courses, which is why the seed
    // could not run. The constraint refuses it — and refusing is not the same
    // as the seed asking for the right thing, which is what this asserts.
    const { rows } = await admin.query<{ slug: string; reveal: boolean }>(
      `SELECT slug, reveal_correct_answers AS reveal FROM courses
        WHERE slug IN ('ds-cme-demo', 'ds-ohne-punkte') ORDER BY slug`,
    );

    expect(rows).toEqual([
      { slug: "ds-cme-demo", reveal: false },
      { slug: "ds-ohne-punkte", reveal: true },
    ]);
  });
});
