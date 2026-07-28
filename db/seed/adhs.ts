/**
 * Development seed: the MEDICE ADHS course as accredited (P0-05).
 *
 * Values come from the Anerkennungsbescheid (ÄKWL, 18.06.2026) and
 * `docs/requirements/medice-adhs.md` §5 — not invented. Where the requirement
 * is genuinely unresolved the seed uses the stricter reading and says so, so
 * that running this locally does not quietly manufacture an answer to a
 * question the Ärztekammer has not given (`CLAUDE.md` §7).
 *
 * Idempotent: re-running updates rather than duplicating, keyed on the slugs.
 * Safe to run against a database that already has data.
 *
 * Runs as `ds_migrator` (`MIGRATION_DATABASE_URL`) because it creates the
 * customer itself, which no API caller can do — but it still sets
 * `app.customer_id` and passes through the same RLS policies the application
 * does. See the note on `CUSTOMER_ID`.
 *
 *   pnpm db:seed
 *
 * Not for production: `--force` is required against a non-local host, and no
 * VNR password is seeded at all — the EIV worker cannot authenticate until one
 * is set out of band.
 */

import pg from "pg";

/**
 * A fixed id, not a generated one, and that is load-bearing.
 *
 * `FORCE ROW LEVEL SECURITY` applies to `ds_migrator` as well, so even the
 * seed must set `app.customer_id` before it can insert a tenant-scoped row —
 * and `customers`' own policy checks `id = app.customer_id`, so the id has to
 * be known *before* the insert. Hard-coding it also makes re-runs idempotent
 * without a lookup that would itself need the context.
 *
 * The alternative — seeding as the superuser to sidestep RLS — would mean the
 * one script that creates the reference data is the one path never exercising
 * the isolation everything else depends on.
 */
const CUSTOMER_ID = "0198f4c1-7a2e-7000-8000-000000000001";
const CUSTOMER_SLUG = "medice";
const PROJECT_SLUG = "medice-adhs";
const COURSE_SLUG = "adhs-akademie-adult";

/** Per the Bescheid. The password is never committed — see `.env.example`. */
const VNR = "2760552025919300018";

interface ModuleSeed {
  readonly title: string;
  readonly subtitle: string;
  readonly chapters: ReadonlyArray<{
    readonly title: string;
    readonly videoTitle: string;
    readonly durationSec: number;
  }>;
}

/**
 * The five modules from the layout's Inhalte list, with the durations shown
 * there. Placeholder video URLs — real media is supplied by MEDICE.
 */
const MODULES: readonly ModuleSeed[] = [
  {
    title: "Modul 1 – Grundlagen",
    subtitle: "ADHS-Definition · Epidemiologie · Neurobiologie · Mythen vs. Fakten",
    chapters: [
      {
        title: "Kapitel 1 – Definition und Epidemiologie",
        videoTitle: "Grundlagen",
        durationSec: 1524,
      },
    ],
  },
  {
    title: "Modul 2 – Diagnostik",
    subtitle: "ICD-11 & DSM-5 Kriterien · Anamnese · Screening-Tools",
    chapters: [
      {
        title: "Kapitel 1 – Kriterien und Anamnese",
        videoTitle: "Diagnostik",
        durationSec: 2140,
      },
    ],
  },
  {
    title: "Modul 3 – Pharmakotherapie",
    subtitle:
      "Stimulanzien & Nicht-Stimulanzien · Dosierung · Nebenwirkungen · Monitoring",
    chapters: [
      {
        title: "Kapitel 1 – Stimulanzien & Nicht-Stimulanzien",
        videoTitle: "Pharmakotherapie",
        durationSec: 1545,
      },
    ],
  },
  {
    title: "Modul 4 – Psychotherapie & Coaching",
    subtitle: "Psychoedukation · Verhaltenstherapie · Lifestyle-Interventionen",
    chapters: [
      {
        title: "Kapitel 1 – Verhaltenstherapie",
        videoTitle: "Psychotherapie",
        durationSec: 1992,
      },
    ],
  },
  {
    title: "Modul 5 – Komorbiditäten",
    subtitle: "Depression, Angst, Sucht · Spezielle Patientengruppen · Langzeitbetreuung",
    chapters: [
      {
        title: "Kapitel 1 – Komorbide Störungen",
        videoTitle: "Komorbiditäten",
        durationSec: 1065,
      },
    ],
  },
];

/** 11 single-choice questions, per MEDICE. Placeholder text. */
const QUESTION_COUNT = 11;

