/**
 * The default customer a fresh installation starts with (P26-01).
 *
 * ## Why an installation needs one at all
 *
 * Until now a new deployment came up empty. The first operator signed in to the
 * console, found no customer, no department, no project and no course, and had
 * to create four things in the right order before any screen showed anything —
 * with no example of what a filled-in one looks like. The MEDICE seed is not
 * that example: it carries a real VNR and a real accreditation, so running it
 * to "have a look" seeds a course that could file a Punktemeldung.
 *
 * This is the neutral one. Named exactly as asked — **DSCustomer**,
 * **DSOrganisation**, **DSProject**, **DSModule** — so the names on screen say
 * what each level *is* while somebody is still learning which is which.
 *
 * ## What makes it safe to ship as a default
 *
 * **No VNR, no accreditation body, no CME points.** A course with points is a
 * course the EIV worker will try to report; one without is a complete,
 * exercisable course that cannot reach a third party. Every gate, the quiz, the
 * evaluation and the certificate path work — the certificate simply carries no
 * points, which is a real supported case (`ds-ohne-punkte` exists for the same
 * reason).
 *
 * **Lorem ipsum, and obviously so.** Not plausible German medical prose. A
 * placeholder somebody might mistake for content is a placeholder that ships.
 *
 * ## Its relationship to the other two seeds
 *
 * `seedMediceAdhs` is a customer's real course. `seedDsDemo` is the second
 * tenant the isolation tests need. This is the one an operator is *meant* to
 * find, and it is idempotent on its slugs like both of them, so the first
 * deploy and the fiftieth produce the same rows.
 *
 * ## Why this is the one seed a deploy may run by itself
 *
 * `deploy.sh` deliberately writes no rows — "a deploy that writes rows is a
 * deploy that can write the wrong ones into a live database" — and that
 * reasoning holds for both other seeds, which rebuild a course's content tree
 * unconditionally and therefore delete learner progress against it.
 *
 * Two options make this one different, and both are load-bearing:
 *
 * - `onlyIfMissing` returns before the first write once the customer row
 *   exists, so the destructive part is unreachable on any installation that
 *   has been deployed before. A re-deploy is a no-op, not a rebuild.
 * - `revealPassword` is what an unattended run turns **off**. The deploy runs
 *   over SSH from a GitHub Actions job, so anything this returns is written to
 *   a workflow log — and a demo account whose password is in a build log is a
 *   credential on a platform where an account is a points record.
 */

import type pg from "pg";
import {
  enterTenant,
  participantPassword,
  PLACEHOLDER_IMAGE,
  resetCourseContent,
  resolveCustomerId,
  seedParticipant,
  seedPortalProject,
  upsert,
  hasNoEvaluation,
} from "./lib.js";
import { describeDemoStaff, seedDemoStaff } from "./staff.js";

/**
 * Fixed, as the other two are: `customers`' RLS policy checks
 * `id = app.customer_id`, so the id must be known before the insert that
 * creates the row. Ends `…003`, so three tenants are distinguishable at a
 * glance in a log line.
 */
const CUSTOMER_ID = "0198f4c1-7a2e-7000-8000-000000000003";

/**
 * The slugs are lower-case even though the display names are not.
 *
 * A slug reaches a URL — `fortbildung.digitalspital.com/dscustomer` — and an
 * `X-DS-Project` header, and mixed case in either is a source of bugs nobody
 * enjoys: hostnames are case-insensitive, paths are not, and a header compared
 * with `===` somewhere is one edit away. The *name* is what an operator reads.
 */
const CUSTOMER_SLUG = "dscustomer";
const DEPARTMENT_SLUG = "dsorganisation";
const PROJECT_SLUG = "dsproject";
const COURSE_SLUG = "dscourse";

const CUSTOMER_NAME = "DSCustomer";
const DEPARTMENT_NAME = "DSOrganisation";
const PROJECT_NAME = "DSProject";
const MODULE_NAME = "DSModule";

