/**
 * The console at three widths, and every control named (P227-01).
 *
 * ## Why this is a browser test, and why it is not a screenshot review
 *
 * The redesign was looked at by eye at 1440 px. Eyes do not scale: a person
 * reviewing thirteen screens at three widths is thirty-nine judgements, and the
 * two properties that actually break are both ones a browser can answer exactly.
 *
 * Neither is checkable anywhere else. `jsdom` has no layout, so it cannot know
 * whether a page scrolls sideways; and an accessible name is computed from the
 * whole rendered tree — label, `aria-label`, `aria-labelledby`, text content,
 * `title` — which is a browser's job, not a class string's (§9.7, §9.13).
 *
 * ## The two properties
 *
 * **1. The page body never scrolls horizontally.** A table may — `Table` wraps
 * itself in `overflow-x-auto` on purpose, because the alternative is truncated
 * course titles. What must not happen is the *document* growing wider than the
 * window, which is the difference between "this table scrolls" and "the whole
 * screen is broken and half the buttons are off the edge".
 *
 * **2. Every interactive control has a non-empty accessible name.** An unnamed
 * button is a button a screen reader announces as "button", and the operator has
 * to guess from position. This is the check that would have caught the language
 * switch being named "EN" — `TopBar.test.tsx` catches that one specifically now,
 * and this catches the class across every screen.
 *
 * ## Widths
 *
 * 1440 desktop, 834 tablet, 390 phone — the three the review named. The console
 * is an operator tool and mostly used at desktop, but "mostly" is not "only",
 * and a tenant administrator checking a Punktemeldung on a phone is a real
 * person.
 */

import { expect, test, type Page } from "@playwright/test";
import { menu, signInToConsole } from "../support/console.js";
import { CUSTOMER_ADMIN_EMAIL, STAFF_PASSWORD } from "../support/world.js";

const WIDTHS = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "tablet", width: 834, height: 1112 },
  { name: "phone", width: 390, height: 844 },
] as const;

/** Every screen a `customer_admin` is offered, by its sidebar label. */
const SCREENS = [
  "Organisation",
  "Fortbildungen",
  "Mediathek",
  "Zugänge",
  "Teilnehmende",
  "Bescheinigungen",
  "Punktemeldungen",
  "Konten",
  "Erscheinungsbild",
  "Texte",
  "Sicherheit",
] as const;

/**
 * How far the document overflows its own window, in pixels.
 *
 * `documentElement.scrollWidth` against `innerWidth`, which is the page as a
 * whole — a table scrolling inside its own `overflow-x-auto` container does not
 * move this number, and that is exactly the distinction being drawn.
 */
async function overflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

/**
 * Controls the operator can reach that announce as nothing.
 *
 * ## Why this asks Playwright rather than reading attributes
 *
 * The first version of this function computed the name by hand — `aria-label`,
 * then text content, then `title`, then `label[for=…]` for form roles. It
 * reported three findings and **all three were false**:
 *
 * - the Mediathek search box is wrapped in `<label><span>Suchen</span><input/>
 *   </label>`, an **implicit** label, which a `label[for]` lookup cannot see;
 * - the font picker has an explicit `label[for="font-file"]`, which the
 *   hand-rolled version only consulted for form roles and the platform reports
 *   as a `button`.
 *
 * A check that cries wolf is worse than no check, because the next person
 * learns to skim its output — so the name is now computed by the thing that
 * computes it for real. `getByRole(role, { name })` is Playwright's
 * implementation of the accessible-name algorithm, so `name: /\S/` means
 * "named by any of the ways a name can be given", and the difference between
 * that set and all visible controls is exactly the finding.
 */
