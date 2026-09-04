/**
 * A course with a Lernerfolgskontrolle on every module, finished (P87-05).
 *
 * ## Why this exists beside `journey.spec.ts`
 *
 * That file walks one module with one exam at the end, which is the shape
 * MEDICE's accredited course has and which must keep working. This one walks
 * the shape the client asked for on 17.08:
 *
 * > *"each module, can have each Lernerfolgskontrolle, and when all of the
 * > course is done, videos and Lernerfolgskontrolle they will complete the
 * > course."*
 *
 * and it is the check that would have caught P87-01. That course was
 * **unfinishable**, and every piece that made it so looked correct on its own:
 * `hasPassedQuiz` required every quiz, `findQuizContent` returned the first one
 * in the whole course, and `nextAvailableContent` skipped quizzes entirely. So
 * a physician passed module 1's exam, module 2's was reachable by no route at
 * all, and `courseComplete` stayed false for ever.
 *
 * None of the 525 integration tests could see it. Each of the three functions
 * has coverage and each answered exactly right; what was wrong was the product
 * they add up to, which is CLAUDE.md §9.13 in one sentence.
 *
 * ## What only this can assert
 *
 * Four properties, in order, none of which is visible from an API test:
 *
 *  1. module 2 is **locked** while module 1 is outstanding;
 *  2. module 1's exam opens when module 1's video is watched, and not before
 *     (P87-04) — the control under the player says which;
 *  3. **Weiter** after passing module 1's exam leads into module 2 (P87-03);
 *  4. the course completes and issues a Teilnahmebescheinigung.
 *
 * ## Deliberately shorter than the full journey
 *
 * The upload path, the CSP, the bucket's signature and the reload are all
 * covered by `journey.spec.ts` against the same rig, and repeating them here
 * would double the runtime to re-assert what another file already fails on.
 * What this adds is the second module and the gate between them.
 *
 * Two videos are still watched end to end, at 1×, on the wall clock — the
 * anti-skip rule is not relaxed for this any more than for that one, and the
 * gate that opens is the gate a physician passes.
 */

import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  fillNearest,
  menu,
  readIssuedPassword,
  signInToConsole,
  uploadThroughMediaDialog,
} from "../support/console.js";
import { openCourseFromCatalogue } from "../support/catalogue.js";
import { openWidgetShadowRoots } from "../support/shadow.js";
import { buildBehind, currentTarget } from "../support/target.js";
import { forgetSignInAttempts } from "../support/world.js";

const VIDEO = fileURLToPath(new URL("../fixtures/kurzvideo.webm", import.meta.url));
const STAMP = fileURLToPath(new URL("../fixtures/stempel.png", import.meta.url));
const SIGNATURE = fileURLToPath(new URL("../fixtures/unterschrift.png", import.meta.url));

/** Unique per run — the DS Test tenant keeps its data, so two runs must not collide. */
const RUN = `${Date.now().toString(36).slice(-6)}`;
const COURSE = `E2E Zwei Module ${RUN}`;
const LEARNER_EMAIL = `e2e2m-${RUN}@dstest.example`;
const LEARNER_PASSWORD = "Fortbildung-2026-sicher!";
const EFN = "123456789012345";

/** Reserved, never issued by any Ärztekammer — see `journey.spec.ts`. */
const FIXTURE_VNR = "2760000000000000000";

const MODULE_ONE = "Modul 1 · Diagnostik";
const MODULE_TWO = "Modul 2 · Therapie";
const VIDEO_ONE = "Aufzeichnung Diagnostik";
const VIDEO_TWO = "Aufzeichnung Therapie";
const QUIZ_ONE = "Lernerfolgskontrolle Diagnostik";
const QUIZ_TWO = "Lernerfolgskontrolle Therapie";

