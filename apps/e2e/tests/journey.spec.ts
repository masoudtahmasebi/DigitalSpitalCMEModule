/**
 * The whole thing, in a browser, from an empty tenant to a certificate (P68-02).
 *
 * ## Why this file exists
 *
 * On 12.08 the client found five defects in one day — an enrolment that
 * answered 403, a video upload blocked by a CSP, a tenant with no content, two
 * seeds that could not run, a control the API refuses — and asked the question
 * this file is the answer to:
 *
 * > *"why do i have to find all of these issues myself? why aren't you testing
 * > these basic functionalities?"*
 *
 * The answer was structural. **The tests called the API; the client used the
 * product.** 512 integration tests drive HTTP against a real Postgres with real
 * RLS, and not one of them can see two cookies on one request, a header set by
 * a reverse proxy, or a deploy's seed step. The browser suite that did exist
 * stopped at course creation and ran against a rig with no CSP and no bucket —
 * which is exactly why it was green while every upload was blocked.
 *
 * So this walks the product, end to end, as the two people who use it:
 *
 *  1. the operator signs in to Verwaltung
 *  2. creates a participant, and reads back the password the console issues
 *  3. builds a Fortbildung: module, chapter, video content
 *  4. **uploads the video** over the presigned PUT, straight to object storage
 *  5. writes a Lernerfolgskontrolle and an Evaluationsbogen
 *  6. fills in the accreditation and the Bescheinigung fields, and publishes
 *  7. the participant signs in at the tenant's own path and chooses a password
 *  8. sees the course, opens it, **enrols**
 *  9. **plays the video, pauses, resumes** — real playback, real wall clock
 * 10. reloads, and the progress is still there
 * 11. finishes the module and passes the Abschlussprüfung
 * 12. submits the Evaluation and supplies an EFN
 * 13. **downloads the Teilnahmebescheinigung, and it is a real PDF**
 *
 * ## One test, not thirteen
 *
 * Every step needs the one before it: there is no enrolling in a course that
 * was never published and no certificate without a quiz that was passed.
 * Thirteen tests would share state through file order, and a retry of the
 * fourth would leave the fifth looking for a course that was never built —
 * which is the arrangement `verwaltung.spec.ts` already rejected for four
 * steps, for the same reason.
 *
 * The acts below are numbered and each failure names its act, so a report says
 * *where* the journey stopped without needing the trace.
 *
 * ## The anti-skip rule is not weakened, and the video is why
 *
 * The API measures watched time against elapsed real time since the learner's
 * last activity, so a report claiming ten minutes in one second is refused —
 * which is what makes a real-time run of a real course impossible, and is
 * presumably why every earlier suite stopped before the player.
 *
 * The fixture is the answer rather than a relaxed rule: `kurzvideo.webm` is
 * eighteen seconds long, `requiredWatchPercent` keeps its real value, and
 * watching it costs eighteen seconds of wall clock. Nothing is mocked, stubbed
 * or fast-forwarded, and the gate that opens is the same gate a physician
 * passes.
 *
 * **Eighteen and not eight** (P71-01): the widget flushes progress every
 * fifteen seconds, so a fixture shorter than that means no flush ever arrives
 * *during* playback — and the client's report was a defect that only happens
 * when one does. A fixture that cannot reach a state cannot find a bug in it,
 * which is CLAUDE.md §9.13's second rule in a new place.
 *
 * **And it is still not a real recording**, which is a known gap rather than a
 * decision (P71-02). The client supplied real 1080p H.264 files for this, and
 * `fixtures/fortbildung-modul.mp4` is one of them, committed. It uploads and
 * stores correctly and it **cannot be played**, because Playwright's Chromium
 * ships no H.264 decoder — the codec every learner's browser has and every real
 * course uses. `codecs.spec.ts` holds that fact as an assertion so it cannot go
 * quiet, and `fixtures/README.md` names the two ways to close it.
 *
 * ## Two targets, one spec
 *
 * Locally this drives the rig `stack.ts` assembles — with the deployed CSP, a
 * bucket that verifies signatures, and both cookies on one host. After a deploy
 * it drives the real hostnames. See `support/target.ts` for why both.
 */

