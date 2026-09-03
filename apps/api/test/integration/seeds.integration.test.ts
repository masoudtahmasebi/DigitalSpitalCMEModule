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
import type { Pool } from "pg";
import { createPool } from "@ds/postgres";
import { seedDsDefault, seedDsDemo, seedDsTest, seedMediceAdhs } from "@ds/seed";
import { PLACEHOLDER_VNR } from "@ds/domain";
import { requireEnv } from "./support/env.js";

const SUPERUSER_URL = requireEnv("POSTGRES_SUPERUSER_URL");

/*
 * The seeds refuse to invent a Keycloak binding (P101-03), so this suite has to
 * state one — exactly as the dev stack and the e2e rig do.
 *
 * A host that never set it is the case the refusal exists for, and it gets its
 * own test below rather than being the ambient condition of every other one.
 * `127.0.0.1:1` is the repository's established unreachable-on-purpose address:
 * nothing here performs an OIDC flow, and a value that could accidentally
 * resolve would make a future test pass for the wrong reason.
 */
process.env["KEYCLOAK_ISSUER"] ??= "http://127.0.0.1:1/realms/unused";
process.env["KEYCLOAK_AUDIENCE"] ??= "ds-education-api";

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
  // Returns credentials rather than a report — the caller is a test harness,
  // not an operator reading stdout — so it is adapted to the shared shape here.
  ["ds-test", async (pool: Pool) => JSON.stringify(await seedDsTest(pool))],
];

/**
 * One connection, not a pool.
 *
 * Every seed runs `BEGIN`, `set_config(…, true)` and its statements as separate
 * `pool.query` calls, which is only coherent on a single backend — with two,
 * the tenant context is set on a connection the inserts do not use.
 */
function openSeeder(): Pool {
  return createPool({ connectionString: SUPERUSER_URL, max: 1 });
}

let admin: Pool;