test.describe("zwei Module, je eine Lernerfolgskontrolle", () => {
  test("eine Ärztin arbeitet sich Modul für Modul bis zur Bescheinigung durch", async ({
    browser,
  }) => {
    // Two uploads, two videos watched end to end at 1×, and a build in global
    // setup. Every second of this is spent on something real.
    test.setTimeout(420_000);

    const target = currentTarget();
    // §9.9: a failure from here on names the build it was looking at.
    test.info().annotations.push({
      type: "target",
      description: `${target.kind} · ${target.portal} · build ${await buildBehind(target.api)}`,
    });

    // One context for both people — see `journey.spec.ts` for why that is the
    // arrangement rather than an oversight (P66-01).
    const context = await browser.newContext({ acceptDownloads: true });
    const operator = await context.newPage();
    const learner = await context.newPage();
    await openWidgetShadowRoots(learner);

    try {
      // ===================================================================
      // Akt 1 · Der Betreiber baut die Fortbildung
      // ===================================================================
      await signInToConsole(operator, {
        email: target.staffEmail,
        password: target.staffPassword,
        baseUrl: target.admin,
      });

      await menu(operator).getByRole("button", { name: "Zugänge" }).click();
      await operator.getByRole("button", { name: "Zugang anlegen" }).click();
      await operator.getByLabel("Vorname").fill("Petra");
      await operator.getByLabel("Nachname").fill(`Zweimodul ${RUN}`);
      await operator.getByLabel("E-Mail-Adresse").fill(LEARNER_EMAIL);
      await operator
        .getByRole("button", { name: "Zugang anlegen", exact: true })
        .last()
        .click();

      await expect(operator.getByText("Passwort – nur jetzt sichtbar")).toBeVisible({
        timeout: 15_000,
      });
      const temporaryPassword = await readIssuedPassword(
        operator.locator("dl").filter({ hasText: "Passwort" }),
      );

      await menu(operator).getByRole("button", { name: "Fortbildungen" }).click();
      await operator.getByRole("button", { name: "Neue Fortbildung" }).first().click();
      await operator.getByRole("textbox", { name: "Titel" }).fill(COURSE);
      // Grunddaten → Darstellung → Prüfen & anlegen (P132-03). Only the last
      // step writes.
      await operator.getByRole("button", { name: "Weiter" }).click();
      await operator.getByRole("button", { name: "Weiter" }).click();
      await operator.getByRole("button", { name: "Fortbildung anlegen" }).click();
      await expect(operator.getByRole("heading", { name: COURSE })).toBeVisible({
        timeout: 20_000,
      });

      // ===================================================================
      // Akt 2 · Zwei Module, jedes mit Video und Lernerfolgskontrolle
      // ===================================================================
      await addModule(operator, MODULE_ONE, "Kapitel 1 · Grundlagen");
      await addVideo(operator, VIDEO_ONE);
      await addQuiz(operator, QUIZ_ONE, "Worauf beruht die Diagnostik?");

      await addModule(operator, MODULE_TWO, "Kapitel 2 · Vertiefung");
      await addVideo(operator, VIDEO_TWO);
      await addQuiz(operator, QUIZ_TWO, "Welche Therapieform ist indiziert?");

      /*
       * P87-06, from the console rather than from `curl`.
       *
       * A second exam in one module is a shape the gate, the player's tab and
       * the completion arithmetic cannot express, and accepting it silently is
       * how P87-01 arose. Asserting it here — where an author would meet it —
       * is what makes the refusal an affordance rather than a 422 nobody sees.
       */
      await operator.getByRole("button", { name: "Inhalt hinzufügen" }).last().click();
      await operator
        .getByRole("combobox", { name: "Art" })
        .last()
        .selectOption({ label: "Lernerfolgskontrolle" });
      await operator.locator("#content-new-title").fill("Zweite Prüfung");
      await operator.getByRole("button", { name: "Hinzufügen", exact: true }).click();
      await expect(
        operator.getByText(/bereits eine Lernerfolgskontrolle/u),
        "the console accepted a second Lernerfolgskontrolle in one module (P87-06)",
      ).toBeVisible({ timeout: 15_000 });

      // ===================================================================
      // Akt 3 · Evaluationsbogen, Punkte, Bescheinigung, veröffentlichen
      // ===================================================================
      await operator
        .getByRole("button", { name: "Evaluationsbogen", exact: true })
        .click();
      await operator.getByRole("button", { name: "Frage hinzufügen" }).click();
      await operator
        .locator('[id^="evaluation-"][id$="-prompt"]')
        .fill("Wie bewerten Sie diese Fortbildung?");
      await operator.getByRole("button", { name: "Speichern" }).click();
      await expect(operator.getByText(/Gespeichert\./u)).toBeVisible({ timeout: 15_000 });

      await operator
        .getByRole("button", { name: "Inhalte & Darstellung", exact: true })
        .click();
      await operator.getByLabel("CME-Punkte").fill("4");
      await operator.getByLabel("Kategorie").fill("D");
      await operator.getByRole("button", { name: "Speichern" }).click();
      await expect(operator.getByText(/Gespeichert\./u)).toBeVisible({ timeout: 15_000 });

      await operator.getByRole("button", { name: "Einstellungen", exact: true }).click();
      await operator.locator("#organizer").fill("DS Test GmbH");
      await operator.locator("#eventLocation").fill("online");
      await operator.locator("#accreditationBody").fill("Ärztekammer Westfalen-Lippe");
      await operator.locator("#scientificLeadName").fill("Dr. med. E2E Testleitung");
      await operator.locator("#certificateIssuePlace").fill("Münster");
      await operator.locator("#vnr").fill(FIXTURE_VNR);
      await operator.locator("#vnrPassword").fill("nicht-echt-nur-fuer-tests");
      await operator
        .locator("#asset-Stempel-der-wissenschaftlichen-Leitung")
        .setInputFiles(STAMP);
      await operator
        .locator("#asset-Unterschrift-der-wissenschaftlichen-Leitung")
        .setInputFiles(SIGNATURE);
      await operator.getByRole("button", { name: "Speichern" }).click();
      await expect(
        operator.getByText("Diese Fortbildung kann Teilnahmebescheinigungen ausstellen."),
      ).toBeVisible({ timeout: 20_000 });

      await operator.getByRole("button", { name: "Veröffentlichen" }).click();
      await expect(
        operator.getByText(
          "Diese Fortbildung ist veröffentlicht und für Teilnehmende sichtbar.",
        ),
      ).toBeVisible({ timeout: 20_000 });

      // ===================================================================
      // Akt 4 · Die Ärztin meldet sich an und schreibt sich ein
      // ===================================================================
      if (target.kind === "local") await forgetSignInAttempts();
      await learner.goto(`${target.portal}/${target.tenant}`);
      await learner.getByLabel("E-Mail-Adresse").fill(LEARNER_EMAIL);
      await learner.getByLabel("Passwort").fill(temporaryPassword);
      await learner.getByRole("button", { name: "Anmelden" }).click();

      await expect(
        learner.getByText("Bitte wählen Sie ein eigenes Passwort"),
      ).toBeVisible({ timeout: 20_000 });
      await learner.getByLabel("Aktuelles Passwort").fill(temporaryPassword);
      await learner.getByLabel("Neues Passwort", { exact: true }).fill(LEARNER_PASSWORD);
      await learner.getByLabel("Neues Passwort wiederholen").fill(LEARNER_PASSWORD);
      await learner.getByRole("button", { name: "Passwort speichern" }).click();
      await expect(learner.getByRole("button", { name: "Abmelden" })).toBeVisible({
        timeout: 20_000,
      });

      /*
       * Through the catalogue, on whichever page it lists this course (P89-03).
       *
       * This is the line that failed against the installation while everything
       * before it passed. The catalogue is ten per page ordered by title, the
       * DS Test tenant keeps every course this suite has ever built, and
       * „E2E **Z**wei Module …" sorts after all of them — so it was on page two
       * and a first-page locator called it absent. `journey.spec.ts` passed the
       * same minute on the same tenant because its title begins with an F.
       */
      await openCourseFromCatalogue(learner, COURSE);

      await learner.getByRole("button", { name: "Fortbildung starten" }).first().click();
      await expect(
        learner.getByRole("button", { name: "Abspielen" }).first(),
        "enrolment did not reach the player",
      ).toBeVisible({ timeout: 30_000 });

      // ===================================================================
      // Akt 5 · Modul 1 ist offen, Modul 2 nicht — und die Prüfung auch nicht
      // ===================================================================
      /*
       * P87-04, on screen. The exam sits in the same chapter as the video, and
       * until this ticket content simply inherited its chapter's gate — so the
       * control under an untouched player said „Prüfung starten"
       * at nought per cent watched, and the outline drew the exam as reachable.
       *
       * Asserting the **control**, not a padlock somewhere: this is the button
       * a physician's hand goes to, and the two states are mutually exclusive
       * by construction in `PlayerScreen`, so naming one names the other.
       */
      await expect(
        learner.getByRole("button", { name: "Fortbildung pausieren" }).first(),
        "the Lernerfolgskontrolle was offered before its module's video was watched (P87-04)",
      ).toBeVisible({ timeout: 20_000 });
      await expect(learner.getByRole("button", { name: "Prüfung starten" })).toHaveCount(
        0,
      );

      // And module 2's video is not reachable either — the chapter sequence.
      await expect(
        learner.getByRole("button", { name: new RegExp(`Weiter: ${VIDEO_TWO}`, "u") }),
        "module 2 was offered before module 1 was finished",
      ).toHaveCount(0);

      // ===================================================================
      // Akt 6 · Modul 1: Video zu Ende, dann die Prüfung
      // ===================================================================
      await watchToTheEnd(learner);

      /*
       * The gate, with the server's own answer attached to the failure (P132-04).
       *
       * This assertion failed once against production on 31.08 and passed on a
       * re-run, and the message it printed — "module 1's exam never opened" —
       * was everything anybody knew. It cannot distinguish the two causes that
       * matter:
       *
       *   * the union of watched intervals fell short of the enrolment's
       *     completion threshold, so the gate was **correctly** shut and the
       *     watching is what was flaky; or
       *   * the threshold was met and the screen did not re-read the gate,
       *     which is a product defect and the one worth waking up for.
       *
       * The player renders the percentage the **server** credited, so it is the
       * one number that separates them. Attached on failure rather than polled
       * into the assertion, so the gate itself stays exactly as strict — a
       * diagnostic must not become a way for this to pass (§9.1).
       */
      try {
        await expect(
          learner.getByRole("button", { name: "Prüfung starten" }),
        ).toBeVisible({ timeout: 60_000 });
      } catch (cause) {
        const credited = await learner
          .getByText(/% angesehen/u)
          .first()
          .textContent()
          .catch(() => null);
        throw new Error(
          "module 1's exam never opened, after its video played to the end.\n" +
            `The player shows: ${credited ?? "no watched percentage on screen at all"}.\n` +
            "A percentage below the enrolment's completion threshold means the " +
            "watching was short and the gate was right; a percentage at or above " +
            "it means the gate did not re-read, which is a defect in the product " +
            "rather than in this test.",
          { cause },
        );
      }

      /*
       * P87-02: **this module's** exam, not the course's first.
       *
       * Both modules have one, and before this ticket the widget searched the
       * whole course and returned whichever came first — so module 2's player
       * would have offered module 1's exam and module 2's would have been
       * reachable by no route at all. The title is how the two are told apart.
       */
      await learner.getByRole("button", { name: "Prüfung starten" }).click();
      /*
       * Which exam opened, named (P87-02, kept through P190-03).
       *
       * The button used to carry the exam's title and now carries the verb —
       * the 2026-09-01 layout puts the name in the eyebrow above the heading
       * instead, which is where this reads it now. The property under test is
       * unchanged: the player must open **this** module's exam, and the result
       * heading below names it a second time.
       */
      await expect(
        learner.getByText(QUIZ_ONE).first(),
        "the player offered an exam belonging to another module (P87-02)",
      ).toBeVisible({ timeout: 20_000 });
      await learner.getByRole("button", { name: "Prüfung starten" }).click();

      await learner.getByRole("radio").first().check();
      await learner.getByRole("button", { name: "Antworten absenden" }).click();
      await expect(learner.getByText(`${QUIZ_ONE} bestanden!`)).toBeVisible({
        timeout: 30_000,
      });

      // ===================================================================
      // Akt 7 · Weiter führt in Modul 2 — der Weg, den es vorher nicht gab
      // ===================================================================
      /*
       * P87-03. `nextAvailableContent` used to skip quizzes, so after a
       * module's last video **Weiter** looked past its exam into a module the
       * server had locked, found nothing, and drew no control — reported as
       * *"it does not go to next one"*.
       *
       * There is no „CME-Punkte geltend machen" here either, and that is the
       * other half of it: the course is not complete, so the claim is not
       * offered (P82-01).
       */
      await expect(
        learner.getByRole("button", { name: "CME-Punkte geltend machen" }),
        "the Punktemeldung was offered with a module still outstanding",
      ).toHaveCount(0);

      const onward = learner.getByRole("button", {
        name: new RegExp(`Weiter: ${VIDEO_TWO}`, "u"),
      });
      await expect(
        onward,
        "passing module 1's exam did not open a way into module 2 (P87-03)",
      ).toBeVisible({ timeout: 30_000 });
      await onward.click();

      // ===================================================================
      // Akt 8 · Modul 2, dieselbe Runde
      // ===================================================================
      await expect(learner.getByText(VIDEO_TWO).first()).toBeVisible({ timeout: 20_000 });
      await expect(
        learner.getByRole("button", { name: "Fortbildung pausieren" }).first(),
        "module 2's exam was offered before its own video was watched (P87-04)",
      ).toBeVisible({ timeout: 20_000 });

      await watchToTheEnd(learner);

      await learner.getByRole("button", { name: "Prüfung starten" }).click();
      // The exam's name is in the intro's eyebrow now, not on the button —
      // see the note on module 1's exam above.
      await expect(
        learner.getByText(QUIZ_TWO).first(),
        "module 2's own Lernerfolgskontrolle was not the one offered (P87-02)",
      ).toBeVisible({ timeout: 20_000 });
      await learner.getByRole("button", { name: "Prüfung starten" }).click();

      await learner.getByRole("radio").first().check();
      await learner.getByRole("button", { name: "Antworten absenden" }).click();
      await expect(learner.getByText(`${QUIZ_TWO} bestanden!`)).toBeVisible({
        timeout: 30_000,
      });

      // ===================================================================
      // Akt 9 · Evaluation, EFN und die Bescheinigung
      // ===================================================================
      /*
       * Only now. `hasPassedQuiz` requires **every** quiz in the course, so
       * this control appearing is the server agreeing that both modules are
       * done — the assertion P87-01 could never have reached.
       */
      /*
       * `.first()`, because P190-01 draws this control twice on the passed-exam
       * screen: the in-flow CTA and the sidebar's Punktemeldung row, which is
       * the last row of the module list on every player and exam page. Both are
       * legitimately open at this moment and both call the same handler, so
       * Playwright's strict mode is right to refuse to guess — this is the one
       * a physician meets first, in DOM order and on the page.
       *
       * That duplication is what failed deploy 120's journey, the first run
       * that ever reached this line against production. It is raised in P195 as
       * an accessibility question for the client rather than fixed here: two
       * controls with one accessible name are heard twice by a screen reader
       * with nothing to tell them apart, and which of the two should go is a
       * decision about their layout.
       */
      await learner
        .getByRole("button", { name: "CME-Punkte geltend machen" })
        .first()
        .click();

      await expect(learner.getByText("Wie bewerten Sie diese Fortbildung?")).toBeVisible({
        timeout: 30_000,
      });
      await learner.getByRole("radio").last().check({ force: true });
      await learner.getByRole("button", { name: "Evaluation absenden" }).click();

      await expect(learner.getByText("Herzlichen Glückwunsch!")).toBeVisible({
        timeout: 30_000,
      });

      await learner.getByLabel("Vorname").fill("Petra");
      await learner.getByLabel("Nachname").fill(`Zweimodul ${RUN}`);
      await learner.getByLabel("EFN-Nummer").fill(EFN);
      await learner.getByRole("checkbox").first().check({ force: true });
      await learner.getByRole("button", { name: "Daten übermitteln" }).click();

      await expect(
        learner.getByText("Fortbildung abgeschlossen"),
        "a course with an exam on each of two modules did not complete (P87-01)",
      ).toBeVisible({ timeout: 30_000 });

      const download = await Promise.all([
        learner.waitForEvent("download", { timeout: 60_000 }),
        learner
          .getByRole("button", { name: "Teilnahmebescheinigung herunterladen" })
          .click(),
      ]).then(([event]) => event);

      const file = await download.path();
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- a path Playwright wrote in its own temp directory
      const bytes = await readFile(file);
      expect(
        bytes.subarray(0, 5).toString("latin1"),
        "the Teilnahmebescheinigung did not arrive as a PDF",
      ).toBe("%PDF-");
      expect(bytes.length).toBeGreaterThan(2_000);
    } finally {
      await context.close();
    }
  });
});

