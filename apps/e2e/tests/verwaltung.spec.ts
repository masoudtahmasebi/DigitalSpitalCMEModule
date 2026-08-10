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
 * ## How far this goes
 *
 * The whole chain, through the console's own buttons: customer → picking it in
 * the app bar → department → project → course, and then back up to check that
 * the course is counted against the project it was put in.
 *
 * ## Why the chain is one test rather than five (P37-02)
 *
 * Each link needs the one above it, and the console keeps that dependency in
 * places a fresh page load does not restore — the chosen customer is app state,
 * and every tenant screen is inert without it. Five tests would either repeat
 * sign-in and re-selection four times or share state through test ordering,
 * which is the arrangement where a retry of the second test leaves the third
 * looking for a customer that was never created. One test that walks the chain
 * has neither problem, and it is also the thing being asked about: not "can a
 * department be created" but "does an operator get from an empty console to a
 * course".
 */

import { expect, test, type Page } from "@playwright/test";
import { menu, signInToConsole } from "../support/console.js";

/** Unique per run, so a re-run never collides with its own leftovers. */
const RUN = Date.now().toString(36).slice(-6);
const CUSTOMER = `E2E Kunde ${RUN}`;
/** Lower-case, digits and hyphens — the console says so and the API enforces it. */
const SLUG = `e2e-${RUN}`;

/*
 * The three below it. Their slugs are **not** written out here: the console
 * derives each one from the name as it is typed, and asserting on a value this
 * file computed itself would prove nothing about that derivation. What the test
 * does instead is read the Kürzel field back — see `slugFieldValue`.
 *
 * The names carry an umlaut on purpose. `slugify` expands ä→ae, and the reason
 * that code exists is that German titles are the normal case here; a suite that
 * only ever typed ASCII would never touch it.
 */
const DEPARTMENT = `E2E Abteilung ${RUN}`;
const PROJECT = `E2E Präsenz ${RUN}`;
const COURSE = `E2E Fortbildung ${RUN}`;

/**
 * The super administrator `bootstrap-admin` created, handed over by
 * `global-setup` through the environment — Playwright's own channel between the
 * runner process and the workers it spawns.
 */
function superAdmin(): { email: string; password: string } {
  const email = process.env["E2E_STAFF_EMAIL"];
  const password = process.env["E2E_STAFF_PASSWORD"];
  if (email === undefined || password === undefined) {
    throw new Error(
      "global-setup did not publish the staff credentials — did bootstrap-admin run?",
    );
  }
  return { email, password };
}

