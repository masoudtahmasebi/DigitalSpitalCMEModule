/**
 * The default customer seed, and the two flags a deploy depends on (P26-01).
 *
 * ## Why this one seed has a test when the other two do not
 *
 * `deploy.sh` runs it. Nothing else in `packages/seed` is reachable from an
 * unattended path, and the difference matters because the seed's ordinary
 * behaviour is destructive: `resetCourseContent` deletes a course's content
 * tree, and with it every learner's progress against that course.
 *
 * `onlyIfMissing` is the only thing standing between "the deploy creates a
 * default customer on a fresh installation" and "the deploy wipes a course
 * every time it runs". It is exactly the shape of control this repository has
 * shipped broken three times now — one that looks implemented, is never
 * exercised, and whose failure is silent. So it is asserted by *effect*: a row
 * is changed by hand, the seed is run, and the change has to still be there.
 *
 * `revealPassword` is the second. The deploy's stdout is a GitHub Actions log,
 * and a demo account's password in a build log is a credential that outlives
 * every rotation on a platform where an account is a points record.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { createPool } from "@ds/postgres";
import { seedDsDefault } from "@ds/seed";
import { PLACEHOLDER_VNR } from "@ds/domain";
import { requireEnv } from "./support/env.js";

const SUPERUSER_URL = requireEnv("POSTGRES_SUPERUSER_URL");
const MIGRATION_URL = requireEnv("MIGRATION_DATABASE_URL");

/** Must equal `CUSTOMER_ID` in `packages/seed/src/ds-default.ts`. */
const CUSTOMER_ID = "0198f4c1-7a2e-7000-8000-000000000003";
const COURSE_SLUG = "dscourse";

let admin: Pool;
/**
 * A pool of exactly one connection.
 *
 * The seed runs `BEGIN`, `set_config(..., true)` and its statements as separate
 * `pool.query` calls, which is only coherent on a single connection — with two,
 * the `BEGIN` and the inserts can land on different backends and the tenant
 * context is not set for the ones that matter.
 */
let seeder: Pool;

beforeAll(async () => {
  admin = createPool({ connectionString: SUPERUSER_URL });
  seeder = createPool({ connectionString: MIGRATION_URL, max: 1 });
});

afterAll(async () => {
  await seeder.end();
  await admin.end();
});

/**
 * Remove the default tenant entirely, as the superuser.
 *
 * Not something the application can do and not something it should: this is a
 * test putting the database into the state a *first* deploy meets, which is the
 * only state `onlyIfMissing` behaves differently in.
 */
async function dropDefaultTenant(customerId: string = CUSTOMER_ID): Promise<void> {
  const courses = `SELECT id FROM courses WHERE customer_id = '${customerId}'`;
  const modules = `SELECT id FROM modules WHERE course_id IN (${courses})`;
  const chapters = `SELECT id FROM chapters WHERE module_id IN (${modules})`;
  const contents = `SELECT id FROM contents WHERE chapter_id IN (${chapters})`;
  const identities = `SELECT i.id FROM user_identities i
                        JOIN user_customers uc ON uc.user_id = i.user_id
                       WHERE uc.customer_id = '${customerId}'`;
  const users = `SELECT user_id FROM user_customers WHERE customer_id = '${customerId}'`;

  await admin.query("BEGIN");
  for (const statement of [
    `DELETE FROM quiz_options WHERE question_id IN (SELECT id FROM quiz_questions WHERE content_id IN (${contents}))`,
    `DELETE FROM quiz_questions WHERE content_id IN (${contents})`,
    `DELETE FROM content_progress WHERE content_id IN (${contents})`,
    `UPDATE enrolments SET last_content_id = NULL WHERE course_id IN (${courses})`,
    `DELETE FROM enrolments WHERE course_id IN (${courses})`,
    `DELETE FROM contents WHERE chapter_id IN (${chapters})`,
    `DELETE FROM chapters WHERE module_id IN (${modules})`,
    `DELETE FROM modules WHERE course_id IN (${courses})`,
    `DELETE FROM course_experts WHERE course_id IN (${courses})`,
    `DELETE FROM evaluations WHERE course_id IN (${courses})`,
    `DELETE FROM courses WHERE customer_id = '${customerId}'`,
    `DELETE FROM learner_credentials WHERE user_identity_id IN (${identities})`,
    `DELETE FROM learner_sessions WHERE user_id IN (${users})`,
    `DELETE FROM user_identities WHERE user_id IN (${users})`,
    `DELETE FROM user_roles WHERE customer_id = '${customerId}'`,
    `DELETE FROM users WHERE id IN (${users})`,
    `DELETE FROM user_customers WHERE customer_id = '${customerId}'`,
    `DELETE FROM projects WHERE customer_id = '${customerId}'`,
    `DELETE FROM departments WHERE customer_id = '${customerId}'`,
    `DELETE FROM customers WHERE id = '${customerId}'`,
  ]) {
    await admin.query(statement);
  }
  await admin.query("COMMIT");
}