/**
 * The thing just created is on the structure screen.
 *
 * `.last()`, and it is not arbitrary. Once there are two modules the console
 * also draws an **"In anderes Modul verschieben"** select, whose `<option>`
 * carries the module's title — so a bare `getByText` matches an option inside a
 * closed dropdown as well as the heading, and Playwright refuses the ambiguity.
 * The rendered tree comes after the move controls, so the last match is the one
 * an author is looking at.
 */
async function appeared(page: Page, title: string): Promise<void> {
  await expect(page.getByText(title).last()).toBeVisible({ timeout: 15_000 });
}

/** A module and its first chapter, from the structure tab. */
async function addModule(page: Page, title: string, chapter: string): Promise<void> {
  await page.getByRole("button", { name: "Modul hinzufügen" }).click();
  await fillNearest(page, "Titel", title);
  await page.getByRole("button", { name: "Hinzufügen", exact: true }).click();
  await appeared(page, title);

  // `.last()`, because by the second module there are two of these buttons on
  // the screen and the one that belongs to the module just added is the later.
  await page.getByRole("button", { name: "Kapitel hinzufügen" }).last().click();
  await fillNearest(page, "Titel", chapter);
  await page.getByRole("button", { name: "Hinzufügen", exact: true }).click();
  await appeared(page, chapter);
}

