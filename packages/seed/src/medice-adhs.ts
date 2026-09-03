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
 * **The VNR is real; the VNR password is a placeholder.** Since P109-01 the
 * seeded VNR is MEDICE's own from the Anerkennungsbescheid — it is not a
 * secret, being printed and twice barcoded on every Teilnahmebescheinigung
 * (S13) — while the password, which is the half that authenticates, is a
 * placeholder until an operator sets the real one through the console's
 * write-only field. A Punktemeldung carrying the placeholder password is
 * refused by EIV-FOBI, and cannot reach it at all without `EIV_ALLOW_LIVE=yes`
 * (ADR-0005). A re-run overwrites neither once they are set.
 *
 * Idempotent, keyed on the slugs: re-running updates rather than duplicating.
 */

import { randomBytes } from "node:crypto";
import { PLACEHOLDER_VNR as DOMAIN_PLACEHOLDER_VNR } from "@ds/domain";
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
import { bindingProblem, seedKeycloakBinding } from "./keycloak-binding.js";

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
 * The Veranstaltungsnummer, which this seed no longer supplies (P165-01).
 *
 * ## The history, because it is not a fabricated number
 *
 * P28-03 replaced the real one with a synthetic placeholder for a sound reason:
 * a completion queues a Punktemeldung against whatever VNR the course carries,
 * so a seeded environment plus `EIV_ALLOW_LIVE=yes` was a path to filing test
 * participations against MEDICE's real accreditation. That left every
 * installation inert with somebody needing to know to fix it, which nobody did
 * — §9.9's corollary — so P109-01 put a real number back as the default, on the
 * client's own instruction at the time: *"the vnr i have already given you, you
 * can set that for now."*
 *
 * `2760552025919300018` was therefore **theirs**, not invented here. It has
 * since gone stale: the course's number is now `2760012024200354002`, and the
 * old one reached a Teilnahmebescheinigung on the running system for the
 * separate reason P164-01 fixed — the certificate was reading the enrolment's
 * snapshot rather than the course.
 *
 * ## Why there is no default now
 *
 * Asked where a seeded VNR may live at all, the client drew the line:
 *
 * > _"seed can do it, but seed should be only on ds tenant, not medice."_
 *
 * That is the right line and this file was on the wrong side of it. `ds-demo`
 * seeds `9999999999999999999` and says in its own comment that it is
 * deliberately not a valid registration; `ds-default` seeds no points and no VNR
 * at all. Both are ours to make up. MEDICE's is a number an Ärztekammer issued
 * to MEDICE, it changes when they are re-accredited, and a constant in this
 * repository can only ever be right by accident and stale by default — which is
 * exactly what happened.
 *
 * So the seed writes nothing and the course it creates is a **draft**. A
 * point-awarding course with no VNR cannot be published — migration 0042's
 * `courses_published_cme_is_complete` — and that refusal is the correct outcome
 * rather than an obstacle: nobody should be able to enrol in an accredited
 * course whose accreditation number the platform made up. An operator enters
 * the number from the Anerkennungsbescheid in Verwaltung and publishes, which is
 * P108-01's rule — the seed creates, the console owns.
 *
 * `SEED_MEDICE_VNR` still overrides, and when it is set the course is published
 * exactly as before. That is what a rehearsal against a real accreditation uses.
 *
 * The two guards against an accidental live filing are unchanged and still the
 * things that actually stop one: `EIV_ALLOW_LIVE` (ADR-0005) and the VNR
 * password, which is not in this file or any other.
 */
function seededVnr(): string | null {
  /*
   * Read per call, not at module load.
   *
   * `const VNR = process.env[…] ?? null` at the top level binds whatever the
   * environment held when this module was first imported, which makes the
   * value depend on import order — and made the supplied-number test
   * unreachable, because a test that sets the variable has already imported the
   * seed. The same shape as P151-02's import-time `resolveMigrationsDir()`.
   */
  const supplied = process.env["SEED_MEDICE_VNR"]?.trim();
  return supplied === undefined || supplied === "" ? null : supplied;
}

/**
 * What P28-03 used to seed.
 *
 * Kept, and named, because the ON CONFLICT below has to tell **its own
 * placeholder** apart from a number an operator typed. Installations seeded
 * before P109-01 are carrying this, and they are the ones that need correcting;
 * a course whose VNR somebody set in the console is not.
 */
/*
 * Re-exported from `@ds/domain` rather than declared here (P117-01).
 *
 * The domain has to know this string in order to refuse it — a course carrying
 * it must not publish and must not produce a Teilnahmebescheinigung. Two copies
 * of the literal would be two things to keep in step, and the day they drifted
 * the seed would write a placeholder the gates no longer recognised.
 */
const PLACEHOLDER_VNR = DOMAIN_PLACEHOLDER_VNR;