import { expect, test, type Locator, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { signInToConsole, menu } from "../support/console.js";
import { openWidgetShadowRoots } from "../support/shadow.js";
import { buildBehind, currentTarget } from "../support/target.js";
import { forgetSignInAttempts } from "../support/world.js";

const VIDEO = fileURLToPath(new URL("../fixtures/kurzvideo.webm", import.meta.url));
const STAMP = fileURLToPath(new URL("../fixtures/stempel.png", import.meta.url));
const SIGNATURE = fileURLToPath(new URL("../fixtures/unterschrift.png", import.meta.url));

/**
 * Unique per run, because the DS Test tenant's data is kept.
 *
 * The client asked for a tenant whose data stays, so an old run's course is
 * still there to look at when something goes wrong. That only works if two runs
 * never collide — hence a suffix on every name this file writes.
 */
const RUN = `${Date.now().toString(36).slice(-6)}`;
const COURSE = `E2E Fortbildung ${RUN}`;
const LEARNER_EMAIL = `e2e-${RUN}@dstest.example`;
const LEARNER_PASSWORD = "Fortbildung-2026-sicher!";
const EFN = "123456789012345";

/**
 * Reserved, non-existent, and never a real Veranstaltung.
 *
 * A published course awarding CME points must carry a VNR — the constraint
 * `courses_published_cme_is_complete` requires it, and without points there is
 * no Teilnahmebescheinigung to generate, which is half of what this suite is
 * for. So the course is accredited, and the number is one the Ärztekammer has
 * not issued to anybody.
 *
 * What stops that becoming a Punktemeldung is `assertReportingIsOff` below.
 */
const FIXTURE_VNR = "2760000000000000000";

test.describe("die ganze Fortbildung, von leer bis Bescheinigung", () => {
  test("ein Betreiber baut eine Fortbildung, eine Ärztin schließt sie ab", async ({
    browser,
  }) => {
    /*
     * Generous, and every second of it is spent on something real: a workspace
     * build in global setup, an upload, eighteen seconds of video watched at
     * 1x and then again, and — on a second sign-in inside one 30-second TOTP
     * step — a wait for the next code. Shortening this would not make anything faster; it would only
     * turn a slow step into a failure that names the wrong thing.
     */
    test.setTimeout(300_000);

    const target = currentTarget();
    // §9.9, before anything is asserted: a failure from here on names the
    // build it was looking at, so "it is not deployed" and "it is broken" are
    // not the same report.
    test.info().annotations.push({
      type: "target",
      description: `${target.kind} · ${target.portal} · build ${await buildBehind(target.api)}`,
    });

    /*
     * One context for both people, deliberately.
     *
     * Locally the console and the portal share a host and differ only by port,
     * and cookies ignore ports — so a staff session and a learner session land
     * in the same jar. That is precisely the collision that made enrolment
     * answer 403 (P66-01), and running the journey in one context is what keeps
     * it reachable. Two contexts would be tidier and would have been green on
     * the broken build.
     */
    const context = await browser.newContext({ acceptDownloads: true });
    const operator = await context.newPage();
    const learner = await context.newPage();
    await openWidgetShadowRoots(learner);

    /*
     * What the browser said, kept for the one assertion that cannot see it
     * (P68-03).
     *
     * The upload happens between the console and the bucket with no server of
     * ours in the middle, so when it fails the only witness is the browser: a
     * CSP violation, a blocked preflight, a 403 from the bucket. Running
     * locally somebody watches it happen; running after a deploy nobody does,
     * and the message this suite shipped with said "see the browser console",
     * which on a CI runner is advice nobody can take.
     *
     * So the browser's own account is collected from the start and printed with
     * the failure. That is CLAUDE.md §9.4 applied to a test: say what the
     * person does next, at the point they look.
     */
    const browserSaid: string[] = [];
    operator.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") {
        browserSaid.push(`console.${message.type()}: ${message.text()}`);
      }
    });
    operator.on("requestfailed", (request) => {
      browserSaid.push(
        `${request.method()} ${request.url()} failed: ` +
          `${request.failure()?.errorText ?? "no reason given"}`,
      );
    });
    operator.on("response", (response) => {
      if (response.status() >= 400) {
        browserSaid.push(
          `${response.status()} ${response.request().method()} ${response.url()}`,
        );
      }
    });

    /**
     * Every media fetch the learner's browser makes, with the second it made it
     * (P71-03).
     *
     * The journey reproduced the client's report on production — an eighteen
     * second video that stopped by itself at eight — and could say only *that*
     * it stopped. The one observation that separates the two remaining
     * explanations is whether the browser **asked for the video again** at the
     * moment it stopped:
     *
     *   * a second request, at a different URL, means the `<source>` elements
     *     were replaced under a playing element — resource selection re-runs,
     *     the element pauses and the playhead resets, which is the symptom
     *     exactly;
     *   * no second request means the element stopped on its own and the cause
     *     is inside the player or the media itself.
     *
     * A hypothesis that needs another deploy to test is a hypothesis nobody
     * tests. This makes the next run answer it, whichever way it goes.
     */
    const mediaAsked: string[] = [];
    const startedAt = Date.now();
    learner.on("request", (request) => {
      if (request.resourceType() !== "media") return;
      const at = ((Date.now() - startedAt) / 1000).toFixed(1);
      // The query string is the whole point — two presigned URLs for the same
      // object differ only there — but it is long, so the signature is kept and
      // the rest of the credential scope is not.
      const url = new URL(request.url());
      const signature = url.searchParams.get("X-Amz-Signature");
      mediaAsked.push(
        `${at}s ${request.method()} ${url.origin}${url.pathname}` +
          (signature === null ? "" : ` sig=${signature.slice(0, 12)}…`),
      );
    });

    try {
      // ===================================================================
      // Act 1 · The operator signs in
      // ===================================================================
      await signInToConsole(operator, {
        email: target.staffEmail,
        password: target.staffPassword,
        baseUrl: target.admin,
      });

      /*
       * A `customer_admin`, not a super administrator: this is the role a real
       * customer's own administrator holds, and the role whose refusals are
       * easiest to get wrong. Anything this journey cannot do as one is a
       * finding rather than a reason to widen the account (P68-01).
       */
      await expect(
        menu(operator).getByRole("button", { name: "Kunden" }),
        "a customer administrator must not be offered the customer registry",
      ).toHaveCount(0);

      // ===================================================================
      // Act 2 · A participant, and the password the console issues once
      // ===================================================================
      await menu(operator).getByRole("button", { name: "Zugänge" }).click();
      await operator.getByRole("button", { name: "Zugang anlegen" }).click();

      await operator.getByLabel("Vorname").fill("Erika");
      await operator.getByLabel("Nachname").fill(`Musterärztin ${RUN}`);
      await operator.getByLabel("E-Mail-Adresse").fill(LEARNER_EMAIL);
      await operator
        .getByRole("button", { name: "Zugang anlegen", exact: true })
        .last()
        .click();

      /*
       * Read off the screen, the way the operator does.
       *
       * The console generates the password and shows it exactly once — there is
       * no second copy anywhere, by design. So this reads the panel rather than
       * knowing a value in advance, which also makes it a test of the panel: if
       * "nur jetzt sichtbar" ever stops printing a usable credential, this
       * fails here rather than at a sign-in three acts later.
       */
      await expect(operator.getByText("Passwort – nur jetzt sichtbar")).toBeVisible({
        timeout: 15_000,
      });
      const temporaryPassword = await readIssuedPassword(
        operator.locator("dl").filter({ hasText: "Passwort" }),
      );

      // ===================================================================
      // Act 3 · The course, its module, its chapter
      // ===================================================================
      await menu(operator).getByRole("button", { name: "Fortbildungen" }).click();
      await operator.getByRole("button", { name: "Neue Fortbildung" }).first().click();
      await operator.getByRole("textbox", { name: "Titel" }).fill(COURSE);

      /*
       * The Kürzel the console derived, read off the screen rather than
       * recomputed here — `slugify` expands the umlaut in "Fortbildung" and the
       * API refuses anything else, so a broken derivation is a 422 an operator
       * cannot act on.
       */
      const courseSlug = await operator
        .getByRole("textbox", { name: "Kürzel" })
        .inputValue();
      expect(courseSlug).toMatch(/^e2e-fortbildung-[a-z0-9]+$/u);

      await operator.getByRole("button", { name: "Fortbildung anlegen" }).click();

      // The editor opens on the structure tab, which is where the author's next
      // act is — reaching it proves the redirect and the course-detail read.
      await expect(operator.getByRole("heading", { name: COURSE })).toBeVisible({
        timeout: 20_000,
      });

      await operator.getByRole("button", { name: "Modul hinzufügen" }).click();
      await fillNearest(operator, "Titel", "Modul 1 · Grundlagen");
      await operator.getByRole("button", { name: "Hinzufügen", exact: true }).click();
      await expect(operator.getByText("Modul 1 · Grundlagen")).toBeVisible({
        timeout: 15_000,
      });

      await operator.getByRole("button", { name: "Kapitel hinzufügen" }).click();
      await fillNearest(operator, "Titel", "Kapitel 1 · Einführung");
      await operator.getByRole("button", { name: "Hinzufügen", exact: true }).click();
      await expect(operator.getByText("Kapitel 1 · Einführung")).toBeVisible({
        timeout: 15_000,
      });

      // ===================================================================
      // Act 4 · The video, uploaded — the step that was broken and untested
      // ===================================================================
      await operator.getByRole("button", { name: "Inhalt hinzufügen" }).click();
      // By id, not by label: a structure screen has a "Titel" on the module
      // form, the chapter form and this one, and `getByLabel` would have to
      // guess which. The console gives every content field a stable id.
      await operator.locator("#content-new-title").fill("Die Aufzeichnung");

      /*
       * `setInputFiles` on the hidden picker, which is what the "Video
       * hochladen" button opens. From here the console does the real three-step
       * upload: it asks the API for a ticket, PUTs the bytes straight to the
       * bucket over a presigned URL, and asks the API to confirm the object
       * landed. The API never sees a byte.
       *
       * Everything that can go wrong here went wrong in production and was
       * green in this suite: a CSP that does not name the bucket, a bucket with
       * no CORS for PUT, a signature over the wrong canonical request, a
       * `Content-Length` that does not match. All four now fail this line.
       */
      await operator.locator('input[type="file"]').first().setInputFiles(VIDEO);

      const stored = operator.getByText(/hochgeladen|gespeichert/iu).first();
      try {
        await expect(stored).toBeVisible({ timeout: 60_000 });
      } catch (failure) {
        /*
         * Rethrown with the evidence attached, because the assertion alone says
         * only that a chip never appeared — and the cause is always one of four
         * things the browser knows and the DOM does not: a CSP that does not
         * name the bucket, a bucket with no CORS for PUT, a signature over the
         * wrong canonical request, or object storage not configured at all.
         *
         * The console's own message is included too: it is German and written
         * for an operator, and it distinguishes "nicht konfiguriert" from a
         * transport failure without anybody reading a network log.
         */
        const onScreen = (await operator.locator("main").innerText())
          .replace(/\s+/gu, " ")
          .slice(0, 400);

        throw new Error(
          [
            "the upload never produced a stored reference.",
            "",
            "The four causes, in the order to check them:",
            "  1. object storage not configured on this installation (S3_* in config.env)",
            "  2. the console's CSP does not name the bucket (S3_ORIGIN — P67-01)",
            "  3. the bucket has no CORS rule allowing PUT from the console's origin",
            "     — `dist/bucket-cors.js` applies it and proves it (P70-01); the",
            "     deploy runs it, so a green deploy means this is not cause 3",
            "  4. the presigned request did not verify",
            "",
            `The screen says: ${onScreen}`,
            "",
            "The browser said:",
            ...(browserSaid.length === 0
              ? ["  (nothing — which itself rules out 2 and 3)"]
              : browserSaid.slice(-25).map((line) => `  ${line}`)),
            "",
            String(failure),
          ].join("\n"),
        );
      }

      // The format the bucket actually stored it as, not what the picker said.
      await expect(
        operator.getByRole("combobox", { name: "Format" }).first(),
      ).toHaveValue("video/webm");

      /*
       * The length, **measured** rather than typed (P74-04).
       *
       * This is the assertion in this file that changed the most, and the
       * history is the point. The watch gate is a percentage of `durationSec`,
       * so a figure that does not match the file quietly makes the tail of a
       * video optional — a silent accreditation defect. The console has a
       * control for exactly that, "Aus Video ermitteln", and it used to be
       * **absent for an uploaded video**: an `s3://` reference is a storage key
       * and not an address a browser can fetch, so the one control that gets
       * this right disappeared precisely when the author used the console's own
       * uploader. The journey asserted the *sentence explaining the gap*
       * (P68-02) — honest, and not a feature.
       *
       * `adminViewUpload` closed it. So this clicks the button and asserts the
       * number, which walks the whole chain in one act:
       *
       *   the API mints a read signature for an object of this course
       *   → the bucket's CORS rule allows GET from the console's origin
       *     (added in P74-02 — a rule carrying only PUT fails right here)
       *   → the browser reads the container's own header
       *   → the field holds the fixture's real length
       *
       * Not one of those four is visible to an API test.
       *
       * And nothing is typed afterwards. The number has to be exactly the
       * fixture's: it said "8" while the fixture grew to eighteen seconds, and
       * the journey then failed at the very last act with *"Es fehlt noch: die
       * vollständige Videowiedergabe"* — the product being right about a suite
       * that was wrong. A fallback `fill("18")` here would hide a regression in
       * the probe behind a run that stayed green.
       */
      await operator.getByRole("button", { name: "Aus Video ermitteln" }).click();
      try {
        await expect(operator.locator("#content-new-duration")).toHaveValue("18", {
          timeout: 30_000,
        });
      } catch (failure) {
        // The browser's own account, gathered *after* the wait rather than
        // formatted into the assertion message — which Playwright evaluates
        // before it starts waiting, so it would always be empty (P74-04).
        throw new Error(
          [
            "the length was not read out of the uploaded video.",
            "",
            "In the order to check them:",
            "  1. adminViewUpload refused — the key is not under this course's prefix",
            "  2. the bucket's CORS rule has no GET for the console's origin",
            "     (dist/bucket-cors.js applies and proves it; the deploy runs it)",
            "  3. the browser cannot decode the fixture — see tests/codecs.spec.ts",
            "",
            "The browser said:",
            ...(browserSaid.length === 0
              ? ["  (nothing)"]
              : browserSaid.slice(-25).map((line) => `  ${line}`)),
            "",
            String(failure),
          ].join("\n"),
        );
      }

      await operator.getByRole("button", { name: "Hinzufügen", exact: true }).click();
      await expect(operator.getByText("Die Aufzeichnung")).toBeVisible({
        timeout: 15_000,
      });

      // ===================================================================
      // Act 5 · The Lernerfolgskontrolle
      // ===================================================================
      /*
       * A quiz is a *content*, in a chapter, like the video — not a property of
       * the course. So it is added the same way and then filled in through its
       * own editor, which is what "Fragen bearbeiten" opens.
       */
      await operator.getByRole("button", { name: "Inhalt hinzufügen" }).click();
      await operator
        .getByRole("combobox", { name: "Art" })
        .last()
        .selectOption({ label: "Lernerfolgskontrolle" });
      await operator.locator("#content-new-title").fill("Abschlussprüfung");
      await operator.getByRole("button", { name: "Hinzufügen", exact: true }).click();

      await operator.getByRole("button", { name: "Fragen bearbeiten" }).click();
      await operator.getByRole("button", { name: "Frage hinzufügen" }).click();

      await operator
        .locator('[id^="question-"][id$="-prompt"]')
        .fill("Wofür steht ADHS?");
      const options = operator.locator('[id^="question-"][id*="-label-"]');
      await options.nth(0).fill("Aufmerksamkeitsdefizit-/Hyperaktivitätsstörung");
      await options.nth(1).fill("Allgemeine Diagnostik höherer Symptome");
      // The first option is the right one, which is also what act 11 answers.
      await operator.getByRole("checkbox").first().check();

      await operator.getByRole("button", { name: "Speichern" }).click();
      await expect(operator.getByText(/Gespeichert\./u)).toBeVisible({
        timeout: 15_000,
      });

      /*
       * The way out, and the address that makes it one (P74-06).
       *
       * > _"when in here i added a question, i can not easily go back to the
       * > inhalt darstellung"_
       *
       * Two things are asserted here and neither is visible to an API test.
       * The quiz is **in the address bar** — so Back closes it, F5 keeps it, and
       * it can be sent to somebody — and there is an exit at the bottom of the
       * editor, where the author actually is after writing questions, rather
       * than only in the breadcrumb several screens above.
       */
      await expect(operator).toHaveURL(/\/structure\/quiz\/[0-9a-f-]{36}$/u);
      await operator.getByRole("button", { name: "Zurück zu den Inhalten" }).click();
      await expect(
        operator,
        "leaving the quiz must land on the structure tab, not somewhere else",
      ).toHaveURL(/\/structure$/u);
      await expect(
        operator.getByRole("button", { name: "Inhalt hinzufügen" }),
      ).toBeVisible({ timeout: 15_000 });

      // ===================================================================
      // Act 6 · The Evaluationsbogen, which the Bescheid requires
      // ===================================================================
      await operator
        .getByRole("button", { name: "Evaluationsbogen", exact: true })
        .click();
      await operator.getByRole("button", { name: "Frage hinzufügen" }).click();
      await operator
        .locator('[id^="evaluation-"][id$="-prompt"]')
        .fill("Wie bewerten Sie diese Fortbildung?");
      await operator.getByRole("button", { name: "Speichern" }).click();
      await expect(operator.getByText(/Gespeichert\./u)).toBeVisible({
        timeout: 15_000,
      });

      // ===================================================================
      // Act 7 · Points and category — what the Anerkennungsbescheid says
      // ===================================================================
      await operator
        .getByRole("button", { name: "Inhalte & Darstellung", exact: true })
        .click();
      await operator.getByLabel("CME-Punkte").fill("4");
      await operator.getByLabel("Kategorie").fill("D");
      await operator.getByRole("button", { name: "Speichern" }).click();
      await expect(operator.getByText(/Gespeichert\./u)).toBeVisible({
        timeout: 15_000,
      });

      // ===================================================================
      // Act 8 · Everything the Bescheinigung prints, then publish
      // ===================================================================
      await operator.getByRole("button", { name: "Einstellungen", exact: true }).click();

      await operator.locator("#organizer").fill("DS Test GmbH");
      await operator.locator("#eventLocation").fill("online");
      await operator.locator("#accreditationBody").fill("Ärztekammer Westfalen-Lippe");
      await operator.locator("#scientificLeadName").fill("Dr. med. E2E Testleitung");
      await operator.locator("#certificateIssuePlace").fill("Münster");
      await operator.locator("#vnr").fill(FIXTURE_VNR);
      await operator.locator("#vnrPassword").fill("nicht-echt-nur-fuer-tests");

      // Stamp and signature, which the Bescheid requires on every certificate.
      // Uploaded rather than seeded, because the console's own asset path is
      // the one an operator uses and the one that can break.
      await operator
        .locator("#asset-Stempel-der-wissenschaftlichen-Leitung")
        .setInputFiles(STAMP);
      await operator
        .locator("#asset-Unterschrift-der-wissenschaftlichen-Leitung")
        .setInputFiles(SIGNATURE);

      await operator.getByRole("button", { name: "Speichern" }).click();
      await expect(
        operator.getByText("Diese Fortbildung kann Teilnahmebescheinigungen ausstellen."),
        "the console still reports missing certificate fields after act 8 filled them",
      ).toBeVisible({ timeout: 20_000 });

      /*
       * And only now may it be published. A new course is a draft (P53-01), and
       * the database refuses a published CME course with a gap in its paperwork
       * (`courses_published_cme_is_complete`) — so reaching this button with a
       * course that publishes is itself the assertion that acts 3–8 wrote
       * everything the Ärztekammer requires.
       */
      await operator.getByRole("button", { name: "Veröffentlichen" }).click();
      await expect(
        operator.getByText(
          "Diese Fortbildung ist veröffentlicht und für Teilnehmende sichtbar.",
        ),
      ).toBeVisible({ timeout: 20_000 });

      // ===================================================================
      // Act 9 · The physician signs in, at her own tenant's path
      // ===================================================================
      /*
       * The limiter is real and allows five attempts a minute per IP. Every
       * page in this suite arrives from 127.0.0.1, so this run's sign-ins share
       * a bucket with the rest of the file — resetting it is honest rather than
       * a workaround, because the limiter has its own coverage in the API
       * suites and a browser test that has to stay under five is a test that
       * gets deleted the first time somebody adds a sixth.
       *
       * **Only on the local rig.** Against a deployment the limiter is that
       * installation's, protecting real physicians' accounts, and a smoke test
       * that reached in and cleared it would be changing the machine it exists
       * to observe. This run signs in twice, which is under the limit.
       */
      if (target.kind === "local") await forgetSignInAttempts();
      await learner.goto(`${target.portal}/${target.tenant}`);
      await learner.getByLabel("E-Mail-Adresse").fill(LEARNER_EMAIL);
      await learner.getByLabel("Passwort").fill(temporaryPassword);
      await learner.getByRole("button", { name: "Anmelden" }).click();

      /*
       * The password the console issued is temporary by design, so the first
       * sign-in lands on "Bitte wählen Sie ein eigenes Passwort" rather than in
       * the catalogue. Asserting the screen rather than skipping past it: an
       * account that could be used indefinitely on an operator-known password
       * is the thing this flow exists to prevent.
       */
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

      // ===================================================================
      // Act 10 · The course is in the catalogue, and she enrols
      // ===================================================================
      /*
       * Inside the widget's shadow root from here on. It is closed in the
       * product and opened for this browser only — see `support/shadow.ts` for
       * why that is a harness affordance rather than a weakened product, and
       * `learner.spec.ts` for the assertion that keeps it honest.
       */
      /*
       * Scoped to **this run's card**, and that is not a nicety (P71-04).
       *
       * The client asked for a tenant whose data stays, so the DS Test
       * catalogue grows by one course every time this runs. `.first()` on the
       * page's *"Zur Fortbildung"* buttons therefore opens whichever course the
       * catalogue happens to list first — this run's on a rig with one course,
       * somebody else's on the installation. It failed on production at 19:13
       * exactly that way: the card was found, the button belonged to another
       * course, and the heading assertion then looked for a title that was
       * never opened.
       *
       * A suite that only works on an empty tenant is a suite that does not
       * work where the product runs. The card carries the title, so the button
       * is reached through it.
       */
      const card = learner.locator("li").filter({ hasText: COURSE }).first();
      await expect(
        card,
        "the published Fortbildung is not in the physician's catalogue",
      ).toBeVisible({ timeout: 30_000 });

      await card.getByRole("button", { name: "Zur Fortbildung" }).click();
      await expect(learner.getByRole("heading", { name: COURSE })).toBeVisible({
        timeout: 20_000,
      });

      /*
       * Enrolling. This is the request that answered 403 in production for
       * anybody with the console open in another tab (P66-01), and it is a POST
       * from a page whose sibling tab holds a staff session — which is why this
       * journey deliberately runs both people in one browser context.
       */
      // Two of them on the screen — the hero's and the sticky progress bar's,
      // both the same action by design (the resume button scrolling off the top
      // is what the sticky one exists for). The hero's is the one a physician
      // reads first.
      await learner.getByRole("button", { name: "Fortbildung starten" }).first().click();
      const play = learner.getByRole("button", { name: "Abspielen" }).first();
      await expect(play, "enrolment did not reach the player").toBeVisible({
        timeout: 30_000,
      });

      // ===================================================================
      // Act 11 · She watches, pauses, and the progress is really saved
      // ===================================================================
      const video = learner.locator("video").first();
      await play.click();

      /*
       * Real playback, at 1×, on the clock.
       *
       * Nothing here fakes a `timeupdate` or posts a segment directly: the
       * player plays, the tracker observes, and the API credits the union of
       * what was actually watched. That is the whole reason the fixture has a
       * real length — see `fixtures/README.md`.
       */
      await expect
        .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime), {
          message:
            "the video never played — check the codec and the bucket's Range support",
          timeout: 30_000,
        })
        .toBeGreaterThan(3);

      /*
       * The playhead never goes backwards on its own (P71-01).
       *
       * ## What this covers, and what it does not
       *
       * The fixture is eighteen seconds rather than eight so that a progress
       * flush lands *during* playback — `FLUSH_INTERVAL_MS` is fifteen, so a
       * shorter video guaranteed one never did, and everything that can go
       * wrong across a mid-video re-render was unreachable from here.
       *
       * **It did not reproduce the client's report of 13.08**, and that is
       * recorded rather than papered over. P71-01 is a real defect — the
       * watermark of the furthest second watched was destroyed on every flush,
       * and `VideoPlayer.test.tsx` goes red on it — but making the *playhead*
       * visibly snap back needs the server's ceiling to lag the playhead by
       * more than a second, and in this rig it does not: the API credits the
       * union promptly, even at 1,5×. Tried at 1,5× with a twenty-five second
       * fixture; still green against the broken player.
       *
       * So this is a monotonicity guard, not the regression test for that
       * report. It would catch a gross rewind; the unit test is what catches
       * P71-01. Saying so is the point — a check whose reach is overstated is
       * how the last four defects survived (§9.1).
       */
      let furthest = 0;
      const retreats: string[] = [];
      const until = Date.now() + 25_000;
      while (Date.now() < until) {
        const now = await video.evaluate((element: HTMLVideoElement) => ({
          at: element.currentTime,
          paused: element.paused,
        }));
        // Half a second of tolerance: `currentTime` lands on a keyframe rather
        // than exactly where it was set, and this is not a test of decoder
        // precision.
        if (now.at < furthest - 0.5) {
          retreats.push(`${furthest.toFixed(1)}s → ${now.at.toFixed(1)}s`);
        }
        furthest = Math.max(furthest, now.at);
        if (furthest > 16 || (now.paused && furthest > 2)) break;
        await learner.waitForTimeout(250);
      }

      /*
       * Both failures print what the browser asked the bucket for, and when.
       * On 13.08 this act failed on production with `furthest` at eight
       * seconds and nothing in the message could say why — see the collector
       * at the top of this file for what the trail distinguishes.
       */
      const mediaTrail = () =>
        mediaAsked.length === 0
          ? "\n\nThe browser made no media request at all, which is its own finding."
          : `\n\nThe browser asked for media at:\n${mediaAsked
              .map((line) => `  ${line}`)
              .join("\n")}`;

      expect(
        retreats,
        `the playhead went backwards while playing forwards${mediaTrail()}`,
      ).toEqual([]);
      expect(
        furthest,
        "the video stopped before it reached a progress flush. If it paused on " +
          "its own, this is the report of 13.08 — and the trail below says " +
          "whether the browser was handed a new URL for the same object (P71)." +
          mediaTrail(),
      ).toBeGreaterThan(16);

      await learner.getByRole("button", { name: "Pause", exact: true }).first().click();
      await expect
        .poll(() => video.evaluate((element: HTMLVideoElement) => element.paused))
        .toBe(true);

      /*
       * And now the part a component test cannot see: the segments reaching the
       * API. The widget flushes on its own fifteen-second cadence, so this
       * waits for the product's own timing rather than forcing one — a flush
       * this suite triggered would not be evidence that the flush happens.
       *
       * The percentage is the server's answer, not the client's belief: the
       * player renders the union the API credited.
       */
      await expect(
        learner.getByText(/[1-9]\d* % angesehen/u).first(),
        "watched time never reached the API — nothing credited the segments",
      ).toBeVisible({ timeout: 40_000 });

      // ===================================================================
      // Act 12 · It survives a reload — the assertion this exists for
      // ===================================================================
      await learner.reload();
      await expect(
        learner.getByText(/[1-9]\d* % der Videoinhalte angesehen/u),
        "progress did not survive a reload",
      ).toBeVisible({ timeout: 30_000 });

      // Back into the lesson and on to the end of it.
      await learner
        .getByRole("button", { name: "Fortbildung fortsetzen" })
        .first()
        .click();
      await learner.getByRole("button", { name: "Abspielen" }).first().click();
      await expect
        .poll(() => video.evaluate((element: HTMLVideoElement) => element.ended), {
          message: "the video never reached its end",
          timeout: 60_000,
        })
        .toBe(true);

      /*
       * The gate. `requiredWatchPercent` is at its real value, so this opens
       * only because the whole video was genuinely watched — the
       * button that replaces "Fortbildung pausieren" once the server agrees.
       */
      await expect(
        learner.getByRole("button", { name: "Lernerfolgskontrolle beginnen" }),
        "the watch gate never opened, after the video played to its end",
      ).toBeVisible({ timeout: 60_000 });

      // ===================================================================
      // Act 13 · The Abschlussprüfung
      // ===================================================================
      await learner
        .getByRole("button", { name: "Lernerfolgskontrolle beginnen" })
        .click();
      await learner.getByRole("button", { name: "Abschlussprüfung starten" }).click();

      // One question, and the right answer is the first option — the one act 5
      // marked "richtig".
      await learner.getByRole("radio").first().check();
      await learner.getByRole("button", { name: "Antworten absenden" }).click();

      await expect(
        learner.getByText("Abschlussprüfung bestanden!"),
        "the quiz was not passed with the answer the operator marked correct",
      ).toBeVisible({ timeout: 30_000 });

      // ===================================================================
      // Act 14 · Evaluation, EFN, and the Punktemeldung form
      // ===================================================================
      await learner.getByRole("button", { name: "CME-Punkte geltend machen" }).click();

      // The Evaluationsbogen the Bescheid requires. One question, written in
      // act 6 — its scale is a radio group.
      await expect(learner.getByText("Wie bewerten Sie diese Fortbildung?")).toBeVisible({
        timeout: 30_000,
      });
      /*
       * `force`, and it is not papering over anything: the scale's radios are
       * `sr-only` inputs inside their own labels, which is the right way to
       * build a styled radio group — the input is the control, a keyboard user
       * focuses it and presses space, and the label is what a mouse hits.
       * Playwright refuses the click only because the label is on top.
       */
      await learner.getByRole("radio").last().check({ force: true });
      await learner.getByRole("button", { name: "Evaluation absenden" }).click();

      await expect(learner.getByText("Herzlichen Glückwunsch!")).toBeVisible({
        timeout: 30_000,
      });

      await learner.getByLabel("Vorname").fill("Erika");
      await learner.getByLabel("Nachname").fill(`Musterärztin ${RUN}`);
      await learner.getByLabel("EFN-Nummer").fill(EFN);
      /*
       * The Einwilligung, which exists because the DS Test project carries a
       * privacy notice (P68-01). The Punktemeldung sends a named physician's
       * data to their Ärztekammer — an Art. 6(1)(a) consent whose proof is on
       * us — so the box and the `consent_document` behind it are compliance
       * machinery, and a tenant with no notice would never exercise them.
       */
      await learner.getByRole("checkbox").first().check({ force: true });
      await learner.getByRole("button", { name: "Daten übermitteln" }).click();

      /*
       * Submitting takes her to Zertifizierung, where the three
       * Voraussetzungen are now ticked and the Bescheinigung is offered. The
       * banner is the server's verdict, not the form's: `courseComplete` comes
       * back on the enrolment, so this asserts the API agreed rather than that
       * a button was pressed.
       */
      await expect(
        learner.getByText("Fortbildung abgeschlossen"),
        "the completion form did not close the Fortbildung",
      ).toBeVisible({ timeout: 30_000 });

      // ===================================================================
      // Act 15 · The Teilnahmebescheinigung, as a real PDF
      // ===================================================================
      /*
       * The end of the journey and the only artefact the physician keeps. It is
       * asserted as bytes rather than as a button that did not error: a
       * renderer that fails on a missing stamp produces an empty download, and
       * "the click worked" would have been green for it.
       */
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
      // A one-page PDF with a stamp, a signature and two barcodes is tens of
      // kilobytes. A few hundred bytes would be an error document with a
      // header on it.
      expect(bytes.length).toBeGreaterThan(2_000);
    } finally {
      await context.close();
    }
  });
});