const PARTICIPANT_EMAIL = "demo@dscustomer.example";

/** Deliberately obvious placeholder prose. See the header. */
const LOREM =
  "Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy " +
  "eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam " +
  "voluptua. At vero eos et accusam et justo duo dolores et ea rebum.";

/**
 * Five chapters under one module, with real durations.
 *
 * Real durations because the watch gate is a percentage of a known length: a
 * course seeded with `duration_sec` of 60 would be completable in a minute and
 * would tell an operator nothing about how the gate behaves.
 */
/**
 * Two modules, chapters under each (P52-03).
 *
 * It was one module of five chapters, which exercised the gate *within* a
 * module and never *between* two — the mirror image of the other seeds, which
 * had several modules of one chapter each and exercised only the reverse.
 * Neither shape produced a course where both transitions happen, and both
 * transitions are separate branches in `courseChapterSequence`.
 *
 * `DSModule` keeps its name, numbered, because the point of this tenant is
 * that the words on screen say DSCustomer / DSOrganisation / DSProject /
 * DSModule and a reader can tell instantly which fixture they are looking at.
 */
const MODULES: ReadonlyArray<{
  readonly title: string;
  readonly chapters: ReadonlyArray<{ title: string; durationSec: number }>;
}> = [
  {
    title: `${MODULE_NAME} 1`,
    chapters: [
      { title: "DSChapter 1 – Lorem ipsum", durationSec: 900 },
      { title: "DSChapter 2 – Dolor sit amet", durationSec: 1200 },
      { title: "DSChapter 3 – Consetetur sadipscing", durationSec: 780 },
    ],
  },
  {
    title: `${MODULE_NAME} 2`,
    chapters: [
      { title: "DSChapter 4 – Sed diam nonumy", durationSec: 1500 },
      { title: "DSChapter 5 – At vero eos", durationSec: 660 },
    ],
  },
];

const QUESTION_COUNT = 5;

export interface DsDefaultOptions {
  /**
   * Do nothing at all if the customer already exists.
   *
   * The check runs before the first write, so on an installation that has been
   * deployed before this function reads one row and returns. That is what makes
   * it safe for `deploy.sh` to call unattended: `resetCourseContent` below
   * deletes learner progress on this course, and this flag is what puts it out
   * of reach.
   */
  readonly onlyIfMissing?: boolean;

  /**
   * Whether the returned report may contain the generated participant password.
   *
   * False for anything unattended. The deploy runs over SSH from a GitHub
   * Actions job, so the report ends up in a workflow log that outlives every
   * rotation — see the header.
   */
  readonly revealPassword?: boolean;
}

