/**
 * Reaching inside `<ds-lms>`, without changing what `<ds-lms>` is (P68-02).
 *
 * ## The problem, stated exactly
 *
 * The learner widget attaches its shadow root with `mode: "closed"`,
 * deliberately: it renders inside a customer's WordPress page and must not be
 * reachable by that page's scripts or styles. Playwright's selector engine
 * pierces open roots and cannot pierce closed ones, so every learner screen —
 * the catalogue, the player, the quiz, the Zertifizierung, the certificate
 * button — is invisible to a browser test.
 *
 * That is why `learner.spec.ts` asserts on the *seam* (the element's attributes
 * and the requests it makes) and stops there, and it is a large part of why no
 * suite has ever watched a video to completion. The client's question on
 * 12.08 — *"why aren't you testing these basic functionalities?"* — has this as
 * one of its two structural answers.
 *
 * ## Why the root is opened for the harness, and why that is not a weakening
 *
 * This installs a page init script that makes `attachShadow` open. Three things
 * make that the right trade rather than the usual "relax the product to make
 * the test pass":
 *
 * 1. **The product is not changed.** `element.ts` still says `mode: "closed"`,
 *    the shipped bundle is byte-identical, and every deployed page gets a
 *    closed root. What changes is the browser this suite drives, before any
 *    page script runs — the same class of thing as opening a debugger.
 *
 * 2. **The property it would otherwise hide is asserted separately.**
 *    `learner.spec.ts` has a test that loads the portal with **no** init script
 *    and requires `element.shadowRoot === null`. If somebody changes the widget
 *    to an open root, that test fails — so this helper cannot be the reason a
 *    regression goes unnoticed. Without that assertion this file would be
 *    exactly the §9.1 failure it exists to fix.
 *
 * 3. **The alternative is worse.** The other way in is `page.evaluate` against
 *    a captured root, which can read text but cannot click a button, type an
 *    answer or press play with real trusted events. A journey driven by
 *    synthetic events is a journey that does not test the player.
 *
 * ## Call it before `goto`
 *
 * `addInitScript` applies to documents created *after* the call. Installing it
 * on a page that has already navigated does nothing at all, silently — so
 * `openWidgetShadowRoots` is called in a fixture, not mid-test.
 */

import type { Page } from "@playwright/test";

export async function openWidgetShadowRoots(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const attach = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (
      this: Element,
      init: ShadowRootInit,
    ): ShadowRoot {
      return attach.call(this, { ...init, mode: "open" });
    };
  });
}
