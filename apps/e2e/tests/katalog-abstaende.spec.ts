/**
 * The catalogue on a phone: no empty band above, and room below (P255-01).
 *
 * ## What the client saw
 *
 * At 390 px the catalogue opened on a **440 px** block of plain teal with the
 * CME seal in its bottom-left corner, and ended with the "Weitere" button
 * standing on the host theme's footer with nothing between them — "the spacing
 * is too much on top, and too little in the bottom of the page".
 *
 * Both are distances between boxes, which is why this is a browser test: jsdom
 * lays out nothing and every rectangle in it is zero.
 *
 * ## Why each half is stated the way it is
 *
 * **Top.** The band is `h-[27.5rem]` because the mobile export draws a
 * photograph that tall (P19-01). The e2e tenant has no photograph — the
 * client's installation did not either — and without one the band carries only
 * the seal, so the assertion is about *empty teal above the seal*, not about a
 * height. A band with a photograph is still drawn as tall as the layout says.
 *
 * **Bottom.** Asserted against the `<ds-lms>` host's own lower edge rather than
 * against whatever the page puts after it: the widget cannot see the footer of a
 * WordPress theme, and the space it owes is the space inside its own box.
 */

import { expect, test } from "@playwright/test";
import { openWidgetShadowRoots } from "../support/shadow.js";
import {
  forgetSignInAttempts,
  PARTICIPANT_EMAIL,
  PARTICIPANT_PASSWORD,
  TENANT,
} from "../support/world.js";

interface Measured {
  readonly problem?: string;
  readonly photograph?: string;
  readonly emptyAboveSeal?: number;
  readonly belowLastButton?: number;
}

test.describe("die Abstände des Katalogs auf dem Telefon", () => {
  test("kein leerer Streifen oben, Luft unter „Weitere“", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openWidgetShadowRoots(page);

    await forgetSignInAttempts();
    await page.goto(`/${TENANT}`);
    await page.getByLabel("E-Mail-Adresse").fill(PARTICIPANT_EMAIL);
    await page.getByLabel("Passwort").fill(PARTICIPANT_PASSWORD);
    await page.getByRole("button", { name: "Anmelden" }).click();
    await expect(page.getByRole("tab", { name: "Weitere" })).toBeVisible({
      timeout: 20_000,
    });

    const measured = await page.evaluate<Measured>(() => {
      const host = document.querySelector("ds-lms");
      const root = host?.shadowRoot;
      if (host === null || root === null || root === undefined) {
        return { problem: "no shadow root" };
      }

      const seal = root.querySelector("svg[role='img']");
      if (seal === null) return { problem: "no seal in the hero" };

      // The band is the nearest ancestor that paints a background: the teal
      // block whose empty top the client saw.
      let band: Element | null = seal.parentElement;
      while (
        band !== null &&
        getComputedStyle(band).backgroundColor === "rgba(0, 0, 0, 0)"
      ) {
        band = band.parentElement;
      }
      if (band === null)
        return { problem: "nothing behind the seal paints a background" };

      const tablist = root.querySelector("[role='tablist']");
      const buttons =
        tablist === null ? [] : Array.from(tablist.querySelectorAll("button"));
      const visible = buttons.filter(
        (button) => button.getBoundingClientRect().height > 0,
      );
      const last = visible.at(-1);
      if (last === undefined) return { problem: "no visible tab button under the panel" };

      return {
        photograph: getComputedStyle(band).backgroundImage,
        emptyAboveSeal:
          seal.getBoundingClientRect().top - band.getBoundingClientRect().top,
        belowLastButton:
          host.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom,
      };
    });

    expect(measured.problem).toBeUndefined();
    // The precondition, stated: this case is the band without a photograph.
    expect(measured.photograph).toBe("none");
    // The seal's own `bottom-10` is 40 px; the same above it, and no more.
    expect(measured.emptyAboveSeal).toBeLessThanOrEqual(48);
    expect(measured.belowLastButton).toBeGreaterThanOrEqual(32);
  });
});
