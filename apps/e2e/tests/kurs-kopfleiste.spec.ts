/**
 * The course page's masthead: no strip above it, and its two controls together
 * (DEP-45, DEP-46).
 *
 * ## Why a browser, and why these two in one file
 *
 * They arrived as two tickets and they were one defect. The portal drew a
 * standalone **Zurück** button in a `space-y-4` band above the widget, so the
 * page had 78 px of background between the header's rule and the top of the
 * teal hero — DEP-45 — and the control for leaving a course sat diagonally
 * opposite the control for continuing it — DEP-46. Deleting the band fixes
 * both, and only if the widget grows a back control of its own to replace it.
 *
 * Nothing below the browser can see either property. The band is three margins
 * in two packages and jsdom measures all of them as zero; whether two buttons
 * are in one group is a layout fact, not a markup one. The wiring that puts
 * the widget's control on the screen at all crosses a package boundary as an
 * attribute and a CustomEvent, and each side's own tests pass with the other
 * side deleted (§9.7) — `WidgetMount.test.tsx` and `element.test.ts` say so in
 * their own headers. This is the test that fails if the two are not connected.
 *
 * ## The numbers are properties, not pixels
 *
 * `band <= 1` rather than a screenshot: a screenshot goes red for every
 * deliberate change to the hero, and the thing the client reported is "there is
 * a strip", which is a distance. Same for the pair — their vertical centres are
 * compared, not their coordinates, so restyling the strip cannot break this and
 * moving one control out of the group is the only thing that can.
 */

import { expect, test } from "@playwright/test";
import { openWidgetShadowRoots } from "../support/shadow.js";
import {
  COURSE_WITH_POINTS,
  forgetSignInAttempts,
  PARTICIPANT_EMAIL,
  PARTICIPANT_PASSWORD,
  TENANT,
} from "../support/world.js";

/** `de.catalog.back` in `@ds/copy`, which this package cannot import. */
const BACK = "Alle Fortbildungen";

interface Geometry {
  readonly problem?: string;
  /** Page background between the header's lower edge and the widget's top. */
  readonly band?: number;
  /** Vertical distance between the two controls' centres. */
  readonly ctaOffset?: number;
  /** Secondary before primary, reading left to right. */
  readonly backBeforeCta?: boolean;
}

test.describe("die Kopfleiste einer Fortbildung", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openWidgetShadowRoots(page);

    await forgetSignInAttempts();
    await page.goto(`/${TENANT}`);
    await page.getByLabel("E-Mail-Adresse").fill(PARTICIPANT_EMAIL);
    await page.getByLabel("Passwort").fill(PARTICIPANT_PASSWORD);
    await page.getByRole("button", { name: "Anmelden" }).click();
    await expect(page.getByRole("button", { name: "Abmelden" })).toBeVisible({
      timeout: 20_000,
    });

    await page.goto(`/${TENANT}/kurs/${COURSE_WITH_POINTS}`);
    await expect(page.getByRole("button", { name: BACK })).toBeVisible({
      timeout: 20_000,
    });
  });

  test("beginnt unmittelbar unter der Navigation (DEP-45)", async ({ page }) => {
    const geometry = await page.evaluate<Geometry>(() => {
      const header = document.querySelector("header");
      const host = document.querySelector("ds-lms");
      if (header === null || host === null)
        return { problem: "header or widget missing" };

      /*
       * Nothing of the portal's own may sit between them either. The band was
       * a button, and a check that only measured the distance would pass on a
       * page that had put something else there instead.
       */
      const own = Array.from(document.querySelectorAll("main button")).map((node) =>
        (node.textContent ?? "").trim(),
      );
      if (own.length > 0) return { problem: `portal drew its own control: ${own[0]}` };

      return {
        band: host.getBoundingClientRect().top - header.getBoundingClientRect().bottom,
      };
    });

    expect(geometry.problem, "could not measure the masthead").toBeUndefined();
    // One pixel of slack for sub-pixel rounding; the defect was 78.
    expect(geometry.band!, "a strip of page sits above the hero").toBeLessThanOrEqual(1);
  });

  test("trägt Zurück und Fortsetzen in einer Gruppe (DEP-46)", async ({ page }) => {
    const geometry = await page.evaluate<Geometry, string>((label) => {
      const root = document.querySelector("ds-lms")?.shadowRoot;
      if (root === null || root === undefined) return { problem: "no shadow root" };

      const buttons = Array.from(root.querySelectorAll("button"));
      const back = buttons.find((node) => (node.textContent ?? "").includes(label));
      if (back === undefined) return { problem: "no back control in the widget" };

      /*
       * The CTA is found as `back`'s **sibling**, not by its label. That is the
       * property DEP-46 asks for — one group — and it is what a check by label
       * would miss: the same two words appear on the progress card further down
       * the page, so a locator could pair the back control with a button 600 px
       * away and call it a group. The label also depends on whether this
       * participant has started the course, which earlier suites decide.
       */
      const group = back.parentElement;
      const cta = Array.from(group?.querySelectorAll("button") ?? []).find(
        (node) => node !== back,
      );
      if (cta === undefined) return { problem: "the back control has no companion" };

      const b = back.getBoundingClientRect();
      const c = cta.getBoundingClientRect();
      if (!/Fortbildung (starten|fortsetzen)/u.test(cta.textContent ?? "")) {
        return { problem: `the companion is not the CTA: ${cta.textContent}` };
      }
      return {
        ctaOffset: Math.abs(b.top + b.height / 2 - (c.top + c.height / 2)),
        backBeforeCta: b.left < c.left,
      };
    }, BACK);

    expect(geometry.problem, "could not measure the pair").toBeUndefined();
    // One row of the meta strip. Before DEP-46 the back control was the
    // portal's, in the band above the hero, and the CTA was the widget's,
    // inside the strip — top-left against mid-right, on opposite sides of a
    // shadow boundary. Nothing below a browser could compare the two.
    expect(
      geometry.ctaOffset!,
      "the two controls are not on one row",
    ).toBeLessThanOrEqual(8);
    expect(geometry.backBeforeCta, "back should read before the CTA").toBe(true);
  });

  test("führt über diese Schaltfläche zurück in den Katalog (DEP-46)", async ({
    page,
  }) => {
    /*
     * The event half of the contract, end to end: the widget draws the control
     * because the portal set `back-to-catalogue`, dispatches
     * `ds-lms:course-back` out of a closed shadow root, and the portal turns
     * that into a URL. Any one of the three missing and this is the only test
     * in the repository that notices.
     */
    await page.getByRole("button", { name: BACK }).click();

    await expect(page).toHaveURL(new RegExp(`/${TENANT}/?$`, "u"));
    await expect(page.getByRole("button", { name: BACK })).toHaveCount(0);
  });
});
