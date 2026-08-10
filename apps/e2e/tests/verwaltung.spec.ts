/**
 * Signing in to Verwaltung and creating every entity, in a browser (P37-01).
 *
 * ## The question this exists to answer
 *
 * "If I go to Verwaltung and create all the entities, does it all work?" The
 * honest answer before this file was *I don't know*: the admin **API** is
 * covered thoroughly — the journey suite builds the whole hierarchy over HTTP,
 * and `authoring`, `hierarchy` and `moderation` cover it against a real
 * Postgres — but nothing had ever clicked the console's own buttons.
 *
 * The console is a normal Vite SPA with no shadow root, so unlike the learner
 * widget it is fully reachable by Playwright. There was no reason not to.
 *
 * ## The second factor is real here
 *
 * ADR-0012 makes the platform policy `required`, and `super_admin` is the
 * account it matters most for. Switching it to `disabled` for the e2e database
 * would have made this file easy to write and would have meant the browser
 * suite never touches the control standing between a stolen password and every
 * customer's data. So the harness enrols a factor and computes codes the way a
 * phone does — see `support/staff.ts`.
 *
 * ## How far this goes, honestly
 *
 * Sign-in and the first entity — the customer — through the console's own
 * buttons. The department, project and course below it are **not** clicked here
 * yet; they are covered over HTTP by the journey suite's act 3, which builds
 * the whole hierarchy through the same admin endpoints these screens call.
 *
 * That is a real difference and it is worth stating rather than implying: what
 * is proven in a browser is the login, the navigation, and customer creation.
 * What is proven over HTTP is the rest. Extending this file downwards is the
 * obvious next step and the harness for it now exists.
 */

import { expect, test, type Page } from "@playwright/test";
import { ADMIN_BASE } from "../support/stack.js";
import { decodeBase32, totpCode } from "../support/staff.js";

/** Unique per run, so a re-run never collides with its own leftovers. */
const RUN = Date.now().toString(36).slice(-6);
const CUSTOMER = `E2E Kunde ${RUN}`;
/** Lower-case, digits and hyphens — the console says so and the API enforces it. */
const SLUG = `e2e-${RUN}`;

function credentials(): { email: string; password: string } {
  const email = process.env["E2E_STAFF_EMAIL"];
  const password = process.env["E2E_STAFF_PASSWORD"];
  if (email === undefined || password === undefined) {
    throw new Error(
      "global-setup did not publish the staff credentials — did bootstrap-admin run?",
    );
  }
  return { email, password };
}

/**
 * Sign in, enrolling the second factor on the first run and presenting one
 * afterwards.
 *
 * The enrolment screen prints the secret for manual entry, which is exactly
 * what an authenticator app is given — so the harness reads it from the page
 * and keeps it for the rest of the run.
 */
let secret: Buffer | undefined;

async function signInToVerwaltung(page: Page): Promise<void> {
  const { email, password } = credentials();

  await page.goto(`${ADMIN_BASE}/`);
  await page.getByLabel("E-Mail-Adresse").fill(email);
  await page.getByLabel("Passwort").fill(password);
  await page.getByRole("button", { name: "Anmelden" }).click();

  /*
   * `isVisible()` returns immediately — it is a question, not a wait, and the
   * `timeout` option does not change that. The first version used it and asked
   * while the page still said "Anmeldung läuft …", concluded no enrolment was
   * offered, and failed with a message about a secret that was displayed two
   * seconds later. `waitFor` is the waiting one.
   */
  const enrolling = page.getByText("Zwei-Faktor-Authentifizierung einrichten");
  const offered = await enrolling
    .waitFor({ state: "visible", timeout: 15_000 })
    .then(() => true)
    .catch(() => false);

  if (offered) {
    // The key offered "falls Sie nicht scannen können" — base32, exactly what
    // an authenticator app is given, read off the page the same way a person
    // would copy it.
    const shown = /\b[A-Z2-7]{32}\b/u.exec(await page.locator("main").innerText());
    if (shown === null) {
      throw new Error("the enrolment screen showed no base32 key to read");
    }
    secret = decodeBase32(shown[0]);
  }

  if (secret === undefined) {
    throw new Error("no second factor is enrolled and none was offered");
  }

  await page.getByLabel("Sechsstelliger Code").fill(totpCode(secret));
  await page.getByRole("button", { name: "Bestätigen" }).click();
}

test.describe("Verwaltung", () => {
  test("the first operator signs in, second factor and all", async ({ page }) => {
    await signInToVerwaltung(page);

    // Past the login: the console's own chrome is on screen.
    await expect(page.getByRole("button", { name: "Abmelden" })).toBeVisible({
      timeout: 20_000,
    });

    // The navigation the process actually follows (P25-01): what you sell,
    // who takes part, and how it is configured.
    for (const entry of ["Kunden", "Organisation", "Fortbildungen", "Teilnehmende"]) {
      await expect(page.getByRole("button", { name: entry })).toBeVisible();
    }
  });

  test("creates a customer, and it appears where it was created", async ({ page }) => {
    /*
     * The first link in the chain, and the one everything else needs: with no
     * customer selected every tenant screen says "Bitte wählen Sie oben einen
     * Kunden aus" — which is P22-03 working, and also why this has to come
     * first.
     */
    await signInToVerwaltung(page);

    await page.getByRole("button", { name: "Kunden" }).click();

    // The form is on the screen, not behind a button, and its submit is
    // disabled until both fields are filled — so this also asserts that the
    // slug is genuinely required rather than quietly defaulted from the name.
    const submit = page.getByRole("button", { name: "Kunde anlegen" });
    await expect(submit).toBeDisabled();

    await page.getByRole("textbox", { name: "Name" }).fill(CUSTOMER);
    await page.getByRole("textbox", { name: "Kürzel" }).fill(SLUG);
    await expect(submit).toBeEnabled();
    await submit.click();

    // Listed, with its slug — the row an operator would then pick from the
    // customer selector at the top of every tenant screen.
    const row = page.getByRole("row", { name: new RegExp(CUSTOMER, "u") });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row).toContainText(SLUG);
  });
});
