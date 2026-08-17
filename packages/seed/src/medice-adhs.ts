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
 * **The VNR and the VNR password are placeholders.** Both are needed for the
 * course to be publishable at all, and neither authenticates anything: a
 * Punktemeldung carrying them is refused by EIV-FOBI, and cannot reach it
 * without `EIV_ALLOW_LIVE=yes` (ADR-0005). The real pair is set through the
 * console, and a re-run of this seed does not overwrite them.
 *
 * Idempotent, keyed on the slugs: re-running updates rather than duplicating.
 */

import { randomBytes } from "node:crypto";
import { createSecretCipher } from "@ds/secrets";
import type pg from "pg";
import {
  enterTenant,
  participantPassword,
  PLACEHOLDER_IMAGE,
  courseHasContent,
  resetCourseContent,
  resolveCustomerId,
  seedParticipant,
  seedPortalProject,
  upsert,
  hasNoEvaluation,
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

/**
 * The Veranstaltungsnummer, from the environment.
 *
 * It used to be the real one from the Bescheid, hardcoded. That was defensible
 * while a VNR was inert data — and it stopped being defensible with P28-03,
 * which made a completion queue a Punktemeldung against whatever VNR the course
 * carries. A seeded environment plus `EIV_ALLOW_LIVE=yes` is then a path to
 * submitting **test participations against MEDICE's real accreditation**, which
 * is not a mistake anyone gets to make twice: the Ärztekammer would be told that
 * physicians who do not exist attended.
 *
 * The placeholder is obviously synthetic, so a submission attempt with it fails
 * loudly at the Ärztekammer rather than succeeding quietly somewhere real. The
 * real number lives in `config.env` next to the password it goes with —
 * `docs/requirements/medice-adhs.md` records what it is, which is where a fact
 * about the accreditation belongs.
 */
const VNR = process.env["SEED_MEDICE_VNR"] ?? "0000000000000000000";

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
 * The five modules from the layout's Inhalte list.
 *
 * ## The durations are from the layout, and that is a hazard (P75-01)
 *
 * They are the figures the design shows beside each module. They describe **no
 * file this seed ships** — the video URLs below are placeholders on a domain
 * nobody owns (P72) — and the watch gate is a percentage of them.
 *
 * That is not a cosmetic inaccuracy. Reported from production on 14.08:
 *
 * > _"in the course i have a video which is 45 seconds and the system says you
 * > have to watch a video for 25 minutes, which there is not, and i can not go
 * > further in the course"_
 *
 * Somebody had attached a real 45-second recording to Modul 1 through the
 * console, and this seed's `1524` stayed behind — so the gate demanded 25:24 of
 * a video that holds 0:45, and the module became impossible to finish.
 *
 * The console no longer lets an author type a length: it reads it from the file
 * and writes what it read (P75-01), so **replacing the media now replaces the
 * duration with it**. What this comment is here to stop is the next person
 * adding a module with a plausible number beside media that does not exist.
 * Until P72 gives this seed real media, a duration here is a promise about a
 * file, made without one.
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

/**
 * How this seed behaves when the tenant already exists.
 *
 * `onlyIfMissing` is what makes it safe to run unattended (P65-01). Without it
 * the seed rebuilds the course's content tree unconditionally —
 * `resetCourseContent` deletes modules, chapters and contents, and with them
 * every learner's progress against that course. That is correct for an operator
 * deliberately reloading a fixture and catastrophic for a deploy that runs on
 * every push.
 *
 * With it, the seed reads one row and returns before its first write once the
 * customer exists. So the deploy that creates this tenant on an installation
 * that has never had it writes nothing at all on the next two hundred deploys.
 *
 * This is the fix for the failure that has now been reported three times:
 * `/medice` answering `{"kind":"unknown"}` on a host where the seed exists in
 * the repository and had simply never been run (CLAUDE.md §9.9's corollary).
 * A seed the deploy cannot safely run is a seed somebody has to remember, and
 * nobody did.
 *
 * `revealPassword` is off for the same unattended caller: its stdout is a
 * GitHub Actions log, and a demo participant's password in a build log is a
 * credential that outlives every rotation.
 */
export interface TenantSeedOptions {
  readonly onlyIfMissing?: boolean;
  readonly revealPassword?: boolean;
}

export async function seedMediceAdhs(
  pool: pg.Pool,
  options: TenantSeedOptions = {},
): Promise<string> {
  const onlyIfMissing = options.onlyIfMissing ?? false;
  const revealPassword = options.revealPassword ?? true;
  try {
    await pool.query("BEGIN");

    // Adopt an existing "medice" customer rather than colliding with its
    // slug — see `resolveCustomerId`. Everything below uses the resolved id.
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
      [tenantId, CUSTOMER_SLUG, "MEDICE Arzneimittel Pütter GmbH & Co. KG"],
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
      /*
       * Published, with a placeholder VNR password (P64-02).
       *
       * `courses_published_cme_is_complete` refuses a published, point-awarding
       * course whose `vnr_password_enc` is null. P63-02 answered that by
       * seeding a draft, which was truthful and made `/medice` an empty
       * catalogue — a tenant nobody can look at is not a seeded tenant.
       *
       * So the seed writes one. It authenticates nothing: it goes with the
       * placeholder VNR above, a Punktemeldung carrying it would be refused by
       * EIV-FOBI, and it cannot reach EIV-FOBI at all without
       * `EIV_ALLOW_LIVE=yes` (ADR-0005). The real credential is set through the
       * console's write-only field, and the DO UPDATE below will not overwrite
       * it on a re-run.
       *
       * `status` is absent from the DO UPDATE on purpose: a re-run must not
       * take a course an operator deliberately unpublished back onto the
       * catalogue.
       */
      `INSERT INTO courses (
         customer_id, project_id, slug, title, description, delivery_type, status,
         thema, altersgruppe, vnr, accreditation_body, cme_points, cme_category,
         event_location, organizer, valid_from, valid_to,
         required_watch_percent, pass_threshold_percent, max_quiz_attempts,
         reveal_correct_answers, learning_objectives, target_audience,
         scientific_lead_name, scientific_lead_title, certificate_issue_place,
         stamp_image, stamp_image_mime, signature_image, signature_image_mime,
         vnr_password_enc
       ) VALUES (
         $1,$2,$3,$4,$5,'on_demand','published',
         ARRAY['ADHS'], ARRAY['Erwachsene'], $6, $7, 4, 'D',
         'online', $8, $9, $10,
         100, 70, NULL,
         false, $11, $12,
         $13, $14, $15,
         $16, 'image/png', $16, 'image/png',
         $17
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
         -- Only when there is not one already: an operator who set the real
         -- credential through the console must not have it replaced by a re-run.
         vnr_password_enc = COALESCE(courses.vnr_password_enc, EXCLUDED.vnr_password_enc),
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
        // Placeholder, and overwritten by the console's write-only field the
        // moment a real one is set. See `seededVnrPassword`.
        seededVnrPassword(),
      ],
    );

    const rebuildContent = !onlyIfMissing || !(await courseHasContent(pool, courseId));
    if (rebuildContent) {
      await resetCourseContent(pool, courseId);
    }

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

    /*
     * The content tree — the one destructive part of this seed (P65-03).
     *
     * `resetCourseContent` above deletes modules, chapters and contents, and
     * with them `content_progress`, `quiz_attempts` and `quiz_answers`. That
     * is what an unattended deploy must never do, and it is the *only* thing
     * it must never do: every other statement in this function is an upsert
     * that converges the tenant's structure.
     *
     * The first version of `--if-missing` got this wrong in a way worth
     * remembering. It returned early when the *customer* row existed — and on
     * the installation it was written for, MEDICE the customer had existed for
     * months while the `medice` **portal project** never had. So the deploy
     * ran the seed, the guard said "already exists", and `/medice` went on
     * answering "Diesen Bereich gibt es nicht". A guard that skipped
     * everything because one row was present, including the row that was
     * absent.
     */
    if (rebuildContent) {
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
            // `body` is the Mediathek card's description (page-05). Seeded so the
            // grid renders at its real height rather than as a row of title-only
            // cards that look nothing like the layout.
            `INSERT INTO contents (customer_id, chapter_id, ordinal, kind, title, body, file_url, mime_type, file_size)
             VALUES ($1,$2,8,'material',$3,$4,$5,'application/pdf',524288)`,
            [
              customerId,
              chapterId,
              `Patienteninformation ${module.title} (PDF)`,
              "Begleitmaterial zum Modul, geeignet zur Weitergabe an Patientinnen " +
                "und Patienten. Platzhaltertext — der endgültige Inhalt wird von " +
                "MEDICE bereitgestellt.",
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
    }

    /*
     * The Evaluationsbogen — seeded **once**, never rewritten (P84-01).
     *
     * ## The deploy this broke
     *
     * It used to be `DELETE` then `INSERT`, which is the obvious way to make a
     * seed idempotent and stops being possible the moment the system is used.
     * `evaluation_responses.evaluation_id` is `ON DELETE RESTRICT`, so the first
     * physician to answer the form pins those rows for good — and every deploy
     * from then on died here:
     *
     *     update or delete on table "evaluations" violates foreign key
     *     constraint "evaluation_responses_evaluation_id_fkey"
     *
     * The deploy script is correct to abort rather than swap, so the effect was
     * that **no change could reach the server at all** while the fix for a
     * completely unrelated bug sat on main. That is the expensive shape: a
     * seeding step failing does not merely skip seeding, it stops the release.
     *
     * ## Why "only when there are none" and not an upsert
     *
     * An upsert keyed on ordinal would keep the deploy green and quietly
     * overwrite the customer's own wording on every release — the operator can
     * edit this form in the console, and re-imposing our text each time is a
     * worse bug than the one being fixed, because nothing would ever say so.
     *
     * A seed establishes a starting point. Once a course has an evaluation, the
     * people using it own it.
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
        : revealPassword
          ? `  Passwort  ${password.plaintext}`
          : "  Passwort  generiert — im Konsolenbereich Zugänge neu setzen",
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
      "ADHS Akademie adult is PUBLISHED and visible to participants now.",
      "",
      "The seeded VNR and VNR password are placeholders and authenticate",
      "nothing. Before any real Punktemeldung, set both under",
      "Verwaltung -> Fortbildungen -> ADHS Akademie adult: the VNR from the",
      "Anerkennungsbescheid, and the VNR-Passwort from EIV-FOBI. A re-run of",
      "this seed will not overwrite a password you set there.",
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

/**
 * The placeholder VNR password, so the course can be published (P64-02).
 *
 * ## Why a seed sets one
 *
 * `courses_published_cme_is_complete` refuses a published, point-awarding
 * course whose `vnr_password_enc` is null. Leaving it null left the course a
 * draft and `/medice` an empty catalogue — and a tenant nobody can look at is
 * not a seeded tenant.
 *
 * ## Why it is safe
 *
 * It authenticates nothing, and it goes with a VNR that authenticates nothing.
 * The guard that matters is `EIV_ALLOW_LIVE`, not the absence of this value.
 *
 * ## Why random rather than a constant
 *
 * A constant here is a credential in the repository, and "it is only a
 * placeholder" is how a real one eventually gets committed beside it. Nothing
 * needs to read this: the VNR password is used server-side only and is never
 * returned by any API.
 */

function seededVnrPassword(): Buffer {
  const cipher = createSecretCipher(
    process.env["NODE_ENV"] ?? "development",
    process.env["SECRETS_KMS_KEY"] ?? "",
  );
  return cipher.encrypt(randomBytes(24).toString("base64url"));
}
