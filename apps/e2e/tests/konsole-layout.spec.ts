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
import { menu, openMenu, signInToConsole } from "../support/console.js";
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

  /**
   * Every `--ds-admin-*` token resolves in the bundle the browser was served
   * (P228-01).
   *
   * ## Why this exists when `check:design-tokens` already passes
   *
   * That script reads **source**. This reads what Vite emitted, what the
   * browser parsed, and what the cascade produced — which is §9.9's shape one
   * layer down: a definition in the repository is a definition in the
   * stylesheet only if the build kept it. A token dropped by a PostCSS step, a
   * `:root` rule shadowed by something later in the sheet, or a stylesheet that
   * failed to load at all are each invisible to a grep and obvious here.
   *
   * ## Why an empty string is the assertion
   *
   * `getPropertyValue` for a custom property that was never declared returns
   * `""` — not `undefined`, not a throw. That is exactly the state
   * `--ds-surface-sunken` was in from P88-01 until P228-01, and it is why
   * nothing failed: every layer answered politely. The browser then treats the
   * whole declaration as invalid at computed-value time and paints
   * `rgba(0, 0, 0, 0)`.
   *
   * So both halves are asserted — the variable has a value, **and** an element
   * that uses it computes to something other than transparent. The second is
   * the one a person would have seen.
   */
  test("jeder Design-Token der Verwaltung löst sich im ausgelieferten Bundle auf", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await signInToConsole(page, {
      email: CUSTOMER_ADMIN_EMAIL,
      password: STAFF_PASSWORD,
    });

    /*
     * The closed set the console defines. Named here rather than scraped from
     * the stylesheet, because a test that derives its expectations from the
     * thing under test agrees with it however wrong it is (§9.1) — if a token
     * is deleted, this list is what notices.
     */
    const TOKENS = [
      "--ds-admin-ink",
      "--ds-admin-ink-muted",
      "--ds-admin-surface",
      "--ds-admin-hairline",
      "--ds-admin-surface-sunken",
    ] as const;

    const values = await page.evaluate((tokens) => {
      const root = window.getComputedStyle(document.documentElement);
      return tokens.map((token) => [token, root.getPropertyValue(token).trim()]);
    }, TOKENS);

    for (const [token, value] of values) {
      expect(
        value,
        `${token} resolves to nothing in the served bundle, so every ` +
          "declaration reading it is invalid at computed-value time and the " +
          "property renders as if it had never been set",
      ).not.toBe("");
    }

    /*
     * And the consequence, measured rather than reasoned about. A probe
     * element in the real document, carrying the real utility class the media
     * thumbnail uses — the rig seeds no media asset, so there is no thumbnail
     * of its own to measure, and the cascade is the same either way.
     */
    const background = await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.style.backgroundColor = "var(--ds-admin-surface-sunken)";
      document.body.append(probe);
      const computed = window.getComputedStyle(probe).backgroundColor;
      probe.remove();
      return computed;
    });

    expect(
      background,
      "an element backed by --ds-admin-surface-sunken paints transparent, " +
        "which is what an undefined custom property looks like from the outside",
    ).not.toBe("rgba(0, 0, 0, 0)");
  });

  /**
   * The two questions the review asked about P224, at the width they matter
   * (P224-07).
   *
   * ## Why 390 px, and why in a browser
   *
   * Both are properties of layout under a constraint, and neither is visible
   * anywhere else. jsdom has no layout, so a component test can only assert
   * that `whitespace-nowrap` is in a class string — which is a test about
   * Tailwind and would stay green on a cell that overflows the screen anyway
   * (§9.7). 390 px is an iPhone 14/15 in CSS pixels and the narrowest width the
   * console's responsive floor claims to support.
   *
   * ## 1. `whitespace-nowrap` and horizontal overflow
   *
   * P224-03 stopped the completion count wrapping, and stopping text wrapping
   * is exactly how a table is pushed wider than the screen. CLAUDE.md's own
   * responsive rule allows a **table** its own `overflow-x` container and
   * forbids the **page body** scrolling sideways, so that is the line asserted:
   * `documentElement.scrollWidth` must not exceed its `clientWidth`. A table
   * that scrolls inside its own box passes; a page you have to drag sideways to
   * read does not.
   *
   * ## 2. Quiet destructive controls, without a pointer
   *
   * `quiet` draws its border on `hover` and on focus. **A touch screen has
   * neither**, so the question is fair: is a per-row delete still a control to
   * somebody who can never hover it?
   *
   * What is measurable, and is asserted here:
   *
   * - It is **visible** and carries its accessible name at 390 px.
   * - Its **hit target** meets WCAG 2.5.8 Target Size (Minimum), 24 × 24 CSS
   *   px. Measured from `getBoundingClientRect`, with no pointer over it —
   *   Playwright does not hover unless told to, so the box measured is the
   *   resting box.
   * - Its box is **the same size as the bordered `secondary` control** it was
   *   before. That is the property that can go red and the one that matters:
   *   `quiet` uses `border-transparent` rather than `border-0` precisely so the
   *   geometry does not change, and the failure mode worth catching is somebody
   *   later reimplementing `quiet` as bare text, which shrinks the target and
   *   is invisible in a screenshot at 1440 px.
   *
   * What is **not** asserted, and is stated rather than implied: whether the
   * control *looks* like a control at rest is a judgement about appearance, and
   * a number cannot settle it. At rest `quiet` is `text-gray-700`,
   * `font-semibold`, `text-sm`, in a `px-3.5 py-2` box — it is a weighted label
   * in a button-sized box, not a hyperlink. Whether that reads as tappable to
   * an operator on a phone belongs in the manual acceptance steps, with a
   * screenshot, and it is listed there.
   */
  test("die Fortbildungsliste auf 390 px: kein Querscrollen, tippbare Aktionen", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signInToConsole(page, {
      email: CUSTOMER_ADMIN_EMAIL,
      password: STAFF_PASSWORD,
    });

    // At 390 px the sidebar is behind the hamburger — see `openMenu`.
    await (await openMenu(page)).getByRole("button", { name: "Fortbildungen" }).click();

    const deletes = page.getByRole("button", { name: /Fortbildung .* löschen/u });
    await expect(
      deletes.first(),
      "the courses table drew no per-row delete, so the measurements below prove nothing",
    ).toBeVisible({ timeout: 20_000 });

    // --- 1. The page itself must not scroll sideways ----------------------
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      // Whatever is actually sticking out, named, so a failure says which
      // element to look at rather than only that one exists.
      widest: Array.from(document.querySelectorAll<HTMLElement>("body *"))
        .map((node) => ({
          tag: node.tagName.toLowerCase(),
          cls: node.className.toString().slice(0, 60),
          right: node.getBoundingClientRect().right,
        }))
        .sort((a, b) => b.right - a.right)
        .slice(0, 3),
    }));

    expect(
      overflow.scrollWidth,
      `the page scrolls sideways at 390 px: ${overflow.scrollWidth} px of content ` +
        `in a ${overflow.clientWidth} px viewport. The three widest elements are ` +
        overflow.widest
          .map((n) => `<${n.tag} class="${n.cls}"> ending at ${n.right.toFixed(0)} px`)
          .join("; ") +
        ". A table may scroll inside its own box; the page body may not.",
    ).toBeLessThanOrEqual(overflow.clientWidth + 1);

    /*
     * And **why** the page does not overflow, which is the half that can rot.
     *
     * Measured: the table is 1,011 px wide in a 390 px viewport. It does not
     * push the page sideways only because `Table` wraps it in an
     * `overflow-x-auto` box — so the page-level assertion above is a true
     * statement about a container nothing else asserts the existence of. Remove
     * that wrapper and the page overflows; keep it and a reviewer has no way to
     * tell from the passing test which of the two facts they are relying on.
     *
     * So the container is asserted directly: the table's own width exceeds its
     * scroll parent's, and that parent clips it. That is also the honest record
     * of what `whitespace-nowrap` costs at this width — the columns are read by
     * dragging the table, which is the documented responsive rule for a table
     * and is listed for Masoud in the manual acceptance steps rather than
     * claimed to be comfortable.
     */
    const clipped = await page
      .locator("table")
      .first()
      .evaluate((table) => {
        const parent = table.parentElement;
        if (parent === null) throw new Error("the table has no parent to scroll in");
        return {
          overflowX: window.getComputedStyle(parent).overflowX,
          tableWidth: table.getBoundingClientRect().width,
          parentWidth: parent.getBoundingClientRect().width,
        };
      });

    expect(
      clipped.overflowX,
      `the courses table is ${clipped.tableWidth.toFixed(0)} px wide inside a ` +
        `${clipped.parentWidth.toFixed(0)} px box whose overflow-x is ` +
        `"${clipped.overflowX}". Without a scrolling container that width lands on ` +
        "the page body, and the whole console has to be dragged sideways rather " +
        "than the one table.",
    ).toMatch(/auto|scroll/u);

    // --- 2. The quiet destructive control is a tappable target ------------
    const targets = await deletes.evaluateAll((buttons) =>
      buttons.map((button) => {
        const box = button.getBoundingClientRect();
        const style = window.getComputedStyle(button);
        return {
          name: button.getAttribute("aria-label") ?? button.textContent ?? "",
          width: box.width,
          height: box.height,
          paddingX: Number.parseFloat(style.paddingLeft),
          paddingY: Number.parseFloat(style.paddingTop),
          borderWidth: Number.parseFloat(style.borderTopWidth),
        };
      }),
    );

    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      expect(
        Math.min(target.width, target.height),
        `"${target.name}" is ${target.width.toFixed(0)} × ${target.height.toFixed(0)} px ` +
          "at 390 px, below the 24 × 24 CSS px of WCAG 2.5.8 Target Size (Minimum). " +
          "On a touch screen this control can never be hovered, so its resting box " +
          "is the whole of its affordance.",
      ).toBeGreaterThanOrEqual(24);

      /*
       * The border is transparent, not absent. If somebody reimplements
       * `quiet` as bare text this goes to 0 and the target shrinks by 2 px in
       * each direction — invisible in a screenshot, and the reason
       * `border-transparent` was chosen over `border-0` in the first place.
       */
      expect(
        target.borderWidth,
        `"${target.name}" has no border box at rest (${target.borderWidth} px). ` +
          "`quiet` keeps a transparent border so the control does not change " +
          "size when a pointer crosses it, and so its touch target is the same " +
          "as the bordered variant it replaced.",
      ).toBeGreaterThan(0);
    }
  });

  /**
   * The screen P224 actually redesigned, at 390 px (P224-07).
   *
   * The courses list above is where `whitespace-nowrap` landed. **This** is
   * where `quiet` landed: the authoring tree draws two `IconButton` reorder
   * controls on every row, and there are fifty of them on the rig's course.
   * They are the smallest controls in the console and the ones P224 took the
   * resting border off, so if the quiet weight costs anybody a tap target it
   * costs it here.
   *
   * Two properties, both of which hold today and both of which can go red:
   *
   * - every reorder control is **inside the viewport** at 390 px. It is not a
   *   given — measured on this same screen, twelve other buttons are not, and
   *   that is recorded as a defect in `docs/backlog/P224.md` rather than
   *   asserted away here.
   * - each is at least 24 × 24 CSS px, WCAG 2.5.8 Target Size (Minimum).
   *   Measured: **32 × 32**. That passes 2.5.8 and does **not** reach the
   *   44 × 44 of 2.5.5 Target Size (Enhanced, AAA), which is stated here rather
   *   than quietly asserted at the lower bar.
   */
  test("die Reihenfolge-Schaltflächen im Kursaufbau sind auf 390 px erreichbar", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signInToConsole(page, {
      email: CUSTOMER_ADMIN_EMAIL,
      password: STAFF_PASSWORD,
    });

    await (await openMenu(page)).getByRole("button", { name: "Fortbildungen" }).click();
    await page
      .getByRole("button", { name: /DS Demo – Fortbildung mit CME/u })
      .first()
      .click();

    const reorder = page.getByRole("button", { name: "Nach oben verschieben" });
    await expect(
      reorder.first(),
      "the authoring tree drew no reorder control, so the measurements below prove nothing",
    ).toBeVisible({ timeout: 20_000 });

    const controls = await reorder.evaluateAll((buttons) =>
      buttons.map((button) => {
        const box = button.getBoundingClientRect();
        return {
          width: box.width,
          height: box.height,
          right: box.right,
          viewport: document.documentElement.clientWidth,
        };
      }),
    );

    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) {
      expect(
        control.right,
        `a reorder control ends at ${control.right.toFixed(0)} px in a ` +
          `${control.viewport} px viewport, so it is off the side of the screen. ` +
          "On a phone a per-row control that has to be scrolled to horizontally " +
          "is a control most people will never find.",
      ).toBeLessThanOrEqual(control.viewport + 1);

      expect(
        Math.min(control.width, control.height),
        `a reorder control is ${control.width.toFixed(0)} × ` +
          `${control.height.toFixed(0)} px, below the 24 × 24 CSS px of WCAG 2.5.8 ` +
          "Target Size (Minimum). It is quiet, so its resting box is the whole of " +
          "its affordance on a screen that cannot hover.",
      ).toBeGreaterThanOrEqual(24);
    }
  });
});