/**
 * A video content, uploaded for real over the presigned PUT.
 *
 * The duration is read off the field rather than typed: the console measures
 * the uploaded object and fills it in, and a figure larger than the file is
 * exactly the 96 % the client has been reporting. Asserting that it arrived at
 * all keeps this journey from building a course whose gate cannot be satisfied.
 */
async function addVideo(page: Page, title: string): Promise<void> {
  await page.getByRole("button", { name: "Inhalt hinzufügen" }).last().click();
  await page.locator("#content-new-title").fill(title);
  // One button, three tabs since P90-01 — see `support/console.ts`.
  await uploadThroughMediaDialog(page, VIDEO);

  await expect(
    page.getByText(/Hochgeladen · .*\.webm/u).first(),
    "the video upload never became a stored source — journey.spec.ts names the four causes",
  ).toBeVisible({ timeout: 60_000 });

  /*
   * Wait for the **measured length**, not merely for the upload.
   *
   * The console reads the duration out of the object once the source lands, and
   * the form refuses a video without one. Clicking „Hinzufügen" before the
   * reading arrives is refused, and the refusal looks exactly like the content
   * simply not appearing — which is how the first run of this file failed, with
   * a screenshot of a fully-filled form.
   *
   * It is also the check the client's 96 % turns on: `durationSec` is the
   * denominator of the watch gate, and a figure larger than the file is a
   * module nobody can finish (P75-01).
   */
  await expect(
    page.getByText(/0:18 \(18 Sekunden\)/u),
    "the length was not read out of the uploaded video — see journey.spec.ts act 4",
  ).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "Hinzufügen", exact: true }).click();
  await appeared(page, title);
}

