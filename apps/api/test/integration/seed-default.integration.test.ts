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
import { Pool } from "pg";
import { seedDsDefault } from "@ds/seed";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} must be set to run the integration suite.`);
  }
  return value;
}

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
  admin = new Pool({ connectionString: SUPERUSER_URL });
  seeder = new Pool({ connectionString: MIGRATION_URL, max: 1 });
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
async function dropDefaultTenant(): Promise<void> {
  const courses = `SELECT id FROM courses WHERE customer_id = '${CUSTOMER_ID}'`;
  const modules = `SELECT id FROM modules WHERE course_id IN (${courses})`;
  const chapters = `SELECT id FROM chapters WHERE module_id IN (${modules})`;
  const contents = `SELECT id FROM contents WHERE chapter_id IN (${chapters})`;
  const identities = `SELECT i.id FROM user_identities i
                        JOIN user_customers uc ON uc.user_id = i.user_id
                       WHERE uc.customer_id = '${CUSTOMER_ID}'`;
  const users = `SELECT user_id FROM user_customers WHERE customer_id = '${CUSTOMER_ID}'`;

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
    `DELETE FROM courses WHERE customer_id = '${CUSTOMER_ID}'`,
    `DELETE FROM learner_credentials WHERE user_identity_id IN (${identities})`,
    `DELETE FROM learner_sessions WHERE user_id IN (${users})`,
    `DELETE FROM user_identities WHERE user_id IN (${users})`,
    `DELETE FROM user_roles WHERE customer_id = '${CUSTOMER_ID}'`,
    `DELETE FROM users WHERE id IN (${users})`,
    `DELETE FROM user_customers WHERE customer_id = '${CUSTOMER_ID}'`,
    `DELETE FROM projects WHERE customer_id = '${CUSTOMER_ID}'`,
    `DELETE FROM departments WHERE customer_id = '${CUSTOMER_ID}'`,
    `DELETE FROM customers WHERE id = '${CUSTOMER_ID}'`,
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
      module: string;
      chapters: string;
      questions: string;
    }>(
      `SELECT (SELECT name FROM customers WHERE id = $1)                                      AS customer,
              (SELECT name FROM departments WHERE customer_id = $1)                           AS department,
              (SELECT name FROM projects WHERE customer_id = $1)                              AS project,
              (SELECT title FROM courses WHERE customer_id = $1)                              AS course,
              (SELECT title FROM modules WHERE customer_id = $1)                              AS module,
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
    expect(rows[0]?.module).toBe("DSModule");
    expect(rows[0]?.course).toContain("DSCourse");
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

    // One course and one module after two runs. `courses` upserts on
    // `(project_id, slug)`; `modules` has no such key and relies on
    // `resetCourseContent` having deleted it first, which is the half a
    // re-run would expose.
    expect(await countCourses()).toBe(1);
    const { rows } = await admin.query<{ n: string }>(
      "SELECT count(*) AS n FROM modules WHERE customer_id = $1",
      [CUSTOMER_ID],
    );
    expect(Number(rows[0]?.n)).toBe(1);
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
