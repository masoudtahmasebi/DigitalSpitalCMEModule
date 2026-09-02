/**
 * Signing in to Verwaltung, for any operator (P38-01).
 *
 * ## Why this moved out of a spec file
 *
 * `verwaltung.spec.ts` had it inline, for one account. The moment a second
 * spec needed a *different* account — a customer administrator and a course
 * editor, to look at the two roles the client asked for — the choice was one
 * implementation or three copies of a flow that enrols a second factor,
 * computes RFC 6238 codes and knows what the enrolment screen looks like.
 *
 * ## The secret has to outlive the sign-in
 *
 * An account that enrols a factor does so exactly once. Every sign-in
 * afterwards presents a code, which means the secret read off the enrolment
 * screen has to be remembered — per account, because two accounts have two
 * different secrets and presenting one for the other looks identical to a wrong
 * code.
 *
 * The map is module state, which reaches every spec **because this suite runs
 * with `workers: 1`**. That is stated in `playwright.config.ts` for its own
 * reasons (a shared database and an inherently ordered journey), and this
 * depends on it: a second worker is a second module instance with an empty map,
 * which would try to enrol an account that already holds a factor and fail with
 * a message about a screen that never appeared.
 */

import { expect, type Locator, type Page } from "@playwright/test";
import { ADMIN_BASE } from "./stack.js";
import { decodeBase32, freshTotpCode } from "./staff.js";

const secrets = new Map<string, Buffer>();

/** The sidebar, named so a breadcrumb button of the same name is not matched. */
export function menu(page: Page) {
  return page.getByRole("navigation", { name: "Menü" });
}

export interface ConsoleCredentials {
  readonly email: string;
  readonly password: string;
  /**
   * Where the console is, when it is not the local rig's (P68-03).
   *
   * The first version of this helper navigated to `ADMIN_BASE` unconditionally,
   * and the smoke run — pointed at a deployment — obediently drove
   * `127.0.0.1:4181` and failed with a connection refused. A helper that
   * silently ignores which installation it was asked for is the same shape as
   * every other check in this repository that could not go red where it
   * mattered, so the base is an argument now.
   */
  readonly baseUrl?: string | undefined;
}

/**
 * Sign in, taking whichever second-factor path this account's policy leads to.
 *
 * Ends when the console has actually drawn its sidebar. Returning at the moment
 * the form was submitted is how the first version of the chain test failed
 * fifteen seconds into a screen still showing the login form.
 */
export async function signInToConsole(
  page: Page,
  credentials: ConsoleCredentials,
): Promise<void> {
  await page.goto(`${credentials.baseUrl ?? ADMIN_BASE}/`);
  await page.getByLabel("E-Mail-Adresse").fill(credentials.email);
  await page.getByLabel("Passwort").fill(credentials.password);
  await page.getByRole("button", { name: "Anmelden" }).click();

  /*
   * Three ways this can go, and the helper has to be able to take all three.
   *
   * `super_admin` grants are governed by the **platform** policy, which
   * ADR-0012 fixes at `required` — so that account always meets enrolment on
   * its first sign-in. A customer-scoped operator is governed by their
   * **customer's** policy, which defaults to `optional`
   * (`DEFAULT_CUSTOMER_SECOND_FACTOR`), so `verwaltung@` and `redaktion@` go
   * straight in.
   *
   * The first version of this file assumed the super administrator's path was
   * the only one and threw "no second factor is enrolled and none was offered"
   * at a screen that was, at that moment, the fully signed-in console. Which is
   * the product being right and the harness being narrow — the same shape as
   * the TOTP replay finding.
   *
   * `Promise.race` over three locators rather than a sequence of waits: asking
   * "did enrolment appear?" first costs its full timeout on every sign-in that
   * skips it, and would make the honest answer the slow one.
   */
  const enrolling = page.getByText("Zwei-Faktor-Authentifizierung einrichten");
  const codePrompt = page.getByLabel("Sechsstelliger Code");
  const console_ = menu(page).getByRole("button", { name: "Fortbildungen" });

  const outcome = await Promise.race([
    whichever(enrolling.waitFor({ state: "visible", timeout: 25_000 }), "enrol"),
    whichever(codePrompt.waitFor({ state: "visible", timeout: 25_000 }), "code"),
    whichever(console_.waitFor({ state: "visible", timeout: 25_000 }), "in"),
    // The losers never settle, so if none of the three appears the race would
    // hang until Playwright's own timeout and report nothing about why. This
    // arm is what turns that into a sentence.
    new Promise<Outcome>((resolve) => setTimeout(() => resolve("none"), 26_000)),
  ]);

  if (outcome === "none") {
    throw new Error(
      `signing in as ${credentials.email} reached neither enrolment, nor a code ` +
        `prompt, nor the console. The page says: ${(
          await page.locator("body").innerText()
        )
          .replace(/\s+/gu, " ")
          .slice(0, 300)}`,
    );
  }

  if (outcome === "enrol") {
    // The key offered "falls Sie nicht scannen können" — base32, exactly what
    // an authenticator app is given, read off the page the same way a person
    // would copy it.
    const shown = /\b[A-Z2-7]{32}\b/u.exec(await page.locator("main").innerText());
    if (shown === null) {
      throw new Error("the enrolment screen showed no base32 key to read");
    }
    secrets.set(credentials.email, decodeBase32(shown[0]));
  }

  if (outcome !== "in") {
    const secret = secrets.get(credentials.email);
    if (secret === undefined) {
      throw new Error(
        `${credentials.email} was asked for a code this harness has no secret for`,
      );
    }
    await codePrompt.fill(await freshTotpCode(secret));
    await page.getByRole("button", { name: "Bestätigen" }).click();
  }

  // Signed in, not merely submitted: the sidebar is the first thing every
  // caller reaches for. "Fortbildungen" rather than "Kunden" because a customer
  // administrator does not get "Kunden" at all — which is the point of the role
  // and would otherwise make this helper unusable for them.
  await expect(console_).toBeVisible({ timeout: 20_000 });
}

