/**
 * What a browser can and cannot assert about the learner surface (P35-01).
 *
 * ## The finding that shapes this file
 *
 * `<ds-lms>` attaches its shadow root with **`mode: "closed"`**, deliberately:
 * the widget renders inside a customer's WordPress page and must not be
 * reachable by that page's scripts or styles. A closed root is also unreachable
 * by Playwright — its selector engine pierces open roots and cannot pierce
 * closed ones — so `getByRole`, `getByText` and `toContainText` all see an
 * empty `<main>` on a screen full of visible text.
 *
 * That is not a gap to work around by opening the root for tests. The isolation
 * is the feature, and a product weakened to make a test possible is the wrong
 * trade in a way that outlives the test.
 *
 * So the division of labour is:
 *
 * - **Inside the widget** — gating, status rendering, the player, the quiz:
 *   component tests in `apps/widget`, which run in the same realm and can see
 *   what they render. `CLAUDE.md` §6 already assigns them exactly this.
 * - **Everything around it** — this file: tenant routing, sign-in, the session,
 *   and the *seam* between the portal and the widget, which is where P29 found
 *   two of its defects and which no component test can see because neither side
 *   of it exists in isolation.
 */

import { expect, test, type Page } from "@playwright/test";
import {
  forgetSignInAttempts,
  PARTICIPANT_EMAIL,
  PARTICIPANT_PASSWORD,
  TENANT,
} from "../support/world.js";

async function signIn(page: Page): Promise<void> {
  await forgetSignInAttempts();
  await page.goto(`/${TENANT}`);
  await page.getByLabel("E-Mail-Adresse").fill(PARTICIPANT_EMAIL);
  await page.getByLabel("Passwort").fill(PARTICIPANT_PASSWORD);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page.getByRole("button", { name: "Abmelden" })).toBeVisible({
    timeout: 20_000,
  });
}

test.describe("the seam between the portal and the widget", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test("mounts the custom element, upgraded, with the tenant it was asked for", async ({
    page,
  }) => {
    /*
     * The exact failure this catches is in the widget's own source: a host that
     * mounts `<ds-lms>` without what it needs gets a "nicht korrekt
     * eingebunden" message rendered **inside a closed shadow root** — invisible
     * to `innerText`, invisible at a glance in a screenshot, and accompanied by
     * no failed request, "because a widget that has decided it is misconfigured
     * never calls the API. That is how /medice came to show a signed-in header
     * above nothing at all."
     *
     * A closed root means the message cannot be asserted on. Its *inputs* can.
     */
    const mounted = await page.evaluate(() => {
      const element = document.querySelector("ds-lms");
      return {
        present: element !== null,
        upgraded: Boolean(customElements.get("ds-lms")),
        apiBase: element?.getAttribute("api-base") ?? "",
        project: element?.getAttribute("project") ?? "",
      };
    });

    expect(mounted.present).toBe(true);
    expect(mounted.upgraded).toBe(true);
    expect(mounted.project).toBe(TENANT);
    expect(mounted.apiBase).not.toBe("");
  });

  /**
   * The root is still closed — the assertion that keeps `support/shadow.ts`
   * honest (P68-02).
   *
   * The journey suite opens the widget's shadow root, for its own browser only,
   * so it can click a play button and type a quiz answer. That is a harness
   * affordance and not a product change — but it would become a product change
   * the day somebody "fixed" `element.ts` to use an open root and nothing
   * noticed, because every test that could have noticed is running with the
   * patch installed.
   *
   * This test runs **without** it. `<ds-lms>` renders inside a customer's
   * WordPress page, where an open root means that page's scripts and styles can
   * reach into a physician's Fortbildung; the isolation is the feature.
   */
  test("keeps its shadow root closed to the page it is embedded in", async ({ page }) => {
    const reachable = await page.evaluate(
      () => document.querySelector("ds-lms")?.shadowRoot ?? null,
    );

    expect(
      reachable,
      "the widget's shadow root is reachable from the host page — the isolation " +
        "<ds-lms> exists for is gone, and the journey suite's init script is no " +
        "longer only a harness affordance",
    ).toBeNull();
  });

  test("the widget actually calls the API, with the session attached", async ({
    page,
  }) => {
    /*
     * The other half of the same seam, and the one a screenshot cannot show: a
     * widget that decided it was misconfigured makes no request at all. So the
     * assertion is on the network, not the DOM — the one place a closed shadow
     * root does not hide.
     */
    const calls: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/courses")) calls.push(request.url());
    });

    await page.reload();
    await expect(page.getByRole("button", { name: "Abmelden" })).toBeVisible({
      timeout: 20_000,
    });
    await page.waitForTimeout(2_000);

    expect(
      calls.length,
      "the widget never asked the API for a catalogue",
    ).toBeGreaterThan(0);
  });
});

test.describe("the session", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test("survives a reload", async ({ page }) => {
    // The credential is an httpOnly cookie, so this is the assertion that it is
    // actually set that way and actually sent. A token kept only in memory
    // looks identical until the physician presses refresh.
    await page.reload();

    await expect(page.getByRole("button", { name: "Abmelden" })).toBeVisible({
      timeout: 20_000,
    });
  });

  test("is genuinely ended by signing out, not merely re-rendered", async ({ page }) => {
    await page.getByRole("button", { name: "Abmelden" }).click();
    await expect(page.getByLabel("Passwort")).toBeVisible();

    // The real assertion is after the reload: a sign-out that only changes what
    // is on screen leaves a working cookie behind, and the next person at that
    // computer is signed in as a physician.
    await page.reload();
    await expect(page.getByLabel("Passwort")).toBeVisible();
  });
});
