/**
 * The DS test tenant — a second customer, so isolation is something you can
 * look at (P20-01).
 *
 * ## Why a second customer exists at all
 *
 * The platform is multi-tenant and, until this, had exactly one tenant. A
 * tenant-isolation suite proves cross-tenant reads return zero rows, which is
 * the thing that matters and is not the thing anybody can *see*. An operator
 * signing into the console met a customer registry with one entry and a
 * "which customer?" question that had one answer.
 *
 * `ds` is that second answer. It is DigitalSpital's own, it carries no real
 * accreditation, and it exists so that:
 *
 *   * the console's customer registry, project picker and cross-customer
 *     screens have something to be wrong about;
 *   * a staff account scoped to one customer can be shown *not* seeing the
 *     other, on the deployed installation rather than only in a test;
 *   * the portal and the widget can be pointed at a project that is not
 *     MEDICE's, which is the only way to find the places where "the project"
 *     was quietly assumed to be theirs.
 *
 * ## The two courses, and why two
 *
 * `ds-cme-demo` carries points, a VNR and a quiz: the full path, through a
 * Punktemeldung to a certificate.
 *
 * `ds-ohne-punkte` carries **no CME points and no VNR**, because a course
 * without points is a real case the client asked for and a case nothing else
 * exercises. Everything downstream has to cope: the card's metadata line has
 * no "4 CME Punkte" to print, the Zertifizierung tab has no accreditation to
 * describe, completion produces no EIV submission, and no certificate is
 * issued. A seeded example is how those stay honest.
 *
 * ## What this is not
 *
 * Not a production fixture. The VNR is a documented dummy and the
 * Ärztekammer is named as fictional. The caller owns the connection and the
 * refusal to touch a database it should not — see `openSeedPool`.
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
} from "./lib.js";
import { describeDemoStaff, seedDemoStaff } from "./staff.js";

/**
 * Fixed, for the same reason as MEDICE's: `customers`' own RLS policy checks
 * `id = app.customer_id`, so the id has to be known before the insert that
 * creates the row. Ends `…002` so the two are distinguishable at a glance in a
 * log line.
 */
const CUSTOMER_ID = "0198f4c1-7a2e-7000-8000-000000000002";
const CUSTOMER_SLUG = "ds";
const PROJECT_SLUG = "ds-demo";

/**
 * The portal channel — `fortbildung.digitalspital.com/ds`. See
 * `seedPortalProject` for why this is a second project and not a flag on the
 * first one.
 *
 * Seeding it for *both* customers is what makes the cross-tenant test possible
 * over real HTTP: a session minted at `/ds` presented with `X-DS-Project:
 * medice` must be refused, and asking that needs two local projects.
 */
const PORTAL_PROJECT_SLUG = CUSTOMER_SLUG;

const PARTICIPANT_EMAIL = "demo@ds.example";

const CME_COURSE_SLUG = "ds-cme-demo";
const FREE_COURSE_SLUG = "ds-ohne-punkte";

/**
 * A dummy. The real format is 19 digits and this one is deliberately not a
 * valid registration — it exists so the certificate's two barcodes have
 * something to encode, and it must never reach the live EIV endpoint. The
 * deploy refuses an `EIV_BASE_URL` pointing at eiv-fobi.de without an explicit
 * `EIV_ALLOW_LIVE=yes` (ADR-0005), which is the guard that makes seeding this
 * safe.
 */
const DUMMY_VNR = "9999999999999999999";

interface ChapterSeed {
  readonly title: string;
  readonly videoTitle: string;
  readonly durationSec: number;
}

interface ModuleSeed {
  readonly title: string;
  readonly subtitle: string;
  readonly chapters: readonly ChapterSeed[];
}