async function unnamedControls(page: Page): Promise<readonly string[]> {
  const found: string[] = [];

  for (const role of ["button", "link", "textbox", "combobox", "checkbox"] as const) {
    /*
     * Marked in the page, not compared across the wire.
     *
     * The first version held an element handle per control and compared them
     * pairwise with `evaluate((a, b) => a === b)`, which is O(n²) round-trips —
     * on a screen with forty controls it exceeded a four-minute test timeout
     * without reporting anything at all. `evaluateAll` runs once, in the page,
     * over every matched node.
     */
    await page
      .getByRole(role, { name: /\S/ })
      .evaluateAll((nodes) => {
        for (const node of nodes) node.setAttribute("data-ds-named", "");
      })
      .catch(() => undefined);

    const unnamed = await page.getByRole(role).evaluateAll((nodes) =>
      nodes
        .filter((node) => {
          if (node.hasAttribute("data-ds-named")) return false;
          // Not reachable, so not announced either — a collapsed sidebar's
          // buttons are not a finding.
          const box = node.getBoundingClientRect();
          return box.width > 0 && box.height > 0;
        })
        .map((node) => node.outerHTML.slice(0, 140)),
    );

    for (const html of unnamed) found.push(`<${role}> ${html}`);

    await page
      .locator("[data-ds-named]")
      .evaluateAll((nodes) => {
        for (const node of nodes) node.removeAttribute("data-ds-named");
      })
      .catch(() => undefined);
  }

  return found;
}

test.describe("Verwaltung, an jeder Breite", () => {
  for (const size of WIDTHS) {
    test(`${size.name} (${size.width} px): kein Seitenüberlauf, jedes Bedienelement benannt`, async ({
      page,
    }) => {
      test.setTimeout(240_000);

      /*
       * Signed in at desktop width, then resized.
       *
       * Not a shortcut around a defect: `signInToConsole` ends when the console
       * has drawn its **sidebar**, and below 768 px the sidebar is collapsed
       * behind the menu button by design (P30-02) — so at 390 px the helper
       * waits for something that correctly is not there and reports "reached
       * neither enrolment, nor a code prompt, nor the console" about a console
       * that is plainly loaded.
       *
       * That is a limitation of the harness rather than of the product, and it
       * is recorded in P227 rather than worked around silently. What this test
       * is about is the screens at each width, and the resize below puts them
       * there.
       */
      await page.setViewportSize({ width: 1440, height: 1000 });
      await signInToConsole(page, {
        email: CUSTOMER_ADMIN_EMAIL,
        password: STAFF_PASSWORD,
      });
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.waitForTimeout(400);

      const overflows: string[] = [];
      const unnamed: string[] = [];
      const visited: string[] = [];

      for (const label of SCREENS) {
        // On a narrow screen the sidebar is behind the menu button.
        if (size.width < 768) {
          const opener = page.getByRole("button", { name: "Menü" });
          if ((await opener.count()) > 0 && (await opener.isVisible()))
            await opener.click();
          await page.waitForTimeout(150);
        }
        const link = menu(page).getByRole("button", { name: label });
        /*
         * `toBeVisible`, not `if (count === 0) continue`.
         *
         * The skip is what the first version did, and it made the 390 px case
         * **pass while visiting nothing**: the sidebar is collapsed at that
         * width, the menu had not opened, every screen was skipped, and both
         * assertions below ran over empty arrays and agreed. A sabotage that
         * put a 2,400 px element on every screen did not move it, which is the
         * only reason this was found -- §9.1, and deploy 131's exact shape:
         * a check that measures nothing reports no problem.
         *
         * Failing here means "the harness could not reach this screen" is
         * reported rather than absorbed.
         */
        await expect(
          link,
          `${label} was not reachable at ${size.width} px - the navigation did not open, so this width would otherwise have been checked against nothing`,
        ).toBeVisible({ timeout: 10_000 });
        await link.click();
        await page.waitForTimeout(900);
        visited.push(label);

        const past = await overflow(page);
        if (past > 1)
          overflows.push(`${label}: the page is ${past} px wider than the window`);

        for (const control of await unnamedControls(page)) {
          unnamed.push(`${label}: ${control}`);
        }
      }

      /*
       * The census. Every assertion below is over what this loop collected, so
       * the loop having collected nothing has to be a failure in its own right
       * rather than a quiet zero.
       */
      expect(
        visited,
        `only ${visited.length} of ${SCREENS.length} screens were reached at ${size.width} px, so the measurements below cover less than they claim`,
      ).toHaveLength(SCREENS.length);

      expect(
        overflows,
        `the document scrolls sideways on these screens at ${size.width} px. A table may scroll inside its own container; the page may not.\n  ${overflows.join("\n  ")}`,
      ).toEqual([]);

      expect(
        unnamed,
        `these controls announce as nothing to a screen reader at ${size.width} px:\n  ${unnamed.join("\n  ")}`,
      ).toEqual([]);
    });
  }
});