/**
 * The password out of the "nur jetzt sichtbar" panel.
 *
 * Read from the definition list rather than by matching text. The first version
 * of this looked for `/Passwort\s+(\S+)/` and came back with an **en dash** —
 * the panel's own title is "Passwort – nur jetzt sichtbar", so the regex
 * matched the heading before it ever reached the value. The sign-in that
 * followed failed with "E-Mail-Adresse oder Passwort ist nicht korrekt", which
 * is the product being right about a one-character password.
 *
 * `dd` is the value half of a `dt`/`dd` pair, which is what the panel actually
 * uses: two rows, address then password. Asserting the count first, so a third
 * row added later fails here rather than silently shifting which value this
 * reads.
 */
async function readIssuedPassword(panel: Locator): Promise<string> {
  const values = panel.locator("dd");
  await expect(
    values,
    "the issued-password panel no longer has exactly an address and a password",
  ).toHaveCount(2);
  // `textContent`, not `innerText`: the panel can be outside the viewport when
  // this runs, and `innerText` answers with the empty string for an element the
  // renderer has not laid out — which reads as "the console issued no password"
  // and fails three acts later at a sign-in.
  return ((await values.last().textContent()) ?? "").trim();
}

/**
 * Fill the field labelled `label` inside the form that is currently open.
 *
 * The console has several forms on a structure screen at once — a module form,
 * a chapter form, a content form — and each carries a "Titel". `getByLabel`
 * would match all of them and Playwright would refuse the ambiguity, so this
 * takes the last one, which is the one that just opened.
 */
async function fillNearest(page: Page, label: string, value: string): Promise<void> {
  await page.getByRole("textbox", { name: label }).last().fill(value);
}