/**
 * Three modules for the CME course, every one of them with **several
 * chapters** (P52-03).
 *
 * The chapter counts are the point. Until P52-03 every module in every seeded
 * course but one held a single chapter, which meant the sequence gate was only
 * ever exercised *between* modules and never *within* one — and the two are
 * different code paths in `courseChapterSequence`. A fixture that cannot
 * produce "chapter 2 is locked until chapter 1 is done" is a fixture that
 * cannot show the gate working or failing.
 *
 * It also immediately found a real defect in `seedContent` below, which put a
 * quiz in every chapter of the last module and questions in only the last of
 * them. Invisible while last modules had one chapter; a 500 for any learner
 * opening the others.
 *
 * Durations are odd numbers on purpose. A course's total time is computed from
 * its videos rather than typed by an author, and round numbers hide a
 * summation that is off by a chapter.
 */
const CME_MODULES: readonly ModuleSeed[] = [
  {
    title: "Modul 1 – Einführung",
    subtitle: "Was diese Demo zeigt · Aufbau · Navigation",
    chapters: [
      { title: "Kapitel 1 – Überblick", videoTitle: "Einführung", durationSec: 733 },
      {
        title: "Kapitel 2 – Aufbau",
        videoTitle: "Aufbau der Fortbildung",
        durationSec: 419,
      },
    ],
  },
  {
    title: "Modul 2 – Der Player",
    subtitle: "Fortschritt · Wiederaufnahme · Kein Vorspulen",
    chapters: [
      { title: "Kapitel 1 – Wiedergabe", videoTitle: "Wiedergabe", durationSec: 1147 },
      { title: "Kapitel 2 – Fortschritt", videoTitle: "Fortschritt", durationSec: 512 },
      {
        title: "Kapitel 3 – Wiederaufnahme",
        videoTitle: "Wiederaufnahme",
        durationSec: 377,
      },
    ],
  },
  {
    title: "Modul 3 – Abschluss",
    subtitle: "Lernerfolgskontrolle · Evaluation · Zertifikat",
    chapters: [
      {
        title: "Kapitel 1 – Zusammenfassung",
        videoTitle: "Zusammenfassung",
        durationSec: 946,
      },
      // The quiz lands here, in the last chapter of the last module, and
      // nowhere else.
      { title: "Kapitel 2 – Abschluss", videoTitle: "Abschluss", durationSec: 604 },
    ],
  },
];

/**
 * Two modules for the point-free course, two chapters each, and deliberately
 * no quiz.
 *
 * Also multi-chapter (P52-03): the gate does not care whether a course awards
 * points, so the course that awards none is where a gate bug would survive
 * longest if this one were left shallow.
 */
const FREE_MODULES: readonly ModuleSeed[] = [
  {
    title: "Modul 1 – Ohne Zertifizierung",
    subtitle: "Eine Fortbildung, die keine CME-Punkte vergibt",
    chapters: [
      { title: "Kapitel 1 – Einführung", videoTitle: "Einführung", durationSec: 421 },
      { title: "Kapitel 2 – Einordnung", videoTitle: "Einordnung", durationSec: 293 },
    ],
  },
  {
    title: "Modul 2 – Vertiefung",
    subtitle: "Weiterführende Inhalte",
    chapters: [
      { title: "Kapitel 1 – Vertiefung", videoTitle: "Vertiefung", durationSec: 688 },
      { title: "Kapitel 2 – Ausblick", videoTitle: "Ausblick", durationSec: 351 },
    ],
  },
];

const QUESTION_COUNT = 5;

/**
 * Seed the tenant, in one transaction, and return the report the caller
 * prints.
 *
 * Returns a string rather than logging: this runs from a `tsx` script and from
 * inside the API image, and which stream the summary belongs on is the
 * entrypoint's business, not this function's.
 */