beforeAll(() => {
  admin = createPool({ connectionString: SUPERUSER_URL });
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
  it("publishes the courses whose accreditation is ours, and drafts MEDICE's", async () => {
    /*
     * P165-01, migrating what this asserted rather than deleting it.
     *
     * It used to expect all three published, which was true while the seed
     * carried a default VNR for MEDICE. The client drew the line: *"seed can do
     * it, but seed should be only on ds tenant, not medice."*
     *
     * So the two DS courses are unchanged — `ds-demo`'s VNR is
     * `9999999999999999999`, deliberately not a valid registration, and
     * `ds-ohne-punkte` awards no points and needs none. MEDICE's is a number an
     * Ärztekammer issued to MEDICE, the seed no longer invents one, and a
     * point-awarding course without one cannot be published
     * (`courses_published_cme_is_complete`). Draft is the correct outcome, not
     * a failure to finish the job: an operator enters the number from the
     * Anerkennungsbescheid and publishes.
     *
     * The property the old assertion held — that a seed run leaves a catalogue
     * somebody can actually use — is still here for the DS tenants, which are
     * the ones a demo or a test run reads.
     */
    const { rows } = await admin.query<{ slug: string; status: string }>(
      `SELECT slug, status FROM courses
        WHERE slug IN ('adhs-akademie-adult', 'ds-cme-demo', 'ds-ohne-punkte')
        ORDER BY slug`,
    );

    expect(rows).toEqual([
      { slug: "adhs-akademie-adult", status: "draft" },
      { slug: "ds-cme-demo", status: "published" },
      { slug: "ds-ohne-punkte", status: "published" },
    ]);
  });

  it("leaves MEDICE's VNR empty rather than inventing one", async () => {
    // The whole of P165-01 in one row. A number in this column would be a
    // number this repository made up about somebody else's accreditation.
    const { rows } = await admin.query<{ vnr: string | null }>(
      "SELECT vnr FROM courses WHERE slug = 'adhs-akademie-adult'",
    );
    expect(rows[0]?.vnr).toBeNull();
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

  it("does not overwrite what an operator set in the console (P108-01)", async () => {
    /*
     * The third instance of one defect, and the first time it is tested as a
     * class rather than as a field.
     *
     * `deploy.sh` runs this seed on every deploy, and its `ON CONFLICT DO
     * UPDATE` used to name `required_watch_percent`, `pass_threshold_percent`,
     * the Wissenschaftliche Leitung, the Stempel and the Unterschrift. So the
     * client's request — *"required_watch_percent should be configurable from
     * the admin panel"* — described something that already existed and did not
     * work: the field is on the settings screen, it saves, and the next deploy
     * put the seeded value back. Silently, on a green deploy.
     *
     * `stamp_image` is the one that would have mattered most. The seed writes a
     * 1x1 placeholder and the deploy's own output tells the operator to replace
     * it with the real Stempel before anything ships. Had they done so, the
     * next deploy would have restored the 1x1 — and a Teilnahmebescheinigung
     * without a stamp is not a valid document (S11). Nothing would have failed.
     *
     * Every field an operator can edit in Verwaltung is asserted here together,
     * so a field added to the DO UPDATE later has to delete a named case to
     * pass.
     */
    const stamp = Buffer.from("a-real-stamp-not-the-1x1-placeholder");
    await admin.query(
      `UPDATE courses
          SET required_watch_percent = 55,
              pass_threshold_percent  = 80,
              scientific_lead_name    = 'Prof. Dr. Operator',
              scientific_lead_title   = 'Wissenschaftliche Leitung',
              certificate_issue_place = 'Iserlohn',
              stamp_image             = $1,
              stamp_image_mime        = 'image/png',
              signature_image         = $1,
              signature_image_mime    = 'image/png'
        WHERE slug = $2`,
      [stamp, "adhs-akademie-adult"],
    );

    const seeder = openSeeder();
    try {
      await seedMediceAdhs(seeder);
    } finally {
      await seeder.end();
    }

    const { rows } = await admin.query<{
      watch: number;
      pass: number;
      lead: string | null;
      leadTitle: string | null;
      place: string | null;
      stamp: Buffer | null;
      signature: Buffer | null;
    }>(
      `SELECT required_watch_percent AS watch,
              pass_threshold_percent AS pass,
              scientific_lead_name    AS lead,
              scientific_lead_title   AS "leadTitle",
              certificate_issue_place AS place,
              stamp_image             AS stamp,
              signature_image         AS signature
         FROM courses WHERE slug = 'adhs-akademie-adult'`,
    );

    const row = rows[0];
    expect(row?.watch).toBe(55);
    expect(row?.pass).toBe(80);
    expect(row?.lead).toBe("Prof. Dr. Operator");
    expect(row?.leadTitle).toBe("Wissenschaftliche Leitung");
    expect(row?.place).toBe("Iserlohn");
    expect(row?.stamp?.equals(stamp)).toBe(true);
    expect(row?.signature?.equals(stamp)).toBe(true);
  }, 60_000);

  it("still supplies a starting value on a course that has none (P108-01)", async () => {
    /*
     * The other half, and the reason this is COALESCE rather than dropping the
     * fields from the update entirely: a fresh install must still get a working
     * course. A guard that protected the operator's value by never writing one
     * would leave every new installation with no stamp and no
     * Wissenschaftliche Leitung — §9.1, a fix whose success is indistinguishable
     * from doing nothing.
     *
     * The course is unpublished first, and that is a finding rather than
     * plumbing: `courses_published_cme_is_complete` refuses to let a PUBLISHED
     * CME course hold a null stamp or a null Wissenschaftliche Leitung at all.
     * The first version of this test did not unpublish and failed on its own
     * setup — which is the constraint doing exactly its job.
     *
     * It also bounds how bad P108-01 could have been, and it is worth being
     * accurate about: the constraint guarantees those fields are *not null*, so
     * no published course could ever have lost its stamp entirely. What it does
     * not check is whether the stamp is a **real** one, and the seed's value is
     * a 1x1 placeholder. So the overwrite was still live — a valid-looking row
     * with a blank image on the certificate, which no constraint can see.
     */
    await admin.query(
      `UPDATE courses
          SET status               = 'draft',
              scientific_lead_name = NULL,
              stamp_image          = NULL,
              stamp_image_mime     = NULL
        WHERE slug = 'adhs-akademie-adult'`,
    );

    const seeder = openSeeder();
    try {
      await seedMediceAdhs(seeder);
    } finally {
      await seeder.end();
    }

    const { rows } = await admin.query<{ lead: string | null; stamp: Buffer | null }>(
      `SELECT scientific_lead_name AS lead, stamp_image AS stamp
         FROM courses WHERE slug = 'adhs-akademie-adult'`,
    );
    expect(rows[0]?.lead).not.toBeNull();
    expect(rows[0]?.stamp).not.toBeNull();
  }, 60_000);

  it("corrects its own placeholder VNR, and only that (P109-01)", async () => {
    /*
     * P165-01 narrowed this, and the narrowing is the point.
     *
     * P28-03 seeded a synthetic VNR so a seeded environment could not file test
     * participations against MEDICE's real accreditation. That left every
     * installation inert with a human told to fix it by hand, which none did
     * (§9.9's corollary), so P109-01 made a real number the default — the
     * client's own, at the time.
     *
     * The seed no longer carries a default at all: *"seed can do it, but seed
     * should be only on ds tenant, not medice."* So the repair still exists and
     * now needs somebody to supply the number, which is `SEED_MEDICE_VNR`. That
     * is the only circumstance in which this seed may write a VNR, and this
     * test is the one place that exercises it.
     *
     * Both directions are still asserted, because a CASE that always fires and
     * one that never fires are the two ways this silently stops working and
     * neither shows up in a test of one direction.
     */
    const PLACEHOLDER = "0000000000000000000";
    const SUPPLIED = "2760012024200354002";

    // An installation seeded before P109-01.
    await admin.query("UPDATE courses SET vnr = $1 WHERE slug = $2", [
      PLACEHOLDER,
      "adhs-akademie-adult",
    ]);

    process.env["SEED_MEDICE_VNR"] = SUPPLIED;
    let seeder = openSeeder();
    try {
      await seedMediceAdhs(seeder);
    } finally {
      await seeder.end();
    }

    const corrected = await admin.query<{ vnr: string }>(
      "SELECT vnr FROM courses WHERE slug = 'adhs-akademie-adult'",
    );
    // The number the operator supplied, and nothing the repository invented.
    expect(corrected.rows[0]?.vnr).toBe(SUPPLIED);

    // And an operator's own number survives, which is the half that matters
    // once a second accredited course exists.
    const mine = "1111111111111111111";
    await admin.query("UPDATE courses SET vnr = $1 WHERE slug = $2", [
      mine,
      "adhs-akademie-adult",
    ]);

    seeder = openSeeder();
    try {
      await seedMediceAdhs(seeder);
    } finally {
      await seeder.end();
    }

    const kept = await admin.query<{ vnr: string }>(
      "SELECT vnr FROM courses WHERE slug = 'adhs-akademie-adult'",
    );
    expect(kept.rows[0]?.vnr).toBe(mine);

    // And with nothing supplied the seed writes nothing at all, which is
    // P165-01's default and the state every other case in this file runs in.
    delete process.env["SEED_MEDICE_VNR"];
    seeder = openSeeder();
    try {
      await seedMediceAdhs(seeder);
    } finally {
      await seeder.end();
    }
    const untouched = await admin.query<{ vnr: string }>(
      "SELECT vnr FROM courses WHERE slug = 'adhs-akademie-adult'",
    );
    expect(untouched.rows[0]?.vnr).toBe(mine);
  }, 60_000);

  it("creates no demo participant unless one is asked for (P111-01)", async () => {
    /*
     * The client, 24.08: *"delete the demo participant now … testing against a
     * live tenant with a known password is the thing you'd be unable to explain
     * afterwards."*
     *
     * It used to be unconditional, so MEDICE's production tenant carried
     * `demo@medice.example` with a password printed into a GitHub Actions log.
     * Deleting it is the remedy for installations that already have one; not
     * creating it is the fix, and this is the test that keeps it that way —
     * the default is the whole property, and a default is exactly the kind of
     * thing a later edit flips back without anybody noticing.
     */
    await admin.query("DELETE FROM users WHERE email = $1", ["demo@medice.example"]);

    let seeder = openSeeder();
    try {
      await seedMediceAdhs(seeder);
    } finally {
      await seeder.end();
    }

    const absent = await admin.query("SELECT 1 FROM users WHERE email = $1", [
      "demo@medice.example",
    ]);
    expect(absent.rowCount).toBe(0);

    // And the account is still creatable, by something that says so — a guard
    // that made the demo tenants unusable would be traded for a different bug.
    seeder = openSeeder();
    try {
      await seedMediceAdhs(seeder, { withDemoParticipant: true, revealPassword: false });
    } finally {
      await seeder.end();
    }

    const present = await admin.query("SELECT 1 FROM users WHERE email = $1", [
      "demo@medice.example",
    ]);
    expect(present.rowCount).toBe(1);
  }, 60_000);

  it("leaves learner-facing content alone on a second run with --if-missing", async () => {
    /*
     * The property `deploy.sh` depends on (P65-01), stated the way P65-03
     * corrected it.
     *
     * The destructive part of these seeds is `resetCourseContent`: it deletes
     * modules, chapters and contents, and `content_progress` rows point at
     * contents. Running that on every push would delete every learner's
     * progress, silently. So `--if-missing` withholds *that*, and nothing else.
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
        await run(seeder, { onlyIfMissing: true, revealPassword: false });
      } finally {
        await seeder.end();
      }
    }

    // The content tree is untouched — the loss that would be invisible until a
    // learner opened the course.
    const { rows: contents } = await admin.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM contents",
    );
    expect(contents[0]?.n).toBe(before[0]?.n);

    await admin.query(
      "UPDATE courses SET title = $1 WHERE slug = 'adhs-akademie-adult'",
      ["ADHS Akademie adult"],
    );
  }, 60_000);

  it("still creates a portal project that is missing, even with --if-missing", async () => {
    /*
     * The bug P65-03 fixes, as a test, and the reason it is worth one.
     *
     * `--if-missing` first meant "return if the customer row exists". On the
     * production installation the MEDICE *customer* had existed for months and
     * the `medice` **portal project** never had — so the deploy ran the seed,
     * the guard said "already exists", and `https://…/medice` went on answering
     * "Diesen Bereich gibt es nicht". A guard that skipped everything because
     * one row was present, including the row that was absent.
     *
     * So: delete the portal project, run with the flag, and it has to come
     * back. Under the old guard this fails.
     */
    await admin.query("DELETE FROM projects WHERE slug = 'medice'");

    const seeder = openSeeder();
    try {
      await seedMediceAdhs(seeder, { onlyIfMissing: true, revealPassword: false });
    } finally {
      await seeder.end();
    }

    const { rows } = await admin.query<{ slug: string; provider: string }>(
      "SELECT slug, identity_provider AS provider FROM projects WHERE slug = 'medice'",
    );
    expect(rows[0]?.slug).toBe("medice");
    // Local sign-in, which is what makes it a path on the portal at all.
    expect(rows[0]?.provider).toBe("local");
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

  /*
   * The Keycloak binding (P101-03).
   *
   * These two are the ticket. The pure rules have their own exhaustive tests in
   * `packages/seed/src/keycloak-binding.test.ts` — these assert that the seed
   * *calls* them, and what the database is left holding, which is the half a
   * unit test structurally cannot reach (§9.7).
   */
  it("does not overwrite a Keycloak binding an operator set in the console", async () => {
    /*
     * The half that made this a *recurring* fault rather than one bad value.
     *
     * The upsert read `SET keycloak_issuer = EXCLUDED.keycloak_issuer`, and
     * `deploy.sh` runs this seed on every deploy — so an operator who corrected
     * the issuer in Verwaltung had it silently reverted the next time anything
     * shipped, and the 401 came back with nothing in between to explain it.
     */
    await admin.query(
      `UPDATE projects
          SET keycloak_issuer = $1, keycloak_audience = $2, keycloak_realm = $3
        WHERE slug = 'medice-adhs'`,
      ["https://login.medice.com/auth/realms/medicerealm", "account", "medicerealm"],
    );

    const seeder = openSeeder();
    try {
      await seedMediceAdhs(seeder, { onlyIfMissing: true, revealPassword: false });
    } finally {
      await seeder.end();
    }

    const { rows } = await admin.query<{
      issuer: string | null;
      audience: string | null;
      realm: string | null;
    }>(
      `SELECT keycloak_issuer AS issuer, keycloak_audience AS audience,
              keycloak_realm AS realm
         FROM projects WHERE slug = 'medice-adhs'`,
    );

    expect(rows[0]).toEqual({
      issuer: "https://login.medice.com/auth/realms/medicerealm",
      audience: "account",
      realm: "medicerealm",
    });
  }, 60_000);

  it("refuses to finish when the project is bound to nothing real", async () => {
    /*
     * A host that never set the variables, which is every host this platform
     * has ever had — `KEYCLOAK_ISSUER` is a development variable and is
     * deliberately not in `infra/deploy/config.env.example`.
     *
     * The seed used to answer `http://127.0.0.1:8080/realms/ds-dev` here and
     * exit 0. The deploy went green, and every physician arriving from MEDICE's
     * WordPress got a bare 401 on a token that was real, unexpired and
     * correctly signed.
     */
    await admin.query(
      `UPDATE projects
          SET keycloak_issuer = NULL, keycloak_audience = NULL, keycloak_realm = NULL
        WHERE slug = 'medice-adhs'`,
    );

    const issuer = process.env["KEYCLOAK_ISSUER"];
    const audience = process.env["KEYCLOAK_AUDIENCE"];
    delete process.env["KEYCLOAK_ISSUER"];
    delete process.env["KEYCLOAK_AUDIENCE"];

    const seeder = openSeeder();
    try {
      await expect(
        seedMediceAdhs(seeder, { onlyIfMissing: true, revealPassword: false }),
      ).rejects.toThrow(/Verwaltung -> Organisation -> Projekte -> medice-adhs/u);
    } finally {
      await seeder.end();
      // Restored here rather than in an afterEach: this is the only case that
      // touches them, and a global reset would hide it from whoever reads the
      // case next. `localStorage` taught the same lesson in P22-08 — ambient
      // state that outlives a test gets attributed to the wrong code.
      if (issuer !== undefined) process.env["KEYCLOAK_ISSUER"] = issuer;
      if (audience !== undefined) process.env["KEYCLOAK_AUDIENCE"] = audience;
    }

    // And it rolled back rather than leaving the tenant half-seeded.
    const { rows } = await admin.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM projects WHERE slug = 'medice-adhs'",
    );
    expect(rows[0]?.n).toBe("1");

    // Put the row back for any case that runs after this one.
    const restore = openSeeder();
    try {
      await seedMediceAdhs(restore, { onlyIfMissing: true, revealPassword: false });
    } finally {
      await restore.end();
    }
  }, 60_000);
});

/**
 * The repair path, end to end (P117-01).
 *
 * Every installation seeded before P109-01 is carrying `PLACEHOLDER_VNR` on its
 * accredited course — nineteen zeros, which is present, is nineteen characters,
 * is not blank, and is not a number any Ärztekammer issued. It published, it
 * ran, and it printed itself on a physician's Teilnahmebescheinigung.
 *
 * The fix has two halves that only work together, so they are tested together:
 *
 *   * **migration 0047** demotes such a course, because a CME course on a
 *     catalogue against a VNR no register holds must not enrol anybody;
 *   * **this seed** replaces the placeholder with the real number and, in the
 *     same statement and under the same sentinel, puts the course back.
 *
 * Without the second half the deploy that fixes the VNR leaves MEDICE's course
 * a draft, off `/medice`, with nothing saying why — which is the shape of the
 * report that started P64-02.
 */
describe("a course carrying the seed's placeholder VNR", () => {
  const SLUG = "adhs-akademie-adult";

  it("is repaired and re-published only when a number is supplied", async () => {
    /*
     * P165-01. The repair P117-01 wrote still works and now has a precondition,
     * because the seed no longer knows MEDICE's VNR: *"seed can do it, but seed
     * should be only on ds tenant, not medice."*
     *
     * Both halves are asserted in one case on purpose. With nothing supplied a
     * demoted course stays demoted — which is the correct refusal, and would be
     * a silent regression if only the supplied half were covered. The old
     * assertion was the second half alone.
     */
    const supplied = "2760012024200354002";

    // The state migration 0047 leaves behind on an installation seeded before
    // P109-01. Written here rather than borrowed from a fixture so the case
    // does not depend on what a previous describe left.
    await admin.query(`UPDATE courses SET vnr = $1, status = 'draft' WHERE slug = $2`, [
      PLACEHOLDER_VNR,
      SLUG,
    ]);

    delete process.env["SEED_MEDICE_VNR"];
    let seeder = openSeeder();
    try {
      await seedMediceAdhs(seeder, { revealPassword: false });
    } finally {
      await seeder.end();
    }

    const held = await admin.query<{ vnr: string; status: string }>(
      "SELECT vnr, status FROM courses WHERE slug = $1",
      [SLUG],
    );
    expect(held.rows[0]?.vnr).toBe(PLACEHOLDER_VNR);
    expect(held.rows[0]?.status).toBe("draft");

    process.env["SEED_MEDICE_VNR"] = supplied;
    seeder = openSeeder();
    try {
      await seedMediceAdhs(seeder, { revealPassword: false });
    } finally {
      await seeder.end();
      delete process.env["SEED_MEDICE_VNR"];
    }

    const { rows } = await admin.query<{ vnr: string; status: string }>(
      "SELECT vnr, status FROM courses WHERE slug = $1",
      [SLUG],
    );

    expect(rows[0]?.vnr).toBe(supplied);
    expect(rows[0]?.status).toBe("published");
  }, 60_000);

  it("does not re-publish a course an operator unpublished", async () => {
    /*
     * The control, and the reason the repair is conditioned on the sentinel
     * rather than on `status = 'draft'`. P108-01's rule: the seed creates, the
     * console owns. A course with a VNR somebody typed keeps its status,
     * whatever the seed would prefer.
     */
    await admin.query(
      `UPDATE courses SET vnr = '2760552025919300018', status = 'draft'
        WHERE slug = $1`,
      [SLUG],
    );

    const seeder = openSeeder();
    try {
      await seedMediceAdhs(seeder, { revealPassword: false });
    } finally {
      await seeder.end();
    }

    const { rows } = await admin.query<{ status: string }>(
      "SELECT status FROM courses WHERE slug = $1",
      [SLUG],
    );
    expect(rows[0]?.status).toBe("draft");

    // Put it back for anything that runs after this file.
    await admin.query("UPDATE courses SET status = 'published' WHERE slug = $1", [SLUG]);
  }, 60_000);
});