async function signInToVerwaltung(page: Page): Promise<void> {
  await signInToConsole(page, superAdmin());
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
      await expect(menu(page).getByRole("button", { name: entry })).toBeVisible();
    }
  });

  test("builds a customer, a department, a project and a course, in that order", async ({
    page,
  }) => {
    /*
     * Twice the default, for one reason that is not the console's fault: this
     * is the run's second sign-in, and a second factor cannot be presented
     * twice in the same thirty-second step — see `freshTotpCode`. Waiting for
     * the next code can cost thirty seconds before the first click happens.
     */
    test.setTimeout(120_000);

    await signInToVerwaltung(page);

    // -----------------------------------------------------------------------
    // 1 · The customer, and why nothing else can come first
    // -----------------------------------------------------------------------
    /*
     * With no customer selected every tenant screen says "Bitte wählen Sie oben
     * einen Kunden aus" — P22-03 working — and the Kunden screen is the one
     * place above every tenant, so it is reachable in exactly the state a fresh
     * installation is in.
     */
    await menu(page).getByRole("button", { name: "Kunden" }).click();

    // The form is on the screen, not behind a button, and its submit is
    // disabled until both fields are filled — so this also asserts that the
    // slug is genuinely required rather than quietly defaulted from the name.
    const createCustomer = page.getByRole("button", { name: "Kunde anlegen" });
    await expect(createCustomer).toBeDisabled();

    await page.getByRole("textbox", { name: "Name" }).fill(CUSTOMER);
    await page.getByRole("textbox", { name: "Kürzel" }).fill(SLUG);
    await expect(createCustomer).toBeEnabled();
    await createCustomer.click();

    // Listed, with its slug — the row an operator would then pick from the
    // customer selector at the top of every tenant screen.
    const customerRow = page.getByRole("row", { name: new RegExp(CUSTOMER, "u") });
    await expect(customerRow).toBeVisible({ timeout: 15_000 });
    await expect(customerRow).toContainText(SLUG);

    // -----------------------------------------------------------------------
    // 2 · Picking it in the app bar
    // -----------------------------------------------------------------------
    /*
     * The picker lives beside the operator's identity rather than above the
     * content, because it is scope and not a filter (P22-07) — and it has to
     * offer a customer created seconds ago on another screen. It did not once:
     * `Customers` refreshed its own copy of the list and left this one empty,
     * so the console said "no customer has been created yet" while the table
     * behind it listed the customer just created (P22-05). Selecting by label
     * here is what would fail if that regressed.
     */
    await page.getByRole("combobox", { name: "Kunde" }).selectOption({ label: CUSTOMER });

    // -----------------------------------------------------------------------
    // 3 · A department
    // -----------------------------------------------------------------------
    await menu(page).getByRole("button", { name: "Organisation" }).click();
    await expect(
      page.getByText("Es sind noch keine Abteilungen angelegt."),
    ).toBeVisible();

    await page.getByRole("button", { name: "Neue Abteilung" }).click();
    await page.getByRole("textbox", { name: "Name" }).fill(DEPARTMENT);

    // The slug the console derived, read off the screen rather than recomputed
    // here. `slugify` expands the umlaut and the API refuses anything else, so
    // a broken derivation is a 422 an operator cannot act on.
    const departmentSlug = await slugFieldValue(page);
    expect(departmentSlug).toMatch(/^e2e-abteilung-[a-z0-9]+$/u);

    await page.getByRole("button", { name: "Hinzufügen" }).click();

    const departmentRow = page.getByRole("row", { name: new RegExp(DEPARTMENT, "u") });
    await expect(departmentRow).toBeVisible({ timeout: 15_000 });
    await expect(departmentRow).toContainText(departmentSlug);

    // -----------------------------------------------------------------------
    // 4 · A project, on the identity provider the console can actually send
    // -----------------------------------------------------------------------
    /*
     * "Neues Projekt" only appears once a department exists — a project without
     * one has nowhere to hang — so reaching this button is itself the assertion
     * that step 3 landed.
     *
     * The provider is set to this platform's own credentials rather than left
     * on the Keycloak default, because that is the value P28-02 added to the
     * API and P22 later had to add to *this form*: an API that accepts a value
     * the console cannot send is not a fixed bug, and a project created on the
     * wrong provider has participants who cannot sign in at all.
     */
    await page.getByRole("button", { name: "Neues Projekt" }).click();
    await expect(page.getByRole("combobox", { name: "Abteilung" })).toHaveValue(
      departmentSlug,
    );

    await page.getByRole("textbox", { name: "Name" }).fill(PROJECT);
    const projectSlug = await slugFieldValue(page);
    expect(projectSlug).toMatch(/^e2e-praesenz-[a-z0-9]+$/u);

    await page.getByRole("combobox", { name: "Anmeldeverfahren" }).selectOption("local");
    await page.getByRole("button", { name: "Hinzufügen" }).click();

    /*
     * By its Kürzel, which the panel prints beside the name. The name alone
     * would also match the form that was just submitted if the form failed to
     * close, and "the entity appears" is exactly the assertion that must not
     * pass in that case.
     */
    const projectOnScreen = page.getByText(projectSlug, { exact: true });
    await expect(projectOnScreen).toBeVisible({ timeout: 15_000 });
    // The name sits beside the Kürzel in the same panel title, as a bare text
    // node rather than an element of its own — so it is asserted through the
    // element that *is* addressable rather than by matching text that has no
    // element to match against.
    await expect(projectOnScreen.locator("..")).toContainText(PROJECT);

    // -----------------------------------------------------------------------
    // 5 · A course
    // -----------------------------------------------------------------------
    await menu(page).getByRole("button", { name: "Fortbildungen" }).click();
    await expect(
      page.getByText("Für diesen Mandanten sind keine Fortbildungen hinterlegt."),
    ).toBeVisible({ timeout: 15_000 });

    // The empty state offers the action, and it is the only one on the screen —
    // the header action is deliberately suppressed while the list is empty so
    // two buttons do not share an accessible name.
    await page.getByRole("button", { name: "Neue Fortbildung" }).click();

    await expect(page.getByRole("combobox", { name: "Projekt" })).toHaveValue(
      projectSlug,
    );
    await page.getByRole("textbox", { name: "Titel" }).fill(COURSE);
    const courseSlug = await slugFieldValue(page);
    expect(courseSlug).toMatch(/^e2e-fortbildung-[a-z0-9]+$/u);

    await page.getByRole("button", { name: "Fortbildung anlegen" }).click();

    // Creating a course opens its editor on the structure tab, which is where
    // the author's next act is. Getting here proves the redirect and the
    // course-detail read, not only the write.
    await expect(page.getByRole("heading", { name: COURSE })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole("button", { name: "Einstellungen" })).toBeVisible();

    // -----------------------------------------------------------------------
    // 6 · Back up the chain
    // -----------------------------------------------------------------------
    await menu(page).getByRole("button", { name: "Fortbildungen" }).click();

    /*
     * A new course is **not** ready to certify, and the list says so. That is
     * the point of P28-03: VNR, points, Veranstalter and the wissenschaftliche
     * Leitung are set afterwards, and the badge is what tells an author the
     * course is not finished — a course that claimed "bereit" here would issue
     * a Teilnahmebescheinigung missing fields the Ärztekammer requires.
     */
    const courseRow = page.getByRole("row", { name: new RegExp(COURSE, "u") });
    await expect(courseRow).toBeVisible({ timeout: 15_000 });
    await expect(courseRow).toContainText("unvollständig");

    /*
     * And the course is counted against the project it was put into. This is
     * the assertion that the two screens agree: the count comes from the same
     * repository read the course list does, one level up, and a project showing
     * 0 Fortbildungen next to a course claiming that project would mean the
     * hierarchy the console displays is not the hierarchy it wrote.
     */
    await menu(page).getByRole("button", { name: "Organisation" }).click();
    await expect(projectOnScreen).toBeVisible({ timeout: 15_000 });

    // The project's summary list, of which there is exactly one because there
    // is exactly one project — asserted rather than assumed, since a second
    // would make the next line read the wrong project's count.
    const summaries = page.locator("dl");
    await expect(summaries).toHaveCount(1);
    // Anchored, so "1" has to be the whole count rather than a digit somewhere
    // in the cell — `toContainText("1")` would have passed on 21 and on 0 of 1.
    await expect(
      summaries.locator("div").filter({ hasText: "Fortbildungen" }),
    ).toHaveText(/^Fortbildungen\s*1$/u);
  });
});

/**
 * The Kürzel the console derived from the name just typed.
 *
 * Read rather than recomputed on purpose: this file could `slugify` the name
 * itself and compare, but then both sides of the assertion would come from the
 * test and a console that derived nothing at all would still pass.
 */
async function slugFieldValue(page: Page): Promise<string> {
  const field = page.getByRole("textbox", { name: "Kürzel" });
  await expect(field).not.toHaveValue("");
  return field.inputValue();
}