interface ModuleSeed {
  readonly title: string;
  readonly subtitle: string;
  readonly chapters: ReadonlyArray<{
    readonly title: string;
    readonly videoTitle: string;
    readonly durationSec: number;
    /** The chapter's Beschreibungstext, from MEDICE's content sheet. */
    readonly body: string;
  }>;
  /**
   * The module's Lernerfolgskontrolle, as its own chapter.
   *
   * MEDICE's sheet lists it as **Kapitel 3.3**, a sibling of the two video
   * chapters rather than a second content inside 3.2. That is the structure
   * seeded here, and it is also what the gate wants: `contentGates` opens a
   * module's exam once that module's *videos* are finished, so an exam sharing
   * a chapter with the video it examines is the P87-02 shape that read as
   * unlocked from enrolment.
   */
  readonly examChapterTitle?: string;
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
    name: "Dr. med. Andrea Boreatti",
    institution: "Fachärztin für Psychiatrie und Psychotherapie, Lohr am Main",
    biography:
      "Wissenschaftliche Leitung der Fortbildung. Die Kurzvita wird von MEDICE " +
      "bereitgestellt und ist vor Veröffentlichung zu ergänzen.",
  },
  {
    roleLabel: "Referent",
    name: "Dr. med. Frank Matthias Rudolph",
    institution:
      "Facharzt für Psychosomatische Medizin und Psychotherapie, " +
      "Rehabilitationswesen und Diabetologie, Boppard",
    biography:
      "Referent der Fortbildung. Die Kurzvita wird von MEDICE bereitgestellt " +
      "und ist vor Veröffentlichung zu ergänzen.",
  },
];

/**
 * The course as MEDICE specified it (`MEDICE_Fortbildung_content.xlsx`, 31.08).
 *
 * Three modules, two chapters each, one video per chapter, and the
 * Lernerfolgskontrolle as **Kapitel 3.3** — a chapter of its own at the end of
 * Modul 3, which is both what the sheet lists and what the module gate wants.
 *
 * ## Two departures from the sheet, both deliberate
 *
 * **The course title is not changed.** The sheet heads the Fortbildung
 * *"Basisseminar 2026 – ADHS Akademie adult"*; the Anerkennungsbescheid and the
 * `courses.title` below say *"ADHS Akademie adult"*, and that string is printed
 * on the Teilnahmebescheinigung. A title that differs from the one the ÄKWL
 * accredited is a certificate that does not match its Bescheid, so the sheet's
 * longer heading is treated as a working label rather than as the course name.
 * Raised for MEDICE to confirm.
 *
 * **`Diagonstik` is spelled `Diagnostik`.** The sheet's module-2 heading carries
 * a typo its own chapter titles do not. §5 makes the layout's copy
 * authoritative, and a misspelling is not copy.
 *
 * ## The durations are still placeholders, and still a promise (P75-01)
 *
 * The sheet names six videos and ships none — its own Kommentar column is MEDICE
 * asking whether they or MiM will produce them. So these numbers describe no
 * file, exactly as the previous set did, and the P75-01 report is what that
 * costs:
 *
 * > _"in the course i have a video which is 45 seconds and the system says you
 * > have to watch a video for 25 minutes, which there is not, and i can not go
 * > further in the course"_
 *
 * They are kept short and uniform rather than plausible-looking, so nobody reads
 * them as a specification. The console reads a duration from the file it is
 * given and writes what it read, so **attaching real media replaces these**.
 * Until it does, the watch gate on this course is a gate over nothing.
 */
