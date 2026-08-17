/**
 * The catalogue pager the two journeys depend on (P89-03).
 *
 * ## Why this is a test of a helper, which is unusual here
 *
 * `openCourseFromCatalogue` exists because the post-deploy run of 1c8df78
 * failed on an installation whose test tenant holds more than ten courses. On
 * the local rig that tenant holds one or two, so **the paging branch never
 * executes locally** — it would be written, shipped, and first exercised on the
 * server, which is exactly the position the helper was written to get out of.
 *
 * That is CLAUDE.md §9.1 pointed at the harness rather than at the product: a
 * branch no run can take is not covered by any of them being green. So the
 * multi-page catalogue is built here, in the browser, and walked.
 *
 * ## What it is, and what it deliberately is not
 *
 * The list is synthetic — a `ul` of cards and the pagination controls, built by
 * `setContent`, the same technique `codecs.spec.ts` uses to ask the browser a
 * question without the stack. It asserts the helper's **logic**: that it pages
 * forward, that it opens the card it was asked for and no other, and that it
 * fails with something readable when the course is genuinely absent.
 *
 * It cannot assert that the widget still draws those controls that way. That is
 * `CourseList.test.tsx`'s job — it drives the real component against a paging
 * fake — and the two journeys walk the real markup on page one every run. If
 * the pagination is ever redrawn, the accessible names are the contract between
 * these three, and this header is where to start.
 */

import { expect, test, type Page } from "@playwright/test";
import { openCourseFromCatalogue } from "../support/catalogue.js";

/** `PER_PAGE` in `CourseList.tsx`. */
const PAGE_SIZE = 10;

/**
 * Ten fillers and then the course being looked for — the production shape:
 * „E2E Zwei Module …" sorts after everything else the tenant holds, so it is
 * the first entry on page two.
 */
const WANTED = "E2E Zwei Module abc123";
const TITLES = [
  ...Array.from({ length: PAGE_SIZE }, (_, index) => `E2E Fortbildung ${String(index)}`),
  WANTED,
];

test.describe("der Katalog-Blätterer", () => {
  test("findet die Fortbildung auf Seite zwei", async ({ page }) => {
    await catalogue(page, TITLES);

    await openCourseFromCatalogue(page, WANTED);

    // The helper ends on the detail screen, and on the right one: the fake
    // opens whichever card's button was pressed, so a helper that clicked the
    // first card on page one would fail here rather than silently pass.
    await expect(page.getByRole("heading", { name: WANTED })).toBeVisible();
    await expect(page.getByRole("button", { name: "Seite 2" })).toHaveCount(0);
  });

  test("bleibt auf Seite eins, wenn die Fortbildung dort steht", async ({ page }) => {
    await catalogue(page, TITLES);

    await openCourseFromCatalogue(page, "E2E Fortbildung 3");

    await expect(page.getByRole("heading", { name: "E2E Fortbildung 3" })).toBeVisible();
  });

  test("sagt, was es abgesucht hat, wenn die Fortbildung fehlt", async ({ page }) => {
    await catalogue(page, TITLES);

    /*
     * The message is the point, not the throw. A physician's course going
     * missing has four plausible causes — unpublished, wrong delivery type,
     * expired validity, wrong project — and an assertion that says only
     * "not visible" sends the next person to read the harness instead of the
     * product (§9.4, applied to a failure message).
     */
    await expect(openCourseFromCatalogue(page, "E2E Gibt Es Nicht")).rejects.toThrow(
      /Walked 2 page\(s\)[\s\S]*never published/u,
    );
  });
});

/**
 * A catalogue of `titles`, ten to a page, with the widget's own control names.
 *
 * Everything the helper reaches for is here and nothing else is: cards in `li`
 * elements, a "Zur Fortbildung" button inside each, „Zurück" / „Vor" steps that
 * disable at the ends, and numbered buttons labelled „Seite N" carrying
 * `aria-current="page"`. Pressing a card's button replaces the list with a
 * heading, which is what the helper waits for.
 */
async function catalogue(page: Page, titles: readonly string[]): Promise<void> {
  await page.goto("about:blank");
  await page.setContent(`<!doctype html><meta charset="utf-8"><div id="app"></div>`);

  await page.evaluate(
    ({ titles, pageSize }: { titles: readonly string[]; pageSize: number }) => {
      const mount = document.getElementById("app");
      if (mount === null) throw new Error("no mount point");
      const app = mount;
      const lastPage = Math.max(1, Math.ceil(titles.length / pageSize));

      function step(label: string, disabled: boolean, go: () => void): HTMLButtonElement {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.disabled = disabled;
        button.addEventListener("click", go);
        return button;
      }

      function open(title: string): void {
        app.replaceChildren();
        const heading = document.createElement("h1");
        heading.textContent = title;
        app.append(heading);
      }

      function render(current: number): void {
        app.replaceChildren();

        const list = document.createElement("ul");
        for (const title of titles.slice((current - 1) * pageSize, current * pageSize)) {
          const card = document.createElement("li");
          const name = document.createElement("span");
          name.textContent = title;
          card.append(
            name,
            step("Zur Fortbildung", false, () => {
              open(title);
            }),
          );
          list.append(card);
        }
        app.append(list);

        const nav = document.createElement("nav");
        nav.setAttribute("aria-label", "Seitennavigation");
        nav.append(
          step("Zurück", current <= 1, () => {
            render(current - 1);
          }),
        );
        for (let number = 1; number <= lastPage; number += 1) {
          const at = number;
          const button = step(String(at), false, () => {
            render(at);
          });
          button.setAttribute("aria-label", `Seite ${String(at)}`);
          if (at === current) button.setAttribute("aria-current", "page");
          nav.append(button);
        }
        nav.append(
          step("Vor", current >= lastPage, () => {
            render(current + 1);
          }),
        );
        app.append(nav);
      }

      render(1);
    },
    { titles, pageSize: PAGE_SIZE },
  );
}