type Outcome = "enrol" | "code" | "in" | "none";

/**
 * Label a wait, and make a losing one silent.
 *
 * Three `waitFor`s race, so two of them will time out afterwards. Left alone
 * those are unhandled rejections — noise at best, and at worst a failure
 * attributed to whichever test happened to be running when they landed. A
 * loser resolves to a promise that never settles, which is exactly what a
 * losing arm of a race should be.
 */
function whichever(wait: Promise<unknown>, outcome: Outcome): Promise<Outcome> {
  return wait.then(
    () => outcome,
    () => new Promise<Outcome>(() => undefined),
  );
}

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
export async function readIssuedPassword(panel: Locator): Promise<string> {
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
export async function fillNearest(
  page: Page,
  label: string,
  value: string,
): Promise<void> {
  await page.getByRole("textbox", { name: label }).last().fill(value);
}

/**
 * Put a file into the content form's video sources, through the media dialog
 * (P90-01).
 *
 * ## Why this is a helper and not two lines in each spec
 *
 * The control changed shape once already. It was a hidden `<input type=file>`
 * behind a "Video hochladen" button, and both journeys reached past the button
 * to the input with `locator('input[type="file"]').first()` — which worked, and
 * which quietly depended on that input being the first one on the page.
 *
 * It is now one button opening a dialog, because the client could not tell
 * three buttons apart. Two specs reaching into the same rebuilt control is
 * exactly the thing that should have one implementation: the next change to it
 * edits this function, not every act that uploads something.
 *
 * `#content-new-choose-media` rather than the button's label, and the id exists
 * for this: the same label appears on the poster, the subtitles and the material
 * fields of the same form, so a locator by name is ambiguous and a positional
 * one depends on the order the form renders in.
 */
export async function uploadThroughMediaDialog(page: Page, file: string): Promise<void> {
  await page.locator("#content-new-choose-media").click();

  const dialog = page.getByRole("dialog");
  await expect(dialog, "the media dialog did not open").toBeVisible({ timeout: 15_000 });

  /*
   * The upload tab, explicitly, and never mind which tab is showing.
   *
   * The dialog opens on the Mediathek, and this is deliberately not conditional
   * on whether the library is empty: on the local rig it is and on the
   * installation it is not, so a spec that branched would exercise a different
   * path in each place — which is how a post-deploy failure ends up being about
   * the harness (§9.13).
   */
  await dialog.getByRole("tab", { name: "Datei hochladen" }).click();
  await dialog.locator('input[type="file"]').setInputFiles(file);
}