export const MODULES: readonly ModuleSeed[] = [
  {
    title: "Modul 1 – Grundlagen",
    subtitle: "Störungsbild · Symptomatik · Neurobiologie",
    chapters: [
      {
        title: "Kapitel 1.1 – Grundlagen I",
        videoTitle: "Grundlagen Teil 1",
        durationSec: 600,
        body:
          "ADHS ist weit mehr als Unaufmerksamkeit und Hyperaktivität. Erhalten " +
          "Sie einen fundierten Überblick über das Störungsbild im " +
          "Erwachsenenalter, lernen Sie typische Symptome kennen und erfahren " +
          "Sie, wie sich die Erkrankung in unterschiedlichen Lebensbereichen " +
          "manifestieren kann. Die ideale Grundlage für ein besseres Verständnis " +
          "Ihrer Patient:innen",
      },
      {
        title: "Kapitel 1.2 – Grundlagen II",
        videoTitle: "Grundlagen Teil 2",
        durationSec: 600,
        body:
          "Welche biologischen und genetischen Faktoren liegen einer ADHS " +
          "zugrunde? Dieses Kapitel beleuchtet die aktuellen Erkenntnisse zur " +
          "Entstehung und neurobiologischen Grundlage der Erkrankung und schafft " +
          "ein tieferes Verständnis für die Zusammenhänge zwischen Symptomatik " +
          "und Pathophysiologie.",
      },
    ],
  },
  {
    title: "Modul 2 – Diagnostik",
    subtitle: "Diagnostische Schritte · Differentialdiagnosen",
    chapters: [
      {
        title: "Kapitel 2.1 – Diagnostik I",
        videoTitle: "Diagnostik Teil 1",
        durationSec: 600,
        body:
          "Die Diagnose einer ADHS im Erwachsenenalter erfordert eine " +
          "strukturierte und differenzierte Herangehensweise. Lernen Sie die " +
          "wesentlichen diagnostischen Schritte kennen und erfahren Sie, welche " +
          "Anhaltspunkte in Anamnese, Exploration und klinischem Gespräch " +
          "besonders relevant sind.",
      },
      {
        title: "Kapitel 2.2 – Diagnostik II",
        videoTitle: "Diagnostik Teil 2",
        durationSec: 600,
        body:
          "Viele Symptome der ADHS können auch bei anderen psychischen oder " +
          "somatischen Erkrankungen auftreten. Dieses Kapitel unterstützt Sie " +
          "dabei, wichtige Differentialdiagnosen sicher einzuordnen und typische " +
          "diagnostische Fallstricke im Praxisalltag zu vermeiden.",
      },
    ],
  },
  {
    title: "Modul 3 – Therapie",
    subtitle: "Leitlinien · Pharmakotherapie",
    examChapterTitle: "Kapitel 3.3 – Lernerfolgskontrolle",
    chapters: [
      {
        title: "Kapitel 3.1 – Therapie I",
        videoTitle: "Therapie Teil 1",
        durationSec: 600,
        body:
          "Welche Therapieempfehlungen geben die aktuellen Leitlinien für " +
          "Erwachsene mit ADHS? Erhalten Sie einen praxisnahen Überblick über " +
          "evidenzbasierte Behandlungsstrategien und erfahren Sie, wie eine " +
          "moderne und leitliniengerechte Versorgung gestaltet werden kann",
      },
      {
        title: "Kapitel 3.2 – Therapie II",
        videoTitle: "Therapie Teil 2",
        durationSec: 600,
        body:
          "Die medikamentöse Behandlung spielt für viele erwachsene " +
          "Patient:innen eine wichtige Rolle. Lernen Sie die verfügbaren " +
          "Therapieoptionen kennen und erhalten Sie wertvolle Einblicke in " +
          "Wirkmechanismen, Auswahlkriterien und den praktischen Einsatz der " +
          "Pharmakotherapie im klinischen Alltag.",
      },
    ],
  },
];

/**
 * The Lernerfolgskontrolle, verbatim from MEDICE (`Lernerfolgskontrolle.docx`).
 *
 * ## Where the answer key comes from, and why that is worth stating
 *
 * The document marks the correct option of each question in **bold** and says
 * nothing else about which is which. Eleven questions, eleven bold options, one
 * per question — so the reading is unambiguous, and it is still an inference
 * from formatting rather than a stated key.
 *
 * That matters because this decides whether a physician passes a CME exam, which
 * §7 puts in the class of thing not to guess at. The key is therefore written
 * out here in full rather than derived at runtime, so it can be read back and
 * confirmed against the source by a person, and `answerKey.test.ts` asserts the
 * shape it has to have: exactly one correct option per question, eleven
 * questions, five options each.
 *
 * ## The threshold arithmetic
 *
 * 70 % of 11 is 7.7, so **8 of 11** passes and 7 fails — `scoreQuiz` floors the
 * percentage (8/11 → 72 %, 7/11 → 63 %) and compares against the threshold.
 * `assessment.test.ts` has asserted exactly this since the MEDICE configuration
 * was first written down; it agrees with the client's own statement of it.
 */
export interface QuestionSeed {
  readonly prompt: string;
  readonly options: readonly string[];
  /** Zero-based index into `options`. Bold in the source document. */
  readonly correct: number;
}