async function countCourses(): Promise<number> {
  const { rows } = await admin.query<{ n: string }>(
    "SELECT count(*) AS n FROM courses WHERE customer_id = $1",
    [CUSTOMER_ID],
  );
  return Number(rows[0]?.n ?? "0");
}

async function courseTitle(): Promise<string | undefined> {
  const { rows } = await admin.query<{ title: string }>(
    "SELECT title FROM courses WHERE customer_id = $1 AND slug = $2",
    [CUSTOMER_ID, COURSE_SLUG],
  );
  return rows[0]?.title;
}

describe("a first installation", () => {
  it("gets the default customer, its project and one complete course", async () => {
    await dropDefaultTenant();

    await seedDsDefault(seeder, { onlyIfMissing: true, revealPassword: false });

    const { rows } = await admin.query<{
      customer: string;
      department: string;
      project: string;
      course: string;
      modules: string;
      module_titles: string;
      chapters: string;
      questions: string;
    }>(
      // `string_agg` over the modules rather than a scalar subquery: the course
      // has two of them since P52-03, and `(SELECT title FROM modules …)` threw
      // "more than one row returned by a subquery used as an expression" the
      // moment it gained the second. The aggregate says what is there rather
      // than assuming how many there are.
      `SELECT (SELECT name FROM customers WHERE id = $1)                                      AS customer,
              (SELECT name FROM departments WHERE customer_id = $1)                           AS department,
              (SELECT name FROM projects WHERE customer_id = $1)                              AS project,
              (SELECT title FROM courses WHERE customer_id = $1)                              AS course,
              (SELECT count(*) FROM modules WHERE customer_id = $1)                            AS modules,
              (SELECT string_agg(title, ', ' ORDER BY ordinal) FROM modules WHERE customer_id = $1) AS module_titles,
              (SELECT count(*) FROM chapters WHERE customer_id = $1)                          AS chapters,
              (SELECT count(*) FROM quiz_questions WHERE customer_id = $1)                    AS questions`,
      [CUSTOMER_ID],
    );

    // The names the client asked for, exactly. They are what an operator reads
    // on screen while still learning which level is which, so they are pinned
    // rather than left to whatever the seed happens to say.
    expect(rows[0]?.customer).toBe("DSCustomer");
    expect(rows[0]?.department).toBe("DSOrganisation");
    expect(rows[0]?.project).toBe("DSProject");
    expect(rows[0]?.course).toContain("DSCourse");

    // Two modules, and the DSModule naming kept — the point of this tenant is
    // that an operator can tell at a glance which level they are looking at
    // (P52-03).
    expect(Number(rows[0]?.modules)).toBe(2);
    expect(rows[0]?.module_titles).toBe("DSModule 1, DSModule 2");
    expect(Number(rows[0]?.chapters)).toBe(5);
    expect(Number(rows[0]?.questions)).toBe(5);
  });

  it("cannot reach EIV, because the course has no accreditation at all", async () => {
    // The property that makes this safe to run unattended. A course with points
    // is a course the EIV worker will try to report; every one of these four
    // being NULL is what stops a default fixture filing a Punktemeldung.
    const { rows } = await admin.query<{
      cme_points: number | null;
      cme_category: string | null;
      vnr: string | null;
      accreditation_body: string | null;
    }>(
      `SELECT cme_points, cme_category, vnr, accreditation_body
         FROM courses WHERE customer_id = $1`,
      [CUSTOMER_ID],
    );

    expect(rows[0]).toEqual({
      cme_points: null,
      cme_category: null,
      vnr: null,
      accreditation_body: null,
    });
  });
});

