/**
 * The console's table rows, measured (P224-03).
 *
 * ## Why this is a browser test and not a unit test
 *
 * Everything P224 changed is visual, and a visual change has the same problem
 * every §9.1 entry describes: the existing 348 admin tests pass identically
 * before and after it, so nothing in the repository would notice it being
 * reverted. A component test could assert that `whitespace-nowrap` is in a
 * class string, which is a test about Tailwind rather than about what an
 * operator sees (§9.7) — and it would stay green if the cell were given a width
 * that made it wrap anyway.
 *
 * jsdom has no layout. A browser is the only thing that can answer "is this
 * cell one line or two", and one is already here.
 *
 * ## What is asserted, and what deliberately is not
 *
 * The count column — *"0 von 0 abgeschlossen"* — must be **one line**. It wrapped
 * after the numbers, which made a row carrying it two lines tall while its
 * neighbours were one: the jagged-list defect the client reported as DEP-42 on
 * the learner's catalogue, in the console.
 *
 * Rows being *equal* to each other is the property somebody would reach for
 * first, and it is **not** asserted, because the rig's two courses wrap
 * identically — so on this fixture that comparison is two equal numbers before
 * the fix as well as after, and a check that cannot go red is not evidence.
 * Measuring the cell against its own line height can go red, and does.
 */

import { expect, test } from "@playwright/test";
import { menu, signInToConsole } from "../support/console.js";
import { CUSTOMER_ADMIN_EMAIL, STAFF_PASSWORD } from "../support/world.js";

test.describe("Verwaltung, gemessen", () => {
  test("die Zeilen der Fortbildungsliste bleiben einzeilig", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await signInToConsole(page, {
      email: CUSTOMER_ADMIN_EMAIL,
      password: STAFF_PASSWORD,
    });

    await menu(page).getByRole("button", { name: "Fortbildungen" }).click();

    const counts = page.getByText(/^\d+ von \d+ abgeschlossen$/u);
    await expect(
      counts.first(),
      "the courses table drew no completion count, so the measurement below proves nothing",
    ).toBeVisible({ timeout: 20_000 });

    const lines = await counts.evaluateAll((cells) =>
      cells.map((cell) => {
        /*
         * The **text's** own box, via a Range — not the cell's.
         *
         * The first version measured `cell.getBoundingClientRect()` and
         * reported 65 px against a 20 px line, i.e. "this wrapped", on a cell
         * that does not wrap. A `<td>` stretches to the tallest cell in its
         * row, and the title column wraps a long German course name to two
         * lines, so the count cell's box says nothing at all about the count.
         *
         * A measurement of the wrong box is a check that goes red for a reason
         * unrelated to what it claims — which is the same class as deploy 131,
         * from the other side.
         */
        const range = document.createRange();
        range.selectNodeContents(cell);
        const box = range.getBoundingClientRect();
        const style = window.getComputedStyle(cell);
        const lineHeight =
          style.lineHeight === "normal"
            ? Number.parseFloat(style.fontSize) * 1.2
            : Number.parseFloat(style.lineHeight);
        return { height: box.height, lineHeight };
      }),
    );

    expect(lines.length).toBeGreaterThan(0);
    for (const { height, lineHeight } of lines) {
      expect(
        height,
        `a completion count wrapped: the cell is ${height.toFixed(1)} px tall ` +
          `against a ${lineHeight.toFixed(1)} px line, so it is on two lines and ` +
          `its row is taller than its neighbours`,
      ).toBeLessThan(lineHeight * 1.6);
    }
  });
});