export const QUESTIONS: readonly QuestionSeed[] = [
  {
    prompt:
      "Welche Aussage beschreibt ein wichtiges Kriterium nach DSM-5 für die " +
      "ADHS-Diagnose bei Erwachsenen?",
    options: [
      "Symptome müssen mindestens ein Jahr bestehen",
      "Symptome müssen sich in mehreren Lebensbereichen zeigen",
      "Symptome müssen ausschließlich arbeitsbedingt sein",
      "Symptome dürfen erst ab 21 Jahren beginnen",
      "Symptome bessern sich durch Alkoholverzicht",
    ],
    correct: 1,
  },
  {
    prompt:
      "Welches diagnostische Verfahren ist bei der ADHS-Überprüfung bei " +
      "Erwachsenen nicht üblich?",
    options: [
      "Strukturierte Selbstbeurteilungsfragebögen",
      "Fremdanamnese von Partnern oder Angehörigen",
      "Spezifische neuropsychologische Tests",
      "Standardisierte Blutuntersuchung",
      "Exploration der Kindheitssymptomatik",
    ],
    correct: 3,
  },
  {
    prompt:
      "Welche Therapieform wird neben der medikamentösen Therapie bei " +
      "Erwachsenen mit ADHS häufig empfohlen?",
    options: [
      "Musiktherapie",
      "Kognitive Verhaltenstherapie",
      "Psychoanalyse",
      "Hypnose",
      "Aromatherapie",
    ],
    correct: 1,
  },
  {
    prompt:
      "Was gehört laut Leitlinie zu einem multimodalen Behandlungskonzept bei " +
      "ADHS im Erwachsenenalter?",
    options: [
      "Nur medikamentöse Therapie",
      "Kombination aus Psychoedukation, Verhaltenstherapie und ggf. Medikation",
      "Diätetische Maßnahmen als Monotherapie",
      "Psychoanalytische Langzeittherapie",
      "Alleinige Gruppentherapie",
    ],
    correct: 1,
  },
  {
    prompt: "Was ist ein primäres Ziel der ADHS-Therapie bei Erwachsenen?",
    options: [
      "Komplette Heilung der Erkrankung",
      "Verbesserung der Lebensqualität und Alltagsfunktionen",
      "Vermeidung aller Medikamente",
      "Isolierung der Betroffenen",
      "Maximierung der beruflichen Leistung",
    ],
    correct: 1,
  },
  {
    prompt:
      "Welcher Wirkstoff ist neben Methylphenidat als Second-Line-Therapie für " +
      "Erwachsene mit ADHS zugelassen?",
    options: ["Atomoxetin", "Haloperidol", "Lisdexamfetamin", "Lorazepam", "Imipramin"],
    correct: 0,
  },
  {
    prompt:
      "Welche Aussage trifft zu Atomoxetin bei der Behandlung der ADHS im " +
      "Erwachsenenalter?",
    options: [
      "Atomoxetin ist ein Stimulans mit sofortiger Wirkung",
      "Atomoxetin ist ein selektiver Noradrenalin-Wiederaufnahmehemmer und " +
        "benötigt mehrere Wochen zur vollen Wirksamkeit",
      "Atomoxetin wird nur einmal im Monat eingenommen",
      "Atomoxetin verursacht keine Nebenwirkungen",
      "Atomoxetin ist ausschließlich für Kinder zugelassen",
    ],
    correct: 1,
  },
  {
    prompt:
      "Welche häufige Nebenwirkung tritt bei medikamentöser ADHS-Therapie mit " +
      "Stimulanzien wie Methylphenidat auch bei Erwachsenen auf?",
    options: [
      "Appetitminderung",
      "Gewichtszunahme",
      "Kopfschmerzen",
      "Schlaflosigkeit",
      "Blutbildveränderungen",
    ],
    correct: 0,
  },
  {
    prompt:
      "Was sollte vor Beginn einer medikamentösen Therapie bei Erwachsenen mit " +
      "ADHS überprüft werden?",
    options: [
      "Vorliegen weiterer psychischer Komorbiditäten",
      "Hormonstatus",
      "Leberfunktionstest als Pflichtuntersuchung",
      "Blutdruckmessung nur einmal jährlich",
      "Haaranalyse",
    ],
    correct: 0,
  },
  {
    prompt: "Wie äußert sich Hyperaktivität bei Erwachsenen mit ADHS häufig?",
    options: [
      "Exzessives Bedürfnis nach Bewegung",
      "Innere Unruhe und Getriebenheit",
      "Häufige Aggressionen",
      "Zwanghaftes Ordnungsempfinden",
      "Motorische Lähmungserscheinungen",
    ],
    correct: 1,
  },
  {
    prompt: "Was ist für die Diagnose ADHS bei Erwachsenen unabdingbar?",
    options: [
      "Symptomfreiheit im Jugendalter",
      "Auftreten der Symptome vor dem 12. Lebensjahr",
      "Vorliegen von Tics",
      "Psychotische Episoden",
      "Auftreten von Symptomen erst nach dem 25. Lebensjahr",
    ],
    correct: 1,
  },
];

const QUESTION_COUNT = QUESTIONS.length;

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
  /**
   * Create the demo participant? **Off by default since P111-01.**
   *
   * It used to be unconditional, so every installation — including MEDICE's
   * production tenant — carried `demo@medice.example` with a password printed
   * in a deploy log. The client's call on 24.08: *"delete the demo participant
   * now … testing against a live tenant with a known password is the thing
   * you'd be unable to explain afterwards."*
   *
   * The dev and demo seeds pass `true` explicitly, which is the whole point:
   * an account that exists to be signed into should be created by something
   * that says so, not inherited by a customer tenant that never asked.
   */
  readonly withDemoParticipant?: boolean;
}