describe("onlyIfMissing", () => {
  it("writes nothing once the customer exists", async () => {
    // Proven by effect, not by counting rows: an edit made by hand has to
    // survive. Counting would pass just as happily against a seed that deleted
    // the content tree and rebuilt it — which is the failure this flag exists
    // to prevent, and the one that costs a learner their progress.
    const edited = `Edited by hand ${randomUUID().slice(0, 8)}`;
    await admin.query("UPDATE courses SET title = $2 WHERE customer_id = $1", [
      CUSTOMER_ID,
      edited,
    ]);
    const marker = await admin.query<{ id: string }>(
      `INSERT INTO contents (customer_id, chapter_id, ordinal, kind, title)
       SELECT $1, id, 42, 'material', 'Ein Kapitel, das ein Mensch angelegt hat'
         FROM chapters WHERE customer_id = $1 LIMIT 1
       RETURNING id`,
      [CUSTOMER_ID],
    );

    const report = await seedDsDefault(seeder, {
      onlyIfMissing: true,
      revealPassword: false,
    });

    // The effect first, deliberately. A report that says the right thing while
    // the writes happened anyway is the failure worth catching, and asserting
    // the string first would hide it behind a message about text.
    expect(await courseTitle()).toBe(edited);
    const { rowCount } = await admin.query("SELECT 1 FROM contents WHERE id = $1", [
      marker.rows[0]?.id,
    ]);
    expect(rowCount).toBe(1);
    expect(report).toContain("already exists");
  });
});

describe("without onlyIfMissing", () => {
  it("rebuilds, and is idempotent on its slugs", async () => {
    await seedDsDefault(seeder, { revealPassword: false });
    await seedDsDefault(seeder, { revealPassword: false });

    // One course and *two* modules after two runs — the number the seed
    // defines, not a number that grew. `courses` upserts on
    // `(project_id, slug)`; `modules` has no such key and relies on
    // `resetCourseContent` having deleted them first, which is the half a
    // re-run would expose: a broken reset shows up here as four.
    expect(await countCourses()).toBe(1);
    const { rows } = await admin.query<{ n: string }>(
      "SELECT count(*) AS n FROM modules WHERE customer_id = $1",
      [CUSTOMER_ID],
    );
    expect(Number(rows[0]?.n)).toBe(2);
  });
});

/**
 * A printed password line: two spaces, the label, two spaces, 32 base64url
 * characters, and then the end of the line.
 *
 * The generated password is 24 random bytes as base64url — 32 characters with
 * no padding. Asserting on the shape rather than the value is the only way to
 * catch a future edit that starts printing it again.
 *
 * **Anchored to the line, not with `\b`, and that is the whole point of this
 * comment (P32-02).** The first version ended in `\b`, which fails whenever the
 * password's last character is `-`: `-` is not a word character, so between it
 * and the end of the line there is no boundary to match. base64url's alphabet
 * makes that the last character about one time in sixty-four, so the suite
 * failed roughly once every sixty runs, on a different machine each time, with
 * a diff that looked like the seed had printed the password correctly — because
 * it had.
 *
 * That is the shape of flake worth naming: not a race, not shared state, just
 * an assertion that was wrong about its own input for a subset of values it was
 * always going to see.
 */
const PRINTED_PASSWORD = /^ {2}Passwort {2}[A-Za-z0-9_-]{32}$/mu;

describe("the report", () => {
  it("withholds the generated password when the run is unattended", async () => {
    await dropDefaultTenant();

    const report = await seedDsDefault(seeder, { revealPassword: false });

    expect(report).toContain("deliberately not printed");
    expect(report).not.toMatch(PRINTED_PASSWORD);
  });

  it("prints it when a human is looking at the terminal", async () => {
    await dropDefaultTenant();

    const report = await seedDsDefault(seeder);

    expect(report).toMatch(PRINTED_PASSWORD);
  });
});

