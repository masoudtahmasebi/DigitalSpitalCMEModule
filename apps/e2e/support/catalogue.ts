/**
 * Finding this run's Fortbildung in a catalogue that belongs to somebody else
 * (P89-03).
 *
 * ## What went wrong
 *
 * The post-deploy run of 1c8df78 deployed cleanly, `journey.spec.ts` passed
 * against the installation, and `zwei-module.spec.ts` failed one line into the
 * physician's half:
 *
 * ```
 * Locator: locator('li').filter({ hasText: 'E2E Zwei Module xea41g' }).first()
 * Expected: visible — element(s) not found
 * ```
 *
 * The course was built, published and confirmed visible by the console two
 * lines earlier. What the catalogue does is `ORDER BY title` with **ten per
 * page** (`CourseList.tsx`'s `PER_PAGE`, `catalog.repository.ts`'s `orderBy`),
 * and the DS Test tenant keeps its data on purpose — so it holds one more
 * course after every run this suite has ever made.
 *
 * *"E2E **Z**wei Module"* sorts after every *"E2E **F**ortbildung"* and after
 * almost anything else a tenant is likely to be called. Once ten titles sort
 * before it, it is on page two, and a locator that only ever looks at page one
 * reports it as absent. That is also why the two specs disagreed on the same
 * installation in the same minute: the difference between them is a letter.
 *
 * ## Why this pages rather than deep-linking
 *
 * Opening `#/kurs/<slug>` would have been one line and would have deleted the
 * property being tested. *"The published Fortbildung is in the physician's
 * catalogue"* is the assertion that fails when publishing does not take, when
 * the delivery-type tab is wrong, and when the validity window excludes it —
 * and none of those is visible to anything else in the suite.
 *
 * So the catalogue is still what is walked. What changes is that the suite no
 * longer assumes the alphabet put this run's course on the first page — the
 * §9.13 rule about the rig being shaped like the deployment, applied to the
 * deployment's *data* rather than to its configuration.
 *
 * ## What it cannot do
 *
 * There is no search in the catalogue. A physician on a tenant with two
 * hundred courses has the same problem this helper has, and clicks through it
 * the same way; that is a product observation recorded in P89-03 and not
 * something a test helper gets to fix.
 */

import { expect, type Page } from "@playwright/test";

/**
 * Bounded, so a catalogue that genuinely does not contain the course fails
 * with a message rather than walking until the test times out. Twenty-five
 * pages is 250 courses — far past anything the test tenant will hold, and
 * still finite.
 */
const MAX_PAGES = 25;

/** `de.catalog.empty` — hardcoded here for the same reason every other German
 * string in this suite is: the spec asserts what a person reads. */
const EMPTY =
  "Für die gewählten Filter stehen derzeit keine Fortbildungen zur Verfügung.";

/**
 * Open this run's course from the catalogue, wherever the alphabet put it.
 *
 * Ends on the course detail screen with its heading visible, which is what
 * every caller did by hand before.
 */
export async function openCourseFromCatalogue(
  learner: Page,
  title: string,
): Promise<void> {
  const card = learner.locator("li").filter({ hasText: title }).first();
  const next = learner.getByRole("button", { name: "Vor", exact: true });

  /*
   * Wait for the catalogue to have answered *at all* before starting to page.
   * Without this the first `card.waitFor` absorbs the whole page load into its
   * own timeout, and a course on page two costs that timeout before the first
   * click — which is how a robust helper becomes a slow one.
   *
   * "Zur Fortbildung" and not "Fortbildung fortsetzen": this runs with an
   * account created minutes ago, so no card on the page can be enrolled yet.
   */
  await expect(
    learner
      .getByRole("button", { name: "Zur Fortbildung" })
      .first()
      .or(learner.getByText(EMPTY)),
    "the catalogue never rendered — neither a course card nor the empty notice",
  ).toBeVisible({ timeout: 30_000 });

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    if (await card.isVisible().catch(() => false)) {
      await card.getByRole("button", { name: "Zur Fortbildung" }).click();
      await expect(learner.getByRole("heading", { name: title })).toBeVisible({
        timeout: 20_000,
      });
      return;
    }

    // `isEnabled` throws when the control is not there at all, which is the
    // single-page case — one catch covers "last page" and "no pagination".
    if (!(await next.isEnabled().catch(() => false))) {
      throw new Error(
        [
          `„${title}“ is not in the physician's catalogue.`,
          "",
          `Walked ${String(page)} page(s) to the last one and never saw it.`,
          "In the order to check them:",
          "  1. the course was never published (the console says so explicitly)",
          "  2. it is not on-demand, so it is under the „Weitere“ tab instead",
          "  3. its validity window excludes today — `whereFor` filters on it",
          "  4. the participant belongs to a different project than the course",
        ].join("\n"),
      );
    }

    await next.click();
    /*
     * Settle on the page actually rendering before looking again. The number
     * carries `aria-current="page"`, so this waits for the state the click was
     * for rather than for a duration — a `waitForTimeout` here would be the
     * flake this helper exists to remove.
     */
    await expect(
      learner.getByRole("button", { name: `Seite ${String(page + 1)}` }),
    ).toHaveAttribute("aria-current", "page", { timeout: 20_000 });
  }

  throw new Error(
    `„${title}“ was not found in the first ${String(MAX_PAGES)} catalogue pages.`,
  );
}
