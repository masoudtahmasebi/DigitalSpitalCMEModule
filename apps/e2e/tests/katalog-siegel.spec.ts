/**
 * The CME seal is inside the hero, not half outside it (P91-01).
 *
 * ## Why this is a browser test and could not be anything else
 *
 * The seal arrived clipped into the hero's top-right corner, about a third of
 * it visible. Nothing in the markup said so: the classes read as "cover the
 * hero, centre the seal on its right edge", which is what the drawing shows.
 * What actually happened needed the layout engine to say it —
 * `sm:inset-0 sm:bottom-auto sm:left-auto` shrink-wraps the positioning box, so
 * the `h-full` inside it measured the seal instead of the hero.
 *
 * A component test in jsdom cannot find this: jsdom does no layout and every
 * `getBoundingClientRect` is zero. A screenshot comparison would find it and
 * would also go red for every deliberate change to the hero. So the assertion
 * is the property itself — **the seal is not clipped** — which is stable across
 * restyling and false only when something is genuinely cut off.
 *
 * ## The class, not the instance (§9.11)
 *
 * The rule this encodes is "an element positioned into a container that clips".
 * The seal is the one the client saw; the same shape would catch the next one,
 * which is why the clipper is *found* rather than named — whichever ancestor
 * hides its overflow is the one that has to contain the seal.
 */

import { expect, test } from "@playwright/test";
import { openWidgetShadowRoots } from "../support/shadow.js";
import {
  forgetSignInAttempts,
  PARTICIPANT_EMAIL,
  PARTICIPANT_PASSWORD,
  TENANT,
} from "../support/world.js";

interface Boxes {
  readonly problem?: string;
  readonly seal?: { top: number; right: number; bottom: number; left: number };
  readonly clip?: { top: number; right: number; bottom: number; left: number };
}

test.describe("das CME-Siegel im Katalog-Kopf", () => {
  test("liegt vollständig innerhalb des Kopfbereichs", async ({ page }) => {
    // Wide enough for the `sm` arrangement, which is the one that was broken;
    // the narrow anchor puts the seal inside the photograph and was correct.
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

    const boxes = await page.evaluate<Boxes>(() => {
      const host = document.querySelector("ds-lms");
      const root = host?.shadowRoot;
      if (root === null || root === undefined) return { problem: "no shadow root" };

      const seal = root.querySelector("svg[role='img']");
      if (seal === null) return { problem: "no seal in the hero" };

      // Whichever ancestor hides its overflow is the one that decides whether
      // the seal is visible. Found rather than named, so a restyled hero does
      // not silently stop being checked.
      let clipper: Element | null = seal.parentElement;
      while (clipper !== null && getComputedStyle(clipper).overflow === "visible") {
        clipper = clipper.parentElement;
      }
      if (clipper === null) return { problem: "nothing clips the seal" };

      const box = (element: Element) => {
        const rect = element.getBoundingClientRect();
        return {
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          left: rect.left,
        };
      };
      return { seal: box(seal), clip: box(clipper) };
    });

    expect(boxes.problem, "the catalogue hero no longer draws a seal").toBeUndefined();
    const { seal, clip } = boxes;
    if (seal === undefined || clip === undefined) throw new Error("no boxes");

    // A pixel of tolerance: sub-pixel layout is not a clipped seal.
    const outside = {
      left: clip.left - seal.left,
      right: seal.right - clip.right,
      top: clip.top - seal.top,
      bottom: seal.bottom - clip.bottom,
    };
    expect(
      Math.max(outside.left, outside.right, outside.top, outside.bottom),
      `the CME seal is cut off by the hero — overhang in px: ${JSON.stringify(outside)}`,
    ).toBeLessThanOrEqual(1);
  });
});