/**
 * The collision that made every seed non-idempotent in exactly one respect
 * (P43-01).
 *
 * An operator created the tenant in the console before running the seed, which
 * is the obvious order to do it in and the one the console invites. The seed
 * then died on its very first write:
 *
 * ```
 * Seeding the MEDICE course failed:
 *   duplicate key value violates unique constraint "customers_slug_key"
 * ```
 *
 * Every `INSERT … ON CONFLICT (id) DO UPDATE` in this package was written to be
 * re-runnable, and `id` is the one unique key the collision cannot happen on:
 * the ids are fixed constants, so a *second* row under the same slug is by
 * definition a different id. The clause named the key that never fires.
 *
 * `resolveCustomerId` adopts the existing customer instead, and that is what is
 * asserted here — by effect, on a row this test creates the way the console
 * would: with a random id.
 */
describe("a customer somebody already created under this slug", () => {
  const CUSTOMER_SLUG = "dscustomer";

  it("is filled in rather than collided with", async () => {
    await dropDefaultTenant();
    const foreignId = randomUUID();

    try {
      await admin.query("INSERT INTO customers (id, slug, name) VALUES ($1,$2,$3)", [
        foreignId,
        CUSTOMER_SLUG,
        "Made in the console",
      ]);

      // The assertion that would have failed before: this call threw.
      await seedDsDefault(seeder);

      const { rows: customers } = await admin.query<{ id: string }>(
        "SELECT id FROM customers WHERE slug = $1",
        [CUSTOMER_SLUG],
      );
      expect(customers).toHaveLength(1);
      expect(customers[0]?.id).toBe(foreignId);

      // Adopted, not merely tolerated: the content has to land under the id the
      // operator's tenant actually has, or the console shows an empty customer
      // beside a course nobody can reach.
      const { rows: courses } = await admin.query<{ n: string }>(
        "SELECT count(*) AS n FROM courses WHERE customer_id = $1",
        [foreignId],
      );
      expect(Number(courses[0]?.n ?? "0")).toBe(1);
    } finally {
      await dropDefaultTenant(foreignId);
    }
  });

  it("still uses the fixed id when nothing holds the slug", async () => {
    await dropDefaultTenant();

    await seedDsDefault(seeder);

    const { rows } = await admin.query<{ id: string }>(
      "SELECT id FROM customers WHERE slug = $1",
      [CUSTOMER_SLUG],
    );
    expect(rows[0]?.id).toBe(CUSTOMER_ID);
  });
});

/**
 * The invariant every seed has to respect (P62-02).
 *
 * `courses_published_cme_is_complete` is a CHECK, so a seed that violated it
 * would fail loudly. This asserts the *product* property rather than the
 * constraint's existence: **no seeded course is published, awards CME points
 * and missing something the certificate or the Punktemeldung reads.**
 *
 * It is here rather than in `scripts/` because the question needs a database
 * with the seeds actually run — which is precisely CLAUDE.md §9.9's point. Two
 * courses on the QA installation failed this and were demoted by migration
 * 0042; without an assertion the next seed to add one would go unnoticed until
 * a physician finished it.
 */