/** A Lernerfolgskontrolle with one question, whose first option is correct. */
async function addQuiz(page: Page, title: string, prompt: string): Promise<void> {
  await page.getByRole("button", { name: "Inhalt hinzufügen" }).last().click();
  await page
    .getByRole("combobox", { name: "Art" })
    .last()
    .selectOption({ label: "Lernerfolgskontrolle" });
  await page.locator("#content-new-title").fill(title);
  await page.getByRole("button", { name: "Hinzufügen", exact: true }).click();
  await appeared(page, title);

  // `.last()`: by the second module there are two exams on the screen, and the
  // one just added is the later in document order.
  await page.getByRole("button", { name: "Fragen bearbeiten" }).last().click();
  await page.getByRole("button", { name: "Frage hinzufügen" }).click();
  await page.locator('[id^="question-"][id$="-prompt"]').fill(prompt);

  const options = page.locator('[id^="question-"][id*="-label-"]');
  await options.nth(0).fill("Richtige Antwort");
  await options.nth(1).fill("Falsche Antwort");
  await page.getByRole("checkbox").first().check();

  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText(/Gespeichert\./u)).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Zurück zu den Inhalten" }).click();
  await expect(
    page.getByRole("button", { name: "Inhalt hinzufügen" }).first(),
  ).toBeVisible({ timeout: 15_000 });
}

/**
 * Play the section's video from wherever it is to its end, at 1×.
 *
 * Real playback on the wall clock, and it has to be: the API measures reported
 * segments against elapsed real time, so eighteen seconds of video costs
 * eighteen seconds. Nothing here posts a segment, fakes a `timeupdate` or
 * changes the rate — the gate that opens afterwards is the gate a physician
 * passes (`fixtures/README.md`).
 */
async function watchToTheEnd(learner: Page): Promise<void> {
  const video = learner.locator("video").first();
  await learner.getByRole("button", { name: "Abspielen" }).first().click();

  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.ended), {
      message: "the video never reached its end — check the codec and Range support",
      timeout: 90_000,
    })
    .toBe(true);
}