export async function seedDsDefault(
  pool: pg.Pool,
  options: DsDefaultOptions = {},
): Promise<string> {
  const onlyIfMissing = options.onlyIfMissing ?? false;
  const revealPassword = options.revealPassword ?? true;

  try {
    await pool.query("BEGIN");
    // See `resolveCustomerId`: adopt whatever already holds this slug, so a
    // deploy onto an installation where somebody made "dscustomer" by hand
    // fills that one in rather than dying on the unique index.
    const tenantId = await resolveCustomerId(pool, {
      id: CUSTOMER_ID,
      slug: CUSTOMER_SLUG,
    });
    await enterTenant(pool, tenantId);

    if (onlyIfMissing) {
      const { rowCount } = await pool.query("SELECT 1 FROM customers WHERE id = $1", [
        tenantId,
      ]);
      if (rowCount !== null && rowCount > 0) {
        await pool.query("ROLLBACK");
        return `${CUSTOMER_NAME} already exists; nothing was written.`;
      }
    }

    const customerId = await upsert(
      pool,
      `INSERT INTO customers (id, slug, name) VALUES ($1,$2,$3)
       ON CONFLICT (id) DO UPDATE SET slug = EXCLUDED.slug, name = EXCLUDED.name, updated_at = now()
       RETURNING id`,
      [tenantId, CUSTOMER_SLUG, CUSTOMER_NAME],
    );

    const departmentId = await upsert(
      pool,
      `INSERT INTO departments (customer_id, slug, name) VALUES ($1,$2,$3)
       ON CONFLICT (customer_id, slug) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
       RETURNING id`,
      [customerId, DEPARTMENT_SLUG, DEPARTMENT_NAME],
    );

    // The portal channel, and the only one this customer has: there is no
    // Keycloak realm to bind to and inventing an issuer would make a default
    // installation fail its own boot check.
    const projectId = await seedPortalProject(pool, {
      customerId,
      departmentId,
      slug: PROJECT_SLUG,
      name: PROJECT_NAME,
    });

    const password = await participantPassword();
    await seedParticipant(pool, {
      customerId,
      email: PARTICIPANT_EMAIL,
      firstName: "DS",
      lastName: "Teilnehmende",
      passwordHash: password.hash,
    });

    const courseId = await upsert(
      pool,
      `INSERT INTO courses (
         -- 'published': a seeded course is meant to be visible. The column
         -- defaults to 'draft' (P53-01), which is right for a course created
         -- in the console and wrong for one the seed exists to publish.
         customer_id, project_id, slug, title, description, delivery_type, status,
         thema, altersgruppe, cme_points, cme_category, vnr, accreditation_body,
         event_location, organizer, required_watch_percent,
         pass_threshold_percent, reveal_correct_answers,
         learning_objectives, target_audience, scientific_lead_name,
         certificate_issue_place, stamp_image, stamp_image_mime,
         signature_image, signature_image_mime
       ) VALUES (
         $1,$2,$3,$4,$5,'on_demand','published',
         ARRAY['Lorem'], ARRAY['Erwachsene'],
         -- No points, no VNR, no accreditation body. A course with points is a
         -- course the EIV worker will try to report; this one is complete and
         -- cannot reach a third party.
         NULL, NULL, NULL, NULL,
         'online', $6, 80,
         70, true,
         $7, $8, $9,
         $10, $11, 'image/png', $11, 'image/png'
       )
       ON CONFLICT (project_id, slug) DO UPDATE SET
         /*
          * A starting value where there is nothing, never a replacement
          * (P171-02).
          *
          * These four were unconditional, and this is the seed an operator is
          * *meant* to find and work in — so the first thing anybody does with a
          * fresh installation is edit DSCourse, and the next deploy put the
          * lorem ipsum back. The file's own header says it is "idempotent on
          * its slugs … so the first deploy and the fiftieth produce the same
          * rows", which is true and is the defect: identical rows are what a
          * fixture wants and the opposite of what a starting point wants.
          *
          * title is NOT NULL and learning_objectives is
          * text[] NOT NULL DEFAULT '{}', so neither has a NULL to fall back
          * from: an existing row keeps what it has, and the empty array is
          * treated as the empty state it is.
          *
          * Found by scripts/check-seed-overwrites.mjs on its first run, which
          * is the point of writing the check rather than another list.
          */
         title = courses.title,
         description = COALESCE(courses.description, EXCLUDED.description),
         learning_objectives = CASE
                                 WHEN courses.learning_objectives = '{}'
                                   THEN EXCLUDED.learning_objectives
                                 ELSE courses.learning_objectives
                               END,
         target_audience = COALESCE(courses.target_audience, EXCLUDED.target_audience),
         updated_at = now()
       RETURNING id`,
      [
        customerId,
        projectId,
        COURSE_SLUG,
        "DSCourse – Lorem ipsum dolor sit amet",
        LOREM,
        CUSTOMER_NAME,
        [
          "Lorem ipsum dolor sit amet consetetur",
          "Sadipscing elitr sed diam nonumy",
          "Eirmod tempor invidunt ut labore",
        ],
        `${LOREM}\n\nAt vero eos et accusam et justo duo dolores et ea rebum.`,
        "Dr. Lorem Ipsum",
        "Musterstadt",
        PLACEHOLDER_IMAGE,
      ],
    );

    await resetCourseContent(pool, courseId);

    await pool.query("DELETE FROM course_experts WHERE course_id = $1", [courseId]);
    await pool.query(
      `INSERT INTO course_experts
         (customer_id, course_id, ordinal, role_label, name, institution, biography)
       VALUES ($1,$2,0,'Wissenschaftliche Leitung','Dr. Lorem Ipsum','Musterinstitut',$3)`,
      [customerId, courseId, LOREM],
    );

    let quizContentId: string | undefined;

    // `flatIndex` numbers chapters across the whole course, so the media paths
    // and the `DSMaterial N` labels stay the sequence they were before the
    // course gained a second module. A per-module counter would have renamed
    // half the fixture's files for no reason anybody could see.
    let flatIndex = 0;

    for (const [moduleOrdinal, module] of MODULES.entries()) {
      const moduleId = await upsert(
        pool,
        `INSERT INTO modules (customer_id, course_id, ordinal, title, subtitle)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [
          customerId,
          courseId,
          moduleOrdinal,
          module.title,
          "Lorem ipsum · dolor sit amet · consetetur",
        ],
      );

      for (const [chapterOrdinal, chapter] of module.chapters.entries()) {
        const ordinal = flatIndex;
        flatIndex += 1;

        const chapterId = await upsert(
          pool,
          `INSERT INTO chapters (customer_id, module_id, ordinal, title)
           VALUES ($1,$2,$3,$4) RETURNING id`,
          [customerId, moduleId, chapterOrdinal, chapter.title],
        );

        const mediaBase = `https://media.example.org/${COURSE_SLUG}/${ordinal + 1}`;
        await pool.query(
          `INSERT INTO contents (customer_id, chapter_id, ordinal, kind, title,
                               media_sources, poster_url, duration_sec)
         VALUES ($1,$2,0,'video',$3,$4::jsonb,$5,$6)`,
          [
            customerId,
            chapterId,
            chapter.title,
            JSON.stringify([
              {
                url: `${mediaBase}.m3u8`,
                mimeType: "application/vnd.apple.mpegurl",
                label: "Automatisch",
              },
              { url: `${mediaBase}-720.mp4`, mimeType: "video/mp4", label: "720p" },
            ]),
            `${mediaBase}.jpg`,
            chapter.durationSec,
          ],
        );

        // One download per chapter, with a description — the Mediathek card
        // renders it (#62), and a grid of title-only cards looks nothing like
        // the layout an operator is comparing against.
        await pool.query(
          `INSERT INTO contents (customer_id, chapter_id, ordinal, kind, title, body,
                               file_url, mime_type, file_size)
         VALUES ($1,$2,8,'material',$3,$4,$5,'application/pdf',262144)`,
          [
            customerId,
            chapterId,
            `DSMaterial ${String(ordinal + 1)} (PDF)`,
            LOREM,
            `${mediaBase}.pdf`,
          ],
        );

        // Last chapter of the last module, and nowhere else. A quiz content
        // with no questions is a 500 for whoever opens it.
        if (
          moduleOrdinal === MODULES.length - 1 &&
          chapterOrdinal === module.chapters.length - 1
        ) {
          quizContentId = await upsert(
            pool,
            `INSERT INTO contents (customer_id, chapter_id, ordinal, kind, title)
             VALUES ($1,$2,9,'quiz',$3) RETURNING id`,
            [customerId, chapterId, "Lernerfolgskontrolle"],
          );
        }
      }
    }

    if (quizContentId !== undefined) {
      for (let i = 0; i < QUESTION_COUNT; i += 1) {
        const questionId = await upsert(
          pool,
          `INSERT INTO quiz_questions (customer_id, content_id, ordinal, kind, prompt)
           VALUES ($1,$2,$3,'single',$4) RETURNING id`,
          [customerId, quizContentId, i, `DSFrage ${String(i + 1)} — lorem ipsum?`],
        );

        for (let option = 0; option < 4; option += 1) {
          await pool.query(
            `INSERT INTO quiz_options (customer_id, question_id, ordinal, label, is_correct)
             VALUES ($1,$2,$3,$4,$5)`,
            [
              customerId,
              questionId,
              option,
              `Lorem ${String.fromCharCode(65 + option)} — dolor sit amet`,
              option === 0,
            ],
          );
        }
      }
    }

    /*
     * Seeded once, never rewritten — see `medice-adhs.ts` for the deploy this
     * broke (P84-01). `evaluation_responses.evaluation_id` is
     * `ON DELETE RESTRICT`, so the first learner to answer pins these rows and
     * a re-seeding deploy dies on the foreign key rather than merely skipping
     * the seed.
     */
    if (await hasNoEvaluation(pool, courseId)) {
      await pool.query(
        `INSERT INTO evaluations (customer_id, course_id, ordinal, prompt, kind, required, options)
         VALUES
           ($1,$2,0,'Wie bewerten Sie die Fortbildung insgesamt?','scale',true,$3::jsonb),
           ($1,$2,1,'War der Inhalt für Ihre Praxis relevant?','scale',true,$3::jsonb),
           ($1,$2,2,'Anmerkungen','text',false,'[]'::jsonb)`,
        [customerId, courseId, JSON.stringify(["1", "2", "3", "4", "5"])],
      );
    }

    /*
     * The two console accounts (P38-01), and why `revealPasswords` is tied to
     * the same flag the participant password is.
     *
     * This seed is the one `deploy.sh` may run unattended, and an unattended
     * run's report goes into a GitHub Actions log. A staff password there is
     * worse than a participant's: it opens the console for a whole customer.
     */
    const staff = await seedDemoStaff(pool, {
      customerId,
      customerSlug: CUSTOMER_SLUG,
      revealPasswords: revealPassword,
    });

    await pool.query("COMMIT");

    return [
      "Seeded the default DS customer.",
      `  customer     ${CUSTOMER_NAME}      (slug ${CUSTOMER_SLUG})`,
      `  organisation ${DEPARTMENT_NAME}  (slug ${DEPARTMENT_SLUG})`,
      `  project      ${PROJECT_NAME}       (slug ${PROJECT_SLUG})`,
      `  course       DSCourse         (slug ${COURSE_SLUG})`,
      `  modules      ${MODULES.map((m) => `${m.title} (${String(m.chapters.length)} chapters)`).join(", ")}`,
      `  quiz         ${String(QUESTION_COUNT)} questions, in the last chapter of the last module`,
      "",
      `Portal sign-in at /${PROJECT_SLUG}:`,
      `  E-Mail    ${PARTICIPANT_EMAIL}`,
      passwordLine(password.supplied, password.plaintext, revealPassword),
      "",
      ...describeDemoStaff(staff),
      "",
      "No VNR, no accreditation body and no CME points — deliberately. Every",
      "gate, the quiz, the evaluation and the certificate path work; the",
      "certificate simply carries no points, and nothing here can reach EIV.",
      "",
      "The prose is lorem ipsum on purpose. A placeholder somebody might",
      "mistake for content is a placeholder that ships.",
    ].join("\n");
  } catch (error) {
    await pool.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

/**
 * What the report says about the demo account's password.
 *
 * Three cases, and the third is the one worth having a function for: an
 * unattended run generated a password and must not say what it is. The account
 * still exists and is still usable — an administrator sets a password for it on
 * the Teilnehmende screen (P21-04), which is the path a real participant's
 * credential arrives by anyway.
 */
function passwordLine(supplied: boolean, plaintext: string, reveal: boolean): string {
  if (supplied) return "  Passwort  as supplied in SEED_PARTICIPANT_PASSWORD";
  if (!reveal) {
    return (
      "  Passwort  generated and deliberately not printed — this run was " +
      "unattended.\n            Set one under Teilnehmende in the console, or " +
      "re-run with\n            SEED_PARTICIPANT_PASSWORD set."
    );
  }
  return `  Passwort  ${plaintext}`;
}