describe("what the seeds leave publishable", () => {
  it("publishes no CME course that could not produce a certificate", async () => {
    const { rows } = await admin.query<{ slug: string; missing: string }>(`
      SELECT slug,
             concat_ws(', ',
               CASE WHEN vnr IS NULL OR btrim(vnr) = '' THEN 'vnr' END,
               CASE WHEN vnr_password_enc IS NULL THEN 'vnrPassword' END,
               CASE WHEN cme_category IS NULL OR btrim(cme_category) = '' THEN 'cmeCategory' END,
               CASE WHEN accreditation_body IS NULL OR btrim(accreditation_body) = '' THEN 'accreditationBody' END,
               CASE WHEN organizer IS NULL OR btrim(organizer) = '' THEN 'organizer' END,
               CASE WHEN event_location IS NULL OR btrim(event_location) = '' THEN 'eventLocation' END,
               CASE WHEN scientific_lead_name IS NULL OR btrim(scientific_lead_name) = '' THEN 'scientificLeadName' END,
               CASE WHEN certificate_issue_place IS NULL OR btrim(certificate_issue_place) = '' THEN 'certificateIssuePlace' END,
               CASE WHEN stamp_image IS NULL THEN 'stampImage' END,
               CASE WHEN signature_image IS NULL THEN 'signatureImage' END
             ) AS missing
        FROM courses
       WHERE status = 'published' AND cme_points IS NOT NULL AND cme_points > 0
    `);

    const broken = rows.filter((row) => row.missing !== "");
    // Named, not counted: "1 course is incomplete" sends somebody looking.
    expect(broken.map((row) => `${row.slug}: ${row.missing}`)).toEqual([]);
  });

  it("refuses such a course at the database, whatever writes it", async () => {
    /*
     * The guarantee, exercised on the connection that bypasses every service:
     * a superuser writing directly, which is what a seed, a migration and an
     * operator with `psql` all are. The row is built here rather than borrowed
     * from the seed so the case does not depend on what a previous `describe`
     * left behind.
     */
    const { rows } = await admin.query<{ id: string; customer_id: string }>(
      "SELECT id, customer_id FROM projects LIMIT 1",
    );
    const project = rows[0];
    expect(project).toBeDefined();

    await expect(
      admin.query(
        `INSERT INTO courses (customer_id, project_id, slug, title,
                              required_watch_percent, pass_threshold_percent,
                              cme_points, status)
         VALUES ($1,$2,$3,$4,100,70,4,'published')`,
        [project!.customer_id, project!.id, `p62-broken-${Date.now()}`, "Unvollständig"],
      ),
    ).rejects.toThrow(/courses_published_cme_is_complete/);
  });

  /*
   * P117-01, and the case the constraint could not see for five migrations.
   *
   * The row below is complete by every measure 0042 knew: the VNR is present,
   * nineteen characters, not blank. It is also `PLACEHOLDER_VNR` — the string
   * the seed writes when it has no accredited number — so it names a
   * Veranstaltung no Ärztekammer register holds.
   *
   * Before 0047 this INSERT succeeded, the course published, and a physician
   * who finished it received a Teilnahmebescheinigung printing nineteen zeros.
   * That is what happened on the QA installation, and nothing anywhere said so:
   * the API logged no error because there was none to log, and EIV-FOBI showed
   * nothing because there is no such event to report against.
   */
  it("refuses the seed's placeholder VNR, which is present and is not a VNR", async () => {
    const { rows } = await admin.query<{ id: string; customer_id: string }>(
      "SELECT id, customer_id FROM projects LIMIT 1",
    );
    const project = rows[0];
    expect(project).toBeDefined();

    await expect(
      publishAccreditedCourse(project!, { vnr: PLACEHOLDER_VNR }),
    ).rejects.toThrow(/courses_published_cme_is_complete/);
  });

  it("accepts the same row with a real VNR — so the refusal is about the value", async () => {
    const { rows } = await admin.query<{ id: string; customer_id: string }>(
      "SELECT id, customer_id FROM projects LIMIT 1",
    );
    const project = rows[0];
    expect(project).toBeDefined();

    // The control. Without it the test above would pass on a constraint that
    // refuses everything, which is CLAUDE.md §9.1 in its other direction: a
    // check that cannot go green proves as little as one that cannot go red.
    await expect(
      publishAccreditedCourse(project!, { vnr: "2760552025919300018" }),
    ).resolves.toBeUndefined();
  });

  /**
   * One statement, so the two cases above differ in exactly one value.
   *
   * Draft first, then publish: the constraint is checked per row per statement,
   * so an INSERT that lands `published` and incomplete is refused before any
   * UPDATE could complete it — the order `support/accredited-course.ts`
   * documents, and the order an operator works in.
   */
  async function publishAccreditedCourse(
    project: { id: string; customer_id: string },
    fields: { vnr: string },
  ): Promise<void> {
    const slug = `p117-${randomUUID()}`;
    await admin.query(
      `INSERT INTO courses (customer_id, project_id, slug, title,
                            required_watch_percent, pass_threshold_percent,
                            cme_points, status,
                            vnr, vnr_password_enc, cme_category,
                            accreditation_body, organizer, event_location,
                            scientific_lead_name, certificate_issue_place,
                            stamp_image, signature_image)
       VALUES ($1,$2,$3,'Platzhalter-VNR',100,70,4,'draft',
               $4, '\\x00'::bytea, 'D',
               'Ärztekammer Westfalen-Lippe', 'Medice', 'online',
               'Prof. Dr. med. Muster', 'Iserlohn',
               '\\x00'::bytea, '\\x00'::bytea)`,
      [project.customer_id, project.id, slug, fields.vnr],
    );

    await admin.query("UPDATE courses SET status = 'published' WHERE slug = $1", [slug]);
  }
});
