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
   * The property the client reported as "nothing works": a seeded tenant whose
   * catalogue is empty is not a seeded tenant (P64-02).
   *
   * P63-02 seeded the accredited courses as drafts, because no seed could
   * furnish a VNR password. That was truthful and it made `/medice` show
   * nothing. The seed now writes a placeholder credential — see
   * `seededVnrPassword` — so this asserts what somebody opening the portal
   * actually gets.
   */
  it("leaves every seeded course published and visible", async () => {
    const { rows } = await admin.query<{ slug: string; status: string }>(
      `SELECT slug, status FROM courses
        WHERE slug IN ('adhs-akademie-adult', 'ds-cme-demo', 'ds-ohne-punkte')
        ORDER BY slug`,
    );

    expect(rows).toEqual([
      { slug: "adhs-akademie-adult", status: "published" },
      { slug: "ds-cme-demo", status: "published" },
      { slug: "ds-ohne-punkte", status: "published" },
    ]);
  });

  it("stores the seeded VNR password as ciphertext, not as a column of plaintext", async () => {
    // The seed encrypts through the same cipher the API uses. A byte pattern
    // here would satisfy the constraint and then fail at decrypt time inside
    // the EIV worker — a failure attributed to the cipher rather than the seed.
    const { rows } = await admin.query<{ enc: Buffer | null }>(
      "SELECT vnr_password_enc AS enc FROM courses WHERE slug = 'adhs-akademie-adult'",
    );
    expect(rows[0]?.enc).toBeInstanceOf(Buffer);
    expect((rows[0]?.enc?.byteLength ?? 0) > 16).toBe(true);
  });

  it("does not overwrite a VNR password an operator already set", async () => {
    // The re-run property that matters most here: `deploy.sh` runs a seed on
    // every deploy, and replacing the real credential with a placeholder would
    // break every Punktemeldung from the next deploy onwards, silently.
    const mine = Buffer.from("operator-set-this-value-not-the-seed");
    await admin.query("UPDATE courses SET vnr_password_enc = $1 WHERE slug = $2", [
      mine,
      "adhs-akademie-adult",
    ]);

    const seeder = openSeeder();
    try {
      await seedMediceAdhs(seeder);
    } finally {
      await seeder.end();
    }

    const { rows } = await admin.query<{ enc: Buffer }>(
      "SELECT vnr_password_enc AS enc FROM courses WHERE slug = 'adhs-akademie-adult'",
    );
    expect(rows[0]?.enc.equals(mine)).toBe(true);
  }, 60_000);

  it("writes nothing at all on a second run with --if-missing", async () => {
    /*
     * The property the deploy now depends on (P65-01).
     *
     * `deploy.sh` runs these seeds on every push. Without `--if-missing` that
     * would rebuild the course content tree each time — `resetCourseContent`
     * deletes modules, chapters and contents, and `content_progress` rows point
     * at contents. Every learner's progress, gone on every deploy, silently.
     *
     * So this asserts by *effect* rather than by reading the flag: a row is
     * changed by hand, both seeds run with the flag, and the change has to still
     * be there. A seed that quietly ignored the option would fail here — which
     * is what `seed-default.integration.test.ts` learned to do about the same
     * flag, for the same reason.
     */
    await admin.query(
      "UPDATE courses SET title = $1 WHERE slug = 'adhs-akademie-adult'",
      ["Von Hand geändert"],
    );
    const { rows: before } = await admin.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM contents",
    );

    for (const run of [seedMediceAdhs, seedDsDemo]) {
      const seeder = openSeeder();
      try {
        const summary = await run(seeder, { onlyIfMissing: true });
        expect(summary).toContain("nothing was written");
      } finally {
        await seeder.end();
      }
    }

    const { rows: after } = await admin.query<{ title: string }>(
      "SELECT title FROM courses WHERE slug = 'adhs-akademie-adult'",
    );
    expect(after[0]?.title).toBe("Von Hand geändert");

    // And the content tree is untouched — the thing whose loss would be
    // invisible until a learner opened the course.
    const { rows: contents } = await admin.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM contents",
    );
    expect(contents[0]?.n).toBe(before[0]?.n);

    // Put it back, so a later case in this file is not reading a changed row.
    await admin.query(
      "UPDATE courses SET title = $1 WHERE slug = 'adhs-akademie-adult'",
      ["ADHS Akademie adult"],
    );
  }, 60_000);

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