async function main(): Promise<void> {
  const connectionString = process.env["MIGRATION_DATABASE_URL"];
  if (connectionString === undefined) {
    throw new Error("MIGRATION_DATABASE_URL is not set.");
  }

  const force = process.argv.includes("--force");
  const host = new URL(connectionString.replace(/^postgres/, "http")).hostname;
  const isLocal = host === "127.0.0.1" || host === "localhost" || host === "postgres";
  if (!isLocal && !force) {
    throw new Error(
      `Refusing to seed a non-local database (${host}). Pass --force if you are certain.`,
    );
  }

  const pool = new pg.Pool({ connectionString });

  try {
    await pool.query("BEGIN");

    // Transaction-local, exactly as `runInTenant` does for a request. Every
    // statement below is therefore checked by the same RLS policies the API
    // runs under (ADR-0002).
    await pool.query("SELECT set_config('app.customer_id', $1, true)", [CUSTOMER_ID]);
    await pool.query("SELECT set_config('app.role', 'system', true)");

    const customerId = await upsert(
      pool,
      `INSERT INTO customers (id, slug, name) VALUES ($1,$2,$3)
       ON CONFLICT (id) DO UPDATE SET slug = EXCLUDED.slug, name = EXCLUDED.name, updated_at = now()
       RETURNING id`,
      [CUSTOMER_ID, CUSTOMER_SLUG, "MEDICE Arzneimittel Pütter GmbH & Co. KG"],
    );

    const departmentId = await upsert(
      pool,
      `INSERT INTO departments (customer_id, slug, name) VALUES ($1,$2,$3)
       ON CONFLICT (customer_id, slug) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
       RETURNING id`,
      [customerId, "adhs", "ADHS"],
    );

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
        "ADHS Akademie",
        process.env["KEYCLOAK_ISSUER"] ?? "http://127.0.0.1:8080/realms/ds-dev",
        process.env["KEYCLOAK_AUDIENCE"] ?? "ds-education-api",
        "ds-dev",
      ],
    );

    const courseId = await upsert(
      pool,
      `INSERT INTO courses (
         customer_id, project_id, slug, title, description, delivery_type,
         thema, altersgruppe, vnr, accreditation_body, cme_points, cme_category,
         event_location, organizer, valid_from, valid_to,
         required_watch_percent, pass_threshold_percent, max_quiz_attempts,
         reveal_correct_answers, learning_objectives, target_audience
       ) VALUES (
         $1,$2,$3,$4,$5,'on_demand',
         ARRAY['ADHS'], ARRAY['Erwachsene'], $6, $7, 4, 'D',
         'online', $8, $9, $10,
         100, 70, NULL,
         false, $11, $12
       )
       ON CONFLICT (project_id, slug) DO UPDATE SET
         title = EXCLUDED.title,
         description = EXCLUDED.description,
         cme_points = EXCLUDED.cme_points,
         cme_category = EXCLUDED.cme_category,
         pass_threshold_percent = EXCLUDED.pass_threshold_percent,
         required_watch_percent = EXCLUDED.required_watch_percent,
         learning_objectives = EXCLUDED.learning_objectives,
         target_audience = EXCLUDED.target_audience,
         updated_at = now()
       RETURNING id`,
      [
        customerId,
        projectId,
        COURSE_SLUG,
        // Exactly as accredited. Not "ADHS bei Erwachsenen".
        "ADHS Akademie adult",
        "Fortbildung zu ADHS im Erwachsenenalter mit CME-Zertifizierung.",
        VNR,
        "Ärztekammer Westfalen-Lippe",
        "Medice Arzneimittel Pütter GmbH & Co. KG, Iserlohn",
        new Date("2025-10-13T00:00:00Z"),
        new Date("2026-10-12T23:59:59Z"),
        [
          "Sichere Diagnosestellung von ADHS im Erwachsenenalter",
          "Differenzialdiagnostische Abgrenzung zu anderen psychiatrischen Störungen",
          "Evidenzbasierte Therapieoptionen: Medikation und Psychotherapie",
          "Umgang mit Komorbiditäten und komplexen Krankheitsverläufen",
          "Praktische Gesprächsführung und Patientenedukation",
          "Langzeitmanagement und Monitoring der Behandlung",
        ],
        [
          "Alle niedergelassenen und klinisch tätigen Ärztinnen und Ärzte, die Erwachsene mit ADHS diagnostizieren, behandeln oder in ihrer Praxis betreuen – insbesondere:",
          "· Fachärzte für Psychiatrie und Psychotherapie",
          "· Fachärzte für Psychosomatische Medizin",
          "· Fachärzte für Allgemeinmedizin mit psychiatrischem Versorgungsauftrag",
          "· Ärzte in Weiterbildung der genannten Fachrichtungen",
        ].join("\n"),
      ],
    );

    // Rebuild the tree rather than reconciling it: content has no stable
    // external key, so a partial update would leave orphans. Deletion runs
    // child-first because the foreign keys are RESTRICT, not CASCADE —
    // deliberately, since in production nothing should be able to delete
    // content that a learner's progress or quiz attempt still references.
    //
    // That this seed *does* delete such rows is exactly why it is refused
    // against a non-local database without --force: it discards learner data
    // for this course.
    const contentScope = `chapter_id IN (
       SELECT c.id FROM chapters c JOIN modules m ON m.id = c.module_id
        WHERE m.course_id = $1)`;

    for (const statement of [
      `DELETE FROM quiz_answers WHERE attempt_id IN (
         SELECT id FROM quiz_attempts WHERE content_id IN (SELECT id FROM contents WHERE ${contentScope}))`,
      `DELETE FROM quiz_attempts WHERE content_id IN (SELECT id FROM contents WHERE ${contentScope})`,
      `DELETE FROM quiz_options WHERE question_id IN (
         SELECT id FROM quiz_questions WHERE content_id IN (SELECT id FROM contents WHERE ${contentScope}))`,
      `DELETE FROM quiz_questions WHERE content_id IN (SELECT id FROM contents WHERE ${contentScope})`,
      `DELETE FROM content_progress WHERE content_id IN (SELECT id FROM contents WHERE ${contentScope})`,
      `UPDATE enrolments SET last_content_id = NULL WHERE course_id = $1`,
      `DELETE FROM contents WHERE ${contentScope}`,
      `DELETE FROM chapters WHERE module_id IN (SELECT id FROM modules WHERE course_id = $1)`,
      `DELETE FROM modules WHERE course_id = $1`,
    ]) {
      await pool.query(statement, [courseId]);
    }

    let quizContentId: string | undefined;

    for (const [moduleOrdinal, module] of MODULES.entries()) {
      const moduleId = await upsert(
        pool,
        `INSERT INTO modules (customer_id, course_id, ordinal, title, subtitle)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [customerId, courseId, moduleOrdinal, module.title, module.subtitle],
      );

      for (const [chapterOrdinal, chapter] of module.chapters.entries()) {
        const chapterId = await upsert(
          pool,
          `INSERT INTO chapters (customer_id, module_id, ordinal, title)
           VALUES ($1,$2,$3,$4) RETURNING id`,
          [customerId, moduleId, chapterOrdinal, chapter.title],
        );

        await pool.query(
          `INSERT INTO contents (customer_id, chapter_id, ordinal, kind, title, video_url, duration_sec)
           VALUES ($1,$2,0,'video',$3,$4,$5)`,
          [
            customerId,
            chapterId,
            chapter.videoTitle,
            `https://media.example.org/${COURSE_SLUG}/${moduleOrdinal + 1}.mp4`,
            chapter.durationSec,
          ],
        );

        // Mediathek download per module, matching the layout's "Materialien zu
        // Modul N" grouping.
        await pool.query(
          `INSERT INTO contents (customer_id, chapter_id, ordinal, kind, title, file_url, mime_type, file_size)
           VALUES ($1,$2,8,'material',$3,$4,'application/pdf',524288)`,
          [
            customerId,
            chapterId,
            `Patienteninformation ${module.title} (PDF)`,
            `https://media.example.org/${COURSE_SLUG}/${moduleOrdinal + 1}.pdf`,
          ],
        );

        // One Lernerfolgskontrolle, at the end of the last module.
        if (moduleOrdinal === MODULES.length - 1) {
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
          [
            customerId,
            quizContentId,
            i,
            `Frage ${i + 1} – Platzhalter (Text von MEDICE)`,
          ],
        );

        for (let option = 0; option < 4; option += 1) {
          await pool.query(
            `INSERT INTO quiz_options (customer_id, question_id, ordinal, label, is_correct)
             VALUES ($1,$2,$3,$4,$5)`,
            [
              customerId,
              questionId,
              option,
              `Antwortoption ${String.fromCharCode(65 + option)}`,
              option === 0,
            ],
          );
        }
      }
    }

    await pool.query("DELETE FROM evaluations WHERE course_id = $1", [courseId]);
    await pool.query(
      `INSERT INTO evaluations (customer_id, course_id, ordinal, prompt, kind, required, options)
       VALUES
         ($1,$2,0,'Wie bewerten Sie die Fortbildung insgesamt?','scale',true,$3::jsonb),
         ($1,$2,1,'War der Inhalt für Ihre Praxis relevant?','scale',true,$3::jsonb),
         ($1,$2,2,'Anmerkungen','text',false,'[]'::jsonb)`,
      [customerId, courseId, JSON.stringify(["1", "2", "3", "4", "5"])],
    );

    await pool.query("COMMIT");

    console.warn(
      [
        "Seeded the MEDICE ADHS course.",
        `  customer  ${CUSTOMER_SLUG}`,
        `  project   ${PROJECT_SLUG}   (send as X-DS-Project)`,
        `  course    ${COURSE_SLUG}`,
        `  modules   ${MODULES.length}, ${QUESTION_COUNT} quiz questions`,
        "",
        "required_watch_percent is seeded at 100 — the stricter of the two",
        "readings (layout says 80, MEDICE-292 says 100). See",
        "docs/show-stoppers.md before treating it as settled.",
        "",
        "No VNR password is seeded. Set courses.vnr_password_enc via the admin",
        "path before the EIV worker can authenticate.",
      ].join("\n"),
    );
  } catch (error) {
    await pool.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await pool.end();
  }
}

async function upsert(pool: pg.Pool, sql: string, values: unknown[]): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(sql, values);
  const id = rows[0]?.id;
  if (id === undefined) throw new Error(`seed statement returned no id:\n${sql}`);
  return id;
}

await main();
