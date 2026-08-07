/**
 * The MEDICE ADHS course, as accredited (P24-02, was P0-05).
 *
 * ## Why this moved out of `db/seed/`
 *
 * It used to be a `tsx` script in `db/seed/adhs.ts`, which meant it needed the
 * workspace, the checkout and a dev toolchain — **none of which exist on the
 * production host**, where the only artefact is a container. So the one seed
 * that creates the first customer's real course was the one seed that could
 * not be run where it was needed, and `fortbildung.digitalspital.com/medice`
 * was empty with nothing to say why.
 *
 * `seedDsDemo` had already solved this. This now follows the same shape: the
 * implementation lives here, `db/seed/adhs.ts` is a two-line developer runner,
 * and `apps/api/src/seed-medice.ts` is the same `main()` inside the image.
 * One implementation, two entrypoints — see `apps/api/src/db-migrate.ts` for
 * what happened the one time this repository had two copies of something like
 * this.
 *
 * ## What it seeds, and what it deliberately does not
 *
 * Values come from the Anerkennungsbescheid (ÄKWL, 18.06.2026) and
 * `docs/requirements/medice-adhs.md` §5 — not invented. Where the requirement
 * is genuinely unresolved it uses the stricter reading and says so, so that
 * running this does not quietly manufacture an answer to a question the
 * Ärztekammer has not given (CLAUDE.md §7).
 *
 * **No VNR password.** The EIV worker cannot authenticate until one is set out
 * of band, which is correct: a seed that could file a Punktemeldung is a seed
 * that can file a wrong one.
 *
 * Idempotent, keyed on the slugs: re-running updates rather than duplicating.
 */

import type pg from "pg";
import {
  enterTenant,
  participantPassword,
  PLACEHOLDER_IMAGE,
  resetCourseContent,
  seedParticipant,
  seedPortalProject,
  upsert,
} from "./lib.js";

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

/**
 * The project the standalone portal reaches, and why it is not `PROJECT_SLUG`.
 *
 * `fortbildung.digitalspital.com/medice` takes its tenant from the first path
 * segment and sends it as `X-DS-Project`, so the portal asks for a project
 * slugged exactly `medice` — which did not exist, which is why that URL
 * answered "Dieses Projekt existiert nicht." rather than showing a catalogue.
 *
 * It is a *second* project rather than a rename because the two are different
 * channels with different identity: `medice-adhs` is reached through the
 * WordPress plugin and authenticates against MEDICE's own Keycloak, and that
 * must keep working. Both belong to the same customer, and the catalogue is
 * scoped by customer under RLS, so they show the same courses.
 */
const PORTAL_PROJECT_SLUG = CUSTOMER_SLUG;

/** The demo participant. The password is never in this file — see below. */
const PARTICIPANT_EMAIL = "demo@medice.example";

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

/**
 * The Experten/Referenten tab.
 *
 * Placeholder people, deliberately: the real panel is MEDICE's to supply and a
 * seed that invented plausible names for a course carrying a real VNR would be
 * a document nobody could tell apart from the truth. What the seed is for is
 * making the tab render its layout — a role label, a name, an institution and a
 * biography — so the shape is verifiable before the content arrives.
 */
interface ExpertSeed {
  readonly roleLabel: string;
  readonly name: string;
  readonly institution: string;
  readonly biography: string;
}

const EXPERTS: readonly ExpertSeed[] = [
  {
    roleLabel: "Wissenschaftliche Leitung",
    name: "Prof. Dr. med. Muster-Leitung",
    institution: "Universitätsklinikum Heidelberg",
    biography:
      "Platzhalter. Die wissenschaftliche Leitung dieser Fortbildung wird von MEDICE benannt und ist vor Veröffentlichung zu ersetzen.",
  },
  {
    roleLabel: "Referent/Referentin",
    name: "Dr. med. Muster-Referenz",
    institution: "Charité – Universitätsmedizin Berlin",
    biography:
      "Platzhalter. Referentinnen und Referenten werden von MEDICE benannt und sind vor Veröffentlichung zu ersetzen.",
  },
];

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