export async function seedMediceAdhs(
  pool: pg.Pool,
  options: TenantSeedOptions = {},
): Promise<string> {
  const onlyIfMissing = options.onlyIfMissing ?? false;
  const revealPassword = options.revealPassword ?? true;
  const withDemoParticipant = options.withDemoParticipant ?? false;
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

    /*
     * The Keycloak binding: stated or absent, never invented (P101-03).
     *
     * Both halves matter and only together. `seedKeycloakBinding` removes the
     * `?? "http://127.0.0.1:8080/realms/ds-dev"` that bound MEDICE's project to
     * a Keycloak on the API container's own loopback on every installation this
     * platform has ever had — and the `COALESCE`s below stop a re-run reverting
     * an operator who fixed it in the console, which is what turned one wrong
     * value into a fault that came back after every deploy.
     *
     * Same shape as `vnr_password_enc` two statements down, and for the same
     * reason: a seed converges structure, and a credential somebody typed is
     * not structure.
     */
    const binding = seedKeycloakBinding({
      issuer: process.env["KEYCLOAK_ISSUER"],
      audience: process.env["KEYCLOAK_AUDIENCE"],
      realm: process.env["KEYCLOAK_REALM"],
    });

    const projectId = await upsert(
      pool,
      `INSERT INTO projects (customer_id, department_id, slug, name, keycloak_issuer, keycloak_audience, keycloak_realm)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (department_id, slug) DO UPDATE
         SET name = EXCLUDED.name,
             keycloak_issuer = COALESCE(projects.keycloak_issuer, EXCLUDED.keycloak_issuer),
             keycloak_audience = COALESCE(projects.keycloak_audience, EXCLUDED.keycloak_audience),
             keycloak_realm = COALESCE(projects.keycloak_realm, EXCLUDED.keycloak_realm),
             updated_at = now()
       RETURNING id`,
      [
        customerId,
        departmentId,
        PROJECT_SLUG,
        "ADHS Akademie",
        binding.issuer,
        binding.audience,
        binding.realm,
      ],
    );

    /*
     * And then read back what the row actually holds (§9.1).
     *
     * Not `binding` — that is what this process would have written, and the
     * `COALESCE`s above mean it frequently is not what is stored. The question
     * a deploy has to answer is "can this project authenticate a physician",
     * and only the row can answer it.
     *
     * This throws. A federated project with no issuer, or with the loopback
     * default a previous seed wrote, is a project on which every learner gets a
     * 401 — so the installation is already broken and a green deploy is the
     * lie. §9.9's strongest form: if a deploy cannot apply a setting, it checks
     * it and fails.
     */
    const stored = await storedBinding(pool, projectId);
    const problem = bindingProblem({
      projectSlug: PROJECT_SLUG,
      stored,
      issuerRequested: binding.issuer !== null,
    });
    if (problem !== undefined) throw new Error(problem);

    // The second channel: the standalone portal at /medice, whose participants
    // hold a password here rather than a MEDICE Keycloak account. Same
    // customer, same department, same courses — a different way in.
    await seedPortalProject(pool, {
      customerId,
      departmentId,
      slug: PORTAL_PROJECT_SLUG,
      name: "ADHS Akademie (Portal)",
    });

    /*
     * The demo participant, only when somebody asked for one (P111-01).
     *
     * A live tenant serving real physicians must not carry an account with a
     * password that was printed in a build log. Deleting it after the fact is
     * the remedy for installations that already have one; not creating it is
     * the fix.
     */
    const password = withDemoParticipant ? await participantPassword() : undefined;
    if (password !== undefined) {
      await seedParticipant(pool, {
        customerId,
        email: PARTICIPANT_EMAIL,
        firstName: "Demo",
        lastName: "Teilnehmende",
        passwordHash: password.hash,
      });
    }

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
       * `status` is in the DO UPDATE only as a repair guarded by the seed's own
       * placeholder VNR (P117-01). A re-run must not otherwise take a course an
       * operator deliberately unpublished back onto the catalogue.
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
         -- Draft unless SEED_MEDICE_VNR supplied one (P165-01).
         -- courses_published_cme_is_complete refuses a published,
         -- point-awarding course with no VNR, and that refusal is the point.
         $1,$2,$3,$4,$5,'on_demand',
         CASE WHEN $6::text IS NULL THEN 'draft' ELSE 'published' END::course_status,
         ARRAY['ADHS'], ARRAY['Erwachsene'], $6, $7, 4, 'D',
         'online', $8, $9, $10,
         100, 70, NULL,
         false, $11, $12,
         $13, $14, $15,
         $16, 'image/png', $16, 'image/png',
         $17
       )
       /*
        * ON CONFLICT: **the seed creates, the console owns** (P108-01).
        *
        * The deploy runs this seed on every push, so anything named here is
        * reset on every deploy — silently, on a green deploy, minutes after an
        * operator saved it. The client asked for required_watch_percent to
        * be configurable in the admin panel. It already was, and had been for
        * phases: the field is on the Fortbildung's settings screen, it saves,
        * and the next deploy put 100 back. A setting that does not survive is
        * not a setting, and nothing anywhere said so.
        *
        * Two fields had already been rescued one at a time — status, because
        * a re-run must not republish a course somebody unpublished (P117-01
        * added the one exception, narrowly: a course still carrying the seed's
        * own placeholder VNR, which migration 0047 demoted and only this seed
        * can repair — see the line itself), and
        * vnr_password_enc, because a re-run must not replace a real
        * credential. Both are the same defect, found twice, fixed twice,
        * without the class being named. It is named now (§9.11).
        *
        * The line: a field is updated here only when the **Anerkennungsbescheid
        * is authoritative over it** and an install with stale text is wrong.
        * That is the course's identity — its title, its points, its category.
        * Everything an operator can edit in Verwaltung is theirs after the
        * first insert.
        *
        * The one that would have been worst is stamp_image: the seed writes a
        * 1x1 placeholder PNG, and the deploy's own output tells the operator to
        * replace it with the real Stempel before anything ships. Had they, the
        * next deploy would have put the 1x1 back — and a Teilnahmebescheinigung
        * without a stamp is not a valid document (S11). Nothing would have
        * failed; the PDF would simply have come out wrong.
        */
       ON CONFLICT (project_id, slug) DO UPDATE SET
         /*
          * The course's identity is the **operator's**, not the seed's
          * (P171-02).
          *
          * These three were unconditional: every run of the seed — which is
          * every deploy — wrote the title, the points and the category back to
          * what is compiled in here. An operator who set the MEDICE course to
          * 10 CME-Punkte through the console got 4 back on the next deploy,
          * with nothing in any log to say so, because an UPDATE that changes a
          * value to a different valid value is not an error anywhere.
          *
          * The comment immediately below has always read *"the seed supplies a
          * starting value … never a replacement for what an operator put in
          * through the console"*, and it sat directly under three lines doing
          * exactly that (CLAUDE.md §11.9 — a comment is a claim, and this one
          * was false about the lines above it).
          *
          * COALESCE, so the rule is the one the comment already stated: a
          * starting value where there is nothing, and never a replacement.
          * P165-01 did this for the VNR and stopped there; this is the rest of
          * the same fix.
          */
         -- title is NOT NULL, so there is no empty state to fall back from:
         -- an existing row simply keeps the title it has.
         title = courses.title,
         cme_points = COALESCE(courses.cme_points, EXCLUDED.cme_points),
         cme_category = COALESCE(courses.cme_category, EXCLUDED.cme_category),
         -- Only when there is nothing there: the seed supplies a starting value
         -- and a placeholder asset, never a replacement for what an operator
         -- put in through the console.
         -- The seed replaces its **own** placeholder and nothing else
         -- (P109-01). COALESCE cannot express this: vnr is NOT NULL, so there
         -- is no empty state to fall back from and the sentinel has to be the
         -- old placeholder itself. An installation seeded before P109-01 gets
         -- the real number on the next deploy; a course whose VNR an operator
         -- typed in the console keeps it, which is P108-01's rule holding.
         -- Never our own value over theirs, and since P165-01 there is
         -- usually no value of ours at all: EXCLUDED.vnr is NULL unless
         -- SEED_MEDICE_VNR was set, and COALESCE then leaves the row alone.
         -- The sentinel branch stays for the installations P109-01 and P117-01
         -- were written for — a row still carrying the zero placeholder, which
         -- migration 0047 demoted and only a seed run with SEED_MEDICE_VNR can
         -- now repair.
         vnr = CASE
                 WHEN EXCLUDED.vnr IS NULL THEN courses.vnr
                 WHEN courses.vnr = $18 THEN EXCLUDED.vnr
                 ELSE courses.vnr
               END,
         /*
          * The other half of that repair (P117-01).
          *
          * Migration 0047 demotes any published course carrying the
          * placeholder, because a course awarding CME points against a VNR no
          * Ärztekammer issued must not be on a catalogue. The migration cannot
          * repair it — the real number is per-installation and lives here, in
          * SEED_MEDICE_VNR or the Bescheid default -- so without this line the
          * deploy that fixes the VNR leaves MEDICE's course a draft, off the
          * catalogue, with nothing saying why.
          *
          * Conditioned on the **same sentinel** as the line above, so it is the
          * repair completing itself and not a general re-publish: this branch
          * can only be taken by a row still carrying our own placeholder, which
          * on any installation is true exactly once. A course an operator
          * unpublished has a VNR they typed, so courses.vnr <> $18 and the
          * ELSE keeps their decision — P108-01's rule, still holding.
          *
          * courses.status on both sides of the CASE reads the pre-UPDATE row,
          * so this and the vnr line above see the same sentinel.
          */
         status = CASE
                     WHEN EXCLUDED.vnr IS NOT NULL AND courses.vnr = $18
                       THEN 'published'
                     ELSE courses.status
                   END,
         vnr_password_enc = COALESCE(courses.vnr_password_enc, EXCLUDED.vnr_password_enc),
         stamp_image = COALESCE(courses.stamp_image, EXCLUDED.stamp_image),
         stamp_image_mime = COALESCE(courses.stamp_image_mime, EXCLUDED.stamp_image_mime),
         signature_image = COALESCE(courses.signature_image, EXCLUDED.signature_image),
         signature_image_mime =
           COALESCE(courses.signature_image_mime, EXCLUDED.signature_image_mime),
         scientific_lead_name =
           COALESCE(courses.scientific_lead_name, EXCLUDED.scientific_lead_name),
         scientific_lead_title =
           COALESCE(courses.scientific_lead_title, EXCLUDED.scientific_lead_title),
         certificate_issue_place =
           COALESCE(courses.certificate_issue_place, EXCLUDED.certificate_issue_place),
         updated_at = now()
       RETURNING id`,
      [
        customerId,
        projectId,
        COURSE_SLUG,
        // Exactly as accredited. Not "ADHS bei Erwachsenen".
        "ADHS Akademie adult",
        // The Detailseite text from MEDICE's content sheet (31.08). The sheet's
        // separate Startseite paragraph is the *catalogue* intro, which belongs
        // to the project rather than the course and is set in the console.
        "ADHS im Erwachsenenalter: Wissen, das in der Praxis ankommt\n\n" +
          "Wie gelingt eine sichere Diagnostik? Welche Differentialdiagnosen " +
          "gilt es zu berücksichtigen? Und welche Therapieoptionen stehen heute " +
          "zur Verfügung? In der Fortbildung on Demand – ADHS Akademie adult " +
          "erhalten Sie kompaktes, praxisnahes Expertenwissen rund um die adulte " +
          "ADHS. Lernen Sie die wichtigsten Grundlagen, diagnostischen Verfahren " +
          "und aktuellen Therapieansätze kennen und profitieren Sie von " +
          "wertvollen Erfahrungen aus dem klinischen Alltag. Flexibel, jederzeit " +
          "abrufbar und direkt für Ihre tägliche Arbeit nutzbar.",
        seededVnr(),
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
        // $18 — the sentinel the ON CONFLICT compares against, never inserted.
        PLACEHOLDER_VNR,
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
            `INSERT INTO chapters (customer_id, module_id, ordinal, title, body)
             VALUES ($1,$2,$3,$4,$5) RETURNING id`,
            [customerId, moduleId, chapterOrdinal, chapter.title, chapter.body],
          );

          // Two renditions and a poster, so the seeded course exercises the
          // player's format negotiation rather than the single-source path only.
          // HLS is listed first: the browser takes the first `type` it can play,
          // so Safari gets the adaptive stream and everything else falls through
          // to the MP4 (`orderSources` in @ds/domain).
          // Per **chapter**, not per module: there are two videos in each module
          // now, and a shared base would have given both the same file.
          const mediaBase =
            `https://media.example.org/${COURSE_SLUG}/` +
            `${moduleOrdinal + 1}-${chapterOrdinal + 1}`;
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
        }

        /*
         * The Lernerfolgskontrolle as a chapter of its own (MEDICE's Kapitel
         * 3.3), after the module's video chapters rather than inside one.
         *
         * Its ordinal continues the module's chapter numbering, so the outline
         * draws it last. `contentGates` opens it once *this module's* videos are
         * finished — which is why it must not share a chapter with the video it
         * examines: that was P87-02, where a quiz inherited its chapter's gate
         * and read as unlocked from enrolment.
         */
        if (module.examChapterTitle !== undefined) {
          const examChapterId = await upsert(
            pool,
            `INSERT INTO chapters (customer_id, module_id, ordinal, title)
             VALUES ($1,$2,$3,$4) RETURNING id`,
            [customerId, moduleId, module.chapters.length, module.examChapterTitle],
          );

          quizContentId = await upsert(
            pool,
            `INSERT INTO contents (customer_id, chapter_id, ordinal, kind, title)
             VALUES ($1,$2,0,'quiz',$3) RETURNING id`,
            [customerId, examChapterId, "Lernerfolgskontrolle"],
          );
        }
      }

      if (quizContentId !== undefined) {
        for (const [ordinal, question] of QUESTIONS.entries()) {
          const questionId = await upsert(
            pool,
            `INSERT INTO quiz_questions (customer_id, content_id, ordinal, kind, prompt)
             VALUES ($1,$2,$3,'single',$4) RETURNING id`,
            [customerId, quizContentId, ordinal, question.prompt],
          );

          for (const [optionOrdinal, label] of question.options.entries()) {
            await pool.query(
              `INSERT INTO quiz_options (customer_id, question_id, ordinal, label, is_correct)
               VALUES ($1,$2,$3,$4,$5)`,
              [
                customerId,
                questionId,
                optionOrdinal,
                label,
                optionOrdinal === question.correct,
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
      /*
       * The demo account's block, only when one was created (P111-01). A
       * standing "Portal sign-in" section naming an account that does not
       * exist is worse than none: somebody would go looking for it.
       */
      ...(password === undefined
        ? [
            `No demo participant was created. Pass withDemoParticipant to make`,
            `one — a tenant serving real physicians should not carry an account`,
            `whose password was printed in a build log.`,
            "",
          ]
        : [
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
          ]),
      "required_watch_percent is seeded at 100 and is then yours: set it per",
      "course under Verwaltung -> Fortbildungen. A re-run of this seed will",
      "not overwrite it, nor the Stempel, the Unterschrift, the",
      "Wissenschaftliche Leitung or the VNR password (P108-01).",
      "",
      "100 follows MEDICE-292, which is the compliance record. The layout",
      "says 80 and was overridden deliberately (S7, decided 24.08).",
      "",
      /*
       * What the operator has to do next, and it is the deploy's own output
       * that has to say it (P165-01, §9.9's corollary).
       *
       * This block used to read "ADHS Akademie adult is PUBLISHED and visible
       * to participants now" and name the VNR the seed had written. Both are
       * now false by default: the seed does not know MEDICE's Veranstaltungs-
       * nummer and no longer invents one, so the course is a draft until
       * somebody enters it. An operator who is not told that has a tenant whose
       * catalogue is empty and no idea why — which is exactly the report P64-02
       * was written to prevent, in the other direction.
       */
      ...(seededVnr() === null
        ? [
            "ADHS Akademie adult is a DRAFT and is NOT visible to participants.",
            "",
            "It has no VNR. The seed does not set one: the Veranstaltungsnummer",
            "is issued to MEDICE by the Aerztekammer and is not this",
            "repository's to invent (P165-01). A course awarding CME points",
            "cannot be published without it.",
            "",
            "To finish: Verwaltung -> Fortbildungen -> ADHS Akademie adult,",
            "enter the VNR from the Anerkennungsbescheid, then publish. A",
            "re-run of this seed will not overwrite what you set.",
          ]
        : [
            "ADHS Akademie adult is PUBLISHED and visible to participants now.",
            "",
            `The VNR is ${seededVnr() ?? ""}, from SEED_MEDICE_VNR. Change it`,
            "per course under Verwaltung -> Fortbildungen; a re-run will not",
            "overwrite one you set there.",
          ]),
      "",
      "The VNR PASSWORD is still a placeholder and authenticates nothing. Set",
      "the real one from EIV-FOBI on the same screen — it is write-only and",
      "encrypted at rest, and a re-run will not replace it. Until then every",
      "Punktemeldung is abandoned missing_vnr_password.",
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

/**
 * What the `projects` row now holds, read inside the tenant context.
 *
 * `enterTenant` has already run — `projects` is under FORCE ROW LEVEL SECURITY
 * and a read on the bare pool matches zero rows, which would arrive here as an
 * all-null shape indistinguishable from "not configured" (§9.6). The seed is
 * inside its transaction and its tenant, so this reads the row it just wrote.
 */
async function storedBinding(
  pool: pg.Pool,
  projectId: string,
): Promise<{ issuer: string | null; audience: string | null; realm: string | null }> {
  const result = await pool.query<{
    keycloak_issuer: string | null;
    keycloak_audience: string | null;
    keycloak_realm: string | null;
  }>(
    `SELECT keycloak_issuer, keycloak_audience, keycloak_realm
       FROM projects WHERE id = $1`,
    [projectId],
  );

  const row = result.rows[0];
  if (row === undefined) {
    // Zero rows here is not "unconfigured" — it is the tenant context being
    // wrong, and saying "no issuer" would send the reader to the console to
    // fix a row they can see is already right.
    throw new Error(
      `projects row id=${projectId} is not visible; the seed's tenant context is wrong`,
    );
  }

  return {
    issuer: row.keycloak_issuer,
    audience: row.keycloak_audience,
    realm: row.keycloak_realm,
  };
}

function seededVnrPassword(): Buffer {
  const cipher = createSecretCipher(
    process.env["NODE_ENV"] ?? "development",
    process.env["SECRETS_KMS_KEY"] ?? "",
  );
  return cipher.encrypt(randomBytes(24).toString("base64url"));
}