export async function seedDsDemo(pool: pg.Pool): Promise<string> {
  try {
    await pool.query("BEGIN");
    // See `resolveCustomerId`: adopt whatever already holds this slug.
    const tenantId = await resolveCustomerId(pool, {
      id: CUSTOMER_ID,
      slug: CUSTOMER_SLUG,
    });
    await enterTenant(pool, tenantId);

    const customerId = await upsert(
      pool,
      `INSERT INTO customers (id, slug, name) VALUES ($1,$2,$3)
       ON CONFLICT (id) DO UPDATE SET slug = EXCLUDED.slug, name = EXCLUDED.name, updated_at = now()
       RETURNING id`,
      [tenantId, CUSTOMER_SLUG, "DigitalSpital (Testkunde)"],
    );

    const departmentId = await upsert(
      pool,
      `INSERT INTO departments (customer_id, slug, name) VALUES ($1,$2,$3)
       ON CONFLICT (customer_id, slug) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
       RETURNING id`,
      [customerId, "demo", "Demo"],
    );

    /*
     * Its **own** realm, not MEDICE's.
     *
     * The API validates a learner's token against `projects.keycloak_issuer`,
     * resolved per request (P17-02). Two projects sharing one issuer would
     * pass every test and prove nothing: the interesting question is whether a
     * token minted for one customer's realm is refused by the other's project,
     * and asking it needs two issuers.
     *
     * Overridable so a local run can point both at one dev realm when that is
     * what is being worked on.
     */
    const projectId = await upsert(
      pool,
      `INSERT INTO projects (customer_id, department_id, slug, name, keycloak_issuer, keycloak_audience, keycloak_realm)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (department_id, slug) DO UPDATE
         SET name = EXCLUDED.name,
             keycloak_issuer = EXCLUDED.keycloak_issuer,
             keycloak_audience = EXCLUDED.keycloak_audience,
             updated_at = now()
       RETURNING id`,
      [
        customerId,
        departmentId,
        PROJECT_SLUG,
        "DS Demo",
        process.env["DS_DEMO_KEYCLOAK_ISSUER"] ?? "http://127.0.0.1:8080/realms/ds-demo",
        process.env["DS_DEMO_KEYCLOAK_AUDIENCE"] ?? "ds-education-api",
        "ds-demo",
      ],
    );

    await seedPortalProject(pool, {
      customerId,
      departmentId,
      slug: PORTAL_PROJECT_SLUG,
      name: "DS Demo (Portal)",
    });

    const password = await participantPassword();
    await seedParticipant(pool, {
      customerId,
      email: PARTICIPANT_EMAIL,
      firstName: "Demo",
      lastName: "Teilnehmende",
      passwordHash: password.hash,
    });

    const cmeCourseId = await seedCourse(pool, {
      customerId,
      projectId,
      slug: CME_COURSE_SLUG,
      title: "DS Demo – Fortbildung mit CME-Punkten",
      description:
        "Testfortbildung des DS-Mandanten. Vergibt 3 CME-Punkte und erzeugt " +
        "eine Punktemeldung sowie ein Zertifikat.",
      cmePoints: 3,
      cmeCategory: "D",
      vnr: DUMMY_VNR,
      accreditationBody: "Musterärztekammer (fiktiv, nur zu Testzwecken)",
    });

    const freeCourseId = await seedCourse(pool, {
      customerId,
      projectId,
      slug: FREE_COURSE_SLUG,
      title: "DS Demo – Fortbildung ohne Punkte",
      description:
        "Testfortbildung ohne CME-Zertifizierung. Sie hat keine Punkte, keine " +
        "VNR und keine Lernerfolgskontrolle — der Abschluss erzeugt weder eine " +
        "Punktemeldung noch ein Zertifikat.",
      // Null, not zero. `cme_points > 0` is a check constraint, and zero would
      // anyway mean "accredited for nothing" rather than "not accredited".
      cmePoints: null,
      cmeCategory: null,
      vnr: null,
      accreditationBody: null,
    });

    await seedContent(pool, {
      customerId,
      courseId: cmeCourseId,
      slug: CME_COURSE_SLUG,
      modules: CME_MODULES,
      withQuiz: true,
    });

    await seedContent(pool, {
      customerId,
      courseId: freeCourseId,
      slug: FREE_COURSE_SLUG,
      modules: FREE_MODULES,
      withQuiz: false,
    });

    /*
     * The evaluation is on **both** courses, including the point-free one.
     *
     * Whether a course reports points and whether it asks what the learner
     * thought of it are unrelated questions, and the platform treats them as
     * unrelated: completion requires the evaluation either way. Seeding it on
     * only the accredited course would have hidden that.
     */
    for (const courseId of [cmeCourseId, freeCourseId]) {
      await pool.query("DELETE FROM evaluations WHERE course_id = $1", [courseId]);
      await pool.query(
        `INSERT INTO evaluations (customer_id, course_id, ordinal, prompt, kind, required, options)
         VALUES
           ($1,$2,0,'Wie bewerten Sie die Fortbildung insgesamt?','scale',true,$3::jsonb),
           ($1,$2,1,'Anmerkungen','text',false,'[]'::jsonb)`,
        [customerId, courseId, JSON.stringify(["1", "2", "3", "4", "5"])],
      );
    }

    /*
     * The two console accounts for this tenant (P38-01).
     *
     * Inside the same transaction as everything else: a tenant that exists with
     * nobody able to open it is the state this seed's report used to describe
     * as a deliberate omission, and it was the reason "log in to Verwaltung and
     * look at the demo customer" meant using the super administrator.
     */
    const staff = await seedDemoStaff(pool, {
      customerId,
      customerSlug: CUSTOMER_SLUG,
    });

    await pool.query("COMMIT");

    return [
      "Seeded the DS test tenant.",
      `  customer  ${CUSTOMER_SLUG}   (DigitalSpital, Testkunde)`,
      `  project   ${PROJECT_SLUG}   (Keycloak channel)`,
      `  project   ${PORTAL_PROJECT_SLUG}        (portal channel, local sign-in)`,
      `  courses   ${CME_COURSE_SLUG}   3 CME-Punkte, ${String(QUESTION_COUNT)} Fragen`,
      `            ${FREE_COURSE_SLUG}   keine Punkte, keine VNR, kein Quiz`,
      "",
      `Portal sign-in at /${PORTAL_PROJECT_SLUG}:`,
      `  E-Mail    ${PARTICIPANT_EMAIL}`,
      password.supplied
        ? "  Passwort  as supplied in SEED_PARTICIPANT_PASSWORD"
        : `  Passwort  ${password.plaintext}`,
      "",
      "The VNR is a dummy and the Ärztekammer is fictional. Nothing here may",
      "reach the live EIV endpoint — the deploy refuses that without",
      "EIV_ALLOW_LIVE=yes (ADR-0005).",
      "",
      "",
      ...describeDemoStaff(staff),
      "",
      "Both are scoped to this customer and must not see MEDICE — which is",
      "the point of seeding them here rather than relying on the super",
      "administrator bootstrap-admin creates.",
    ].join("\n");
  } catch (error) {
    await pool.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

interface CourseSeed {
  readonly customerId: string;
  readonly projectId: string;
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly cmePoints: number | null;
  readonly cmeCategory: string | null;
  readonly vnr: string | null;
  readonly accreditationBody: string | null;
}

/**
 * One course row.
 *
 * The accreditation columns travel as one group rather than four independent
 * parameters, because they are one decision: a course either has a VNR, a
 * body, points and a category, or it has none of them. Passing them
 * separately is how a seed produces a course with points and no VNR, which is
 * a state the EIV worker has no idea what to do with.
 */
async function seedCourse(pool: pg.Pool, course: CourseSeed): Promise<string> {
  const accredited = course.cmePoints !== null;

  return upsert(
    pool,
    `INSERT INTO courses (
       customer_id, project_id, slug, title, description, delivery_type,
       thema, altersgruppe, vnr, accreditation_body, cme_points, cme_category,
       event_location, organizer, valid_from, valid_to,
       required_watch_percent, pass_threshold_percent, max_quiz_attempts,
       reveal_correct_answers, learning_objectives, target_audience,
       scientific_lead_name, scientific_lead_title, certificate_issue_place,
       stamp_image, stamp_image_mime, signature_image, signature_image_mime
     ) VALUES (
       $1,$2,$3,$4,$5,'on_demand',
       ARRAY['Demo'], ARRAY['Erwachsene'], $6, $7, $8, $9,
       'online', 'DigitalSpital GmbH', $10, $11,
       100, 70, NULL,
       true, $12, $13,
       $14, $15, 'Münster',
       $16, 'image/png', $16, 'image/png'
     )
     ON CONFLICT (project_id, slug) DO UPDATE SET
       title = EXCLUDED.title,
       description = EXCLUDED.description,
       vnr = EXCLUDED.vnr,
       accreditation_body = EXCLUDED.accreditation_body,
       cme_points = EXCLUDED.cme_points,
       cme_category = EXCLUDED.cme_category,
       valid_from = EXCLUDED.valid_from,
       valid_to = EXCLUDED.valid_to,
       reveal_correct_answers = EXCLUDED.reveal_correct_answers,
       learning_objectives = EXCLUDED.learning_objectives,
       target_audience = EXCLUDED.target_audience,
       scientific_lead_name = EXCLUDED.scientific_lead_name,
       scientific_lead_title = EXCLUDED.scientific_lead_title,
       stamp_image = EXCLUDED.stamp_image,
       stamp_image_mime = EXCLUDED.stamp_image_mime,
       signature_image = EXCLUDED.signature_image,
       signature_image_mime = EXCLUDED.signature_image_mime,
       updated_at = now()
     RETURNING id`,
    [
      course.customerId,
      course.projectId,
      course.slug,
      course.title,
      course.description,
      course.vnr,
      course.accreditationBody,
      course.cmePoints,
      course.cmeCategory,
      // A validity window only where there is an accreditation to be valid
      // within. On the point-free course both are null, which is the case the
      // EIV deadline arithmetic must never be handed.
      accredited ? new Date("2026-01-01T00:00:00Z") : null,
      accredited ? new Date("2026-12-31T23:59:59Z") : null,
      [
        "Den Aufbau der Plattform kennenlernen",
        "Den Player und die Fortschrittsmessung ausprobieren",
        accredited
          ? "Den Abschluss inklusive Punktemeldung nachvollziehen"
          : "Den Abschluss ohne Zertifizierung nachvollziehen",
      ],
      "Interne Testfortbildung. Nicht für Teilnehmende bestimmt.",
      "Muster-Leitung",
      "Dr. med.",
      PLACEHOLDER_IMAGE,
    ],
  );
}

interface ContentSeed {
  readonly customerId: string;
  readonly courseId: string;
  readonly slug: string;
  readonly modules: readonly ModuleSeed[];
  readonly withQuiz: boolean;
}

/** The module → chapter → content tree, rebuilt from scratch. */
async function seedContent(pool: pg.Pool, seed: ContentSeed): Promise<void> {
  await resetCourseContent(pool, seed.courseId);

  let quizContentId: string | undefined;

  for (const [moduleOrdinal, module] of seed.modules.entries()) {
    const moduleId = await upsert(
      pool,
      `INSERT INTO modules (customer_id, course_id, ordinal, title, subtitle)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [seed.customerId, seed.courseId, moduleOrdinal, module.title, module.subtitle],
    );

    for (const [chapterOrdinal, chapter] of module.chapters.entries()) {
      const chapterId = await upsert(
        pool,
        `INSERT INTO chapters (customer_id, module_id, ordinal, title)
         VALUES ($1,$2,$3,$4) RETURNING id`,
        [seed.customerId, moduleId, chapterOrdinal, chapter.title],
      );

      // HLS first, then two MP4 renditions: the browser takes the first `type`
      // it can play, so Safari gets the adaptive stream and everything else
      // falls through (`orderSources` in @ds/domain).
      const mediaBase =
        `https://media.example.org/${seed.slug}/` +
        `${String(moduleOrdinal + 1)}-${String(chapterOrdinal + 1)}`;

      await pool.query(
        `INSERT INTO contents (customer_id, chapter_id, ordinal, kind, title,
                               media_sources, poster_url, duration_sec)
         VALUES ($1,$2,0,'video',$3,$4::jsonb,$5,$6)`,
        [
          seed.customerId,
          chapterId,
          chapter.videoTitle,
          JSON.stringify([
            {
              url: `${mediaBase}.m3u8`,
              mimeType: "application/vnd.apple.mpegurl",
              label: "Automatisch",
            },
            { url: `${mediaBase}-720.mp4`, mimeType: "video/mp4", label: "720p" },
            { url: `${mediaBase}-360.mp4`, mimeType: "video/mp4", label: "360p" },
          ]),
          `${mediaBase}.jpg`,
          chapter.durationSec,
        ],
      );

      await pool.query(
        `INSERT INTO contents (customer_id, chapter_id, ordinal, kind, title, file_url, mime_type, file_size)
         VALUES ($1,$2,8,'material',$3,$4,'application/pdf',131072)`,
        [
          seed.customerId,
          chapterId,
          `Begleitmaterial ${module.title} (PDF)`,
          `${mediaBase}.pdf`,
        ],
      );

      /*
       * The Lernerfolgskontrolle goes in the **last chapter of the last
       * module**, and nowhere else (P52-03).
       *
       * This used to test the module only. With every last module holding one
       * chapter that was the same thing, so it was right by coincidence for as
       * long as the coincidence held. The moment module 3 gained a second
       * chapter it produced two quiz contents, gave questions to whichever came
       * last, and left the other empty — and an empty quiz is not a cosmetic
       * problem: `assessment.service.ts` throws `content=… is a quiz with no
       * questions configured`, so a learner who opened it got a 500 on the last
       * screen of the course.
       *
       * Found by deepening the fixtures rather than by a report, which is the
       * whole argument for fixtures that are shaped like real courses.
       */
      const isLastModule = moduleOrdinal === seed.modules.length - 1;
      const isLastChapter = chapterOrdinal === module.chapters.length - 1;
      if (seed.withQuiz && isLastModule && isLastChapter) {
        quizContentId = await upsert(
          pool,
          `INSERT INTO contents (customer_id, chapter_id, ordinal, kind, title)
           VALUES ($1,$2,9,'quiz',$3) RETURNING id`,
          [seed.customerId, chapterId, "Lernerfolgskontrolle"],
        );
      }
    }
  }

  if (quizContentId === undefined) return;

  for (let i = 0; i < QUESTION_COUNT; i += 1) {
    const questionId = await upsert(
      pool,
      `INSERT INTO quiz_questions (customer_id, content_id, ordinal, kind, prompt)
       VALUES ($1,$2,$3,'single',$4) RETURNING id`,
      [
        seed.customerId,
        quizContentId,
        i,
        `Demo-Frage ${String(i + 1)}: Welche Antwort ist die richtige?`,
      ],
    );

    for (let option = 0; option < 4; option += 1) {
      await pool.query(
        `INSERT INTO quiz_options (customer_id, question_id, ordinal, label, is_correct)
         VALUES ($1,$2,$3,$4,$5)`,
        [
          seed.customerId,
          questionId,
          option,
          option === 0
            ? "Diese hier (die richtige)"
            : `Antwortoption ${String.fromCharCode(65 + option)}`,
          option === 0,
        ],
      );
    }
  }
}