export async function seedMediceAdhs(pool: pg.Pool): Promise<string> {
  try {
    await pool.query("BEGIN");

    await enterTenant(pool, CUSTOMER_ID);

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

    // The second channel: the standalone portal at /medice, whose participants
    // hold a password here rather than a MEDICE Keycloak account. Same
    // customer, same department, same courses — a different way in.
    await seedPortalProject(pool, {
      customerId,
      departmentId,
      slug: PORTAL_PROJECT_SLUG,
      name: "ADHS Akademie (Portal)",
    });

    const password = await participantPassword();
    await seedParticipant(pool, {
      customerId,
      email: PARTICIPANT_EMAIL,
      firstName: "Demo",
      lastName: "Teilnehmende",
      passwordHash: password.hash,
    });

    const courseId = await upsert(
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
         ARRAY['ADHS'], ARRAY['Erwachsene'], $6, $7, 4, 'D',
         'online', $8, $9, $10,
         100, 70, NULL,
         false, $11, $12,
         $13, $14, $15,
         $16, 'image/png', $16, 'image/png'
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
         scientific_lead_name = EXCLUDED.scientific_lead_name,
         scientific_lead_title = EXCLUDED.scientific_lead_title,
         certificate_issue_place = EXCLUDED.certificate_issue_place,
         stamp_image = EXCLUDED.stamp_image,
         stamp_image_mime = EXCLUDED.stamp_image_mime,
         signature_image = EXCLUDED.signature_image,
         signature_image_mime = EXCLUDED.signature_image_mime,
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
        "Muster-Wissenschaftliche-Leitung",
        "Prof. Dr. med.",
        "Iserlohn",
        PLACEHOLDER_IMAGE,
      ],
    );

    await resetCourseContent(pool, courseId);

    // Replaced wholesale like the modules: a seed that appended would add a
    // second copy of every expert on each run.
    await pool.query("DELETE FROM course_experts WHERE course_id = $1", [courseId]);
    for (const [ordinal, expert] of EXPERTS.entries()) {
      await pool.query(
        `INSERT INTO course_experts
           (customer_id, course_id, ordinal, role_label, name, institution, biography)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          customerId,
          courseId,
          ordinal,
          expert.roleLabel,
          expert.name,
          expert.institution,
          expert.biography,
        ],
      );
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

        // Two renditions and a poster, so the seeded course exercises the
        // player's format negotiation rather than the single-source path only.
        // HLS is listed first: the browser takes the first `type` it can play,
        // so Safari gets the adaptive stream and everything else falls through
        // to the MP4 (`orderSources` in @ds/domain).
        const mediaBase = `https://media.example.org/${COURSE_SLUG}/${moduleOrdinal + 1}`;
        await pool.query(
          `INSERT INTO contents (customer_id, chapter_id, ordinal, kind, title,
                                 media_sources, poster_url, duration_sec)
           VALUES ($1,$2,0,'video',$3,$4::jsonb,$5,$6)`,
          [
            customerId,
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

    return [
      "Seeded the MEDICE ADHS course.",
      `  customer  ${CUSTOMER_SLUG}`,
      `  project   ${PROJECT_SLUG}   (WordPress channel, Keycloak)`,
      `  project   ${PORTAL_PROJECT_SLUG}         (portal channel, local sign-in)`,
      `  course    ${COURSE_SLUG}`,
      `  modules   ${MODULES.length}, ${QUESTION_COUNT} quiz questions`,
      "",
      `Portal sign-in at /${PORTAL_PROJECT_SLUG}:`,
      `  E-Mail    ${PARTICIPANT_EMAIL}`,
      password.supplied
        ? "  Passwort  as supplied in SEED_PARTICIPANT_PASSWORD"
        : `  Passwort  ${password.plaintext}`,
      "",
      password.supplied
        ? ""
        : "That password is printed once and stored only as an Argon2id hash.\n" +
          "Re-run the seed to set a new one, or set SEED_PARTICIPANT_PASSWORD\n" +
          "to choose it. It is a demo account: delete it before MEDICE's own\n" +
          "physicians use this tenant in earnest.",
      "",
      "required_watch_percent is seeded at 100 — the stricter of the two",
      "readings (layout says 80, MEDICE-292 says 100). See",
      "docs/show-stoppers.md before treating it as settled.",
      "",
      "No VNR password is seeded. Set courses.vnr_password_enc via the admin",
      "path before the EIV worker can authenticate.",
      "",
      "Stamp and signature are 1x1 placeholder PNGs so a certificate renders",
      "locally. Replace them with the real assets of the course's",
      "Wissenschaftliche Leitung before anything ships.",
    ].join("\n");
  } catch (error) {
    await pool.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}
