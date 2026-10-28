/**
 * The channel MEDICE's physicians actually use (P92-01).
 *
 * Everything else in this suite drives `apps/portal`: a cookie, the `local`
 * identity plane, one origin. The WordPress embed is none of those — a bearer
 * token from MEDICE's Keycloak, presented cross-origin from their own site —
 * and until this file nothing drove it in a browser. That is CLAUDE.md §9.13
 * exactly: the tests call one channel and the customer uses the other.
 *
 * See `support/wordpress.ts` for what the rig reproduces and what it does not.
 */

import { expect, test, type Page } from "@playwright/test";
import type { ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openWidgetShadowRoots } from "../support/shadow.js";
import { API_BASE } from "../support/stack.js";
import { storedProfile } from "../support/world.js";
import {
  mintKeycloakToken,
  startKeycloak,
  startWordPress,
  WP_PROJECT_SLUG,
  type WordPressSite,
} from "../support/wordpress.js";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));

/** What the widget renders inside its closed root, as text. */
async function widgetText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const root = document.querySelector("ds-lms")?.shadowRoot;
    return root === null || root === undefined
      ? "(no shadow root)"
      : (root.textContent ?? "");
  });
}

test.describe("die WordPress-Einbindung", () => {
  /*
   * One stub for the whole group (P257-01).
   *
   * `dev-keycloak` generates a fresh signing key on every start under a fixed
   * `kid`, and the API caches the JWKS it fetched first. So a second start in
   * the same run signs with a key the API has never seen and every token is
   * 401 — which is why exactly one test here could ever hold a token, and why
   * the next one to try failed as "Ihre Sitzung ist abgelaufen".
   */
  let keycloak: ChildProcess | undefined;
  test.beforeAll(async () => {
    keycloak = await startKeycloak(REPO);
  });
  test.afterAll(() => {
    keycloak?.kill();
  });

  test.setTimeout(180_000);

  test("mountet, holt sich einen Token und zeigt den Katalog", async ({ browser }) => {
    /*
     * The whole embedded path in one browser: WordPress mints a token from its
     * own session, the element upgrades, and a physician the platform has never
     * seen reaches a catalogue — provisioned on the way through (P94-03).
     */
    let site: WordPressSite | undefined;

    try {
      const token = await mintKeycloakToken("wp-physician@medice.example");
      site = await startWordPress({ repo: REPO, apiBase: API_BASE, token });

      const context = await browser.newContext();
      const page = await context.newPage();
      await openWidgetShadowRoots(page);

      /*
       * Everything the browser refused, kept. A CORS failure is a console
       * message and *no* server-side trace at all — the exact class of defect
       * P68 shipped five of — so it is collected rather than left to be
       * guessed at from a blank widget.
       */
      const refusals: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") refusals.push(message.text());
      });
      page.on("requestfailed", (request) => {
        refusals.push(
          `${request.method()} ${request.url()} — ${request.failure()?.errorText ?? "?"}`,
        );
      });

      const answers: string[] = [];
      page.on("response", (response) => {
        if (response.url().startsWith(API_BASE)) {
          answers.push(`${String(response.status())} ${response.url()}`);
        }
      });

      await page.goto(site.url());

      // The element upgrades and asks the API something. A widget that decided
      // it was misconfigured never calls at all, and renders its refusal inside
      // a closed root where nothing can see it.
      await expect
        .poll(() => answers.length, {
          message: [
            "the embedded widget never called the API.",
            "In the order to check them:",
            "  1. the bundle did not load or did not define <ds-lms>",
            "     — it comes from the widget host cross-origin (P96-01), so",
            "       check the CORS headers as well as the request",
            "  2. token-endpoint or token-header is missing or unreadable",
            "     — the plugin writes both and token.ts parses them (P96-03)",
            "  3. the element is missing api-base or project",
            `  the browser refused: ${refusals.join(" | ") || "(nothing)"}`,
          ].join("\n"),
          timeout: 20_000,
        })
        .toBeGreaterThan(0);

      // And the answers are readable: a cross-origin response the browser
      // blocks never reaches the widget, and `requestfailed` is where it lands.
      expect(
        refusals.filter((line) => /CORS|blocked|Failed to fetch/iu.test(line)),
        "the browser blocked the API call — check ALLOWED_ORIGINS on the API",
      ).toEqual([]);

      const before = await widgetText(page);
      const report = [
        `what the API answered: ${answers.join(" | ")}`,
        `what it rendered: ${before.slice(0, 400)}`,
      ].join("\n");

      /*
       * ## A physician nobody has provisioned gets in (P94-03)
       *
       * This asserted the opposite until today, and said so: *"this records
       * today's behaviour rather than endorsing it. The day a provisioning path
       * exists, it fails here — loudly, in the file whose subject is the
       * WordPress channel."* It did, and this is that day.
       *
       * The client's rule: a user whose details reach us from WordPress becomes
       * a participant if they are not one already, and goes on if they are. The
       * guard writes the membership and the `learner` grant on first sight, for
       * the customer the project is bound to — so there is no 403 and nothing
       * for an operator to do by hand.
       *
       * No reload, no grant call, no second state: the first request is the
       * whole test now.
       */
      expect(
        answers.some((line) => line.startsWith("403 ")),
        `a Keycloak learner was refused — has provisioning stopped working?\n${report}`,
      ).toBe(false);

      await expect.poll(() => widgetText(page), { timeout: 20_000 }).toContain("DS Demo");

      const text = await widgetText(page);

      /*
       * The seeded course's own title, not the word "Fortbildung".
       *
       * The first version asserted the latter and passed — which proves
       * nothing, because every refusal this widget can render says
       * "Fortbildung" too ("Diese Fortbildung ist nicht korrekt eingebunden").
       * A check that a broken system also satisfies is not a check (§9.1), so
       * the assertion is a string only a **loaded catalogue** can produce.
       */
      const after = [
        `what the API answered: ${answers.join(" | ")}`,
        `what it rendered: ${text.slice(0, 400)}`,
      ].join("\n");

      /*
       * The seeded course's own title, not the word "Fortbildung".
       *
       * The first version of this assertion used the latter and passed against
       * the 403 — every refusal this widget renders sits under a hero reading
       * "Fortbildungsbereich". A check a broken system also satisfies is not a
       * check (§9.1), so this is a string only a loaded catalogue produces.
       */
      expect(text, `the embedded widget shows no course.\n${after}`).toContain("DS Demo");

      await context.close();
    } finally {
      await site?.stop();
    }
  });

  test("übernimmt die E-Mail aus dem MEDICE-Profil, wenn der Token keine hat", async ({
    browser,
  }) => {
    /*
     * The physician's address reaches the platform (P257-01).
     *
     * MEDICE's realm issues tokens with no `email`, `given_name` or
     * `family_name`. The plugin forwards the profile the theme stored at
     * sign-in as `learner-profile`, the widget is meant to send it as
     * `X-DS-Profile`, and the API fills what the token left empty. On
     * 15.10.2026 every MEDICE participant in the console had no address and
     * every certificate was "unzustellbar": the SDK had no such option, so the
     * header was never sent. The guard's parser was tested; nothing tested that
     * any client sent what it parses (§9.7).
     *
     * The token here is minted **without** profile claims, as MEDICE's is. The
     * rig's default token carries `email`, which is why this path was never
     * exercised by a browser at all (§9.13: a rig shaped like a deployment that
     * does not need the fix cannot find it missing).
     */
    const username = "wp-ohne-claims@medice.example";
    const hinted = "praxis.lorem@medice.example";
    let site: WordPressSite | undefined;

    try {
      const token = await mintKeycloakToken(username, { withoutProfileClaims: true });
      site = await startWordPress({
        repo: REPO,
        apiBase: API_BASE,
        token,
        learnerProfile: { email: hinted, firstName: "Muster", lastName: "Lorem" },
      });

      const context = await browser.newContext();
      const page = await context.newPage();
      await openWidgetShadowRoots(page);
      await page.goto(site.url());
      await expect.poll(() => widgetText(page), { timeout: 20_000 }).toContain("DS Demo");

      // The credential's subject is the username (dev-keycloak), so this is the
      // person that token provisioned — not a lookup by the address asserted.
      const stored = await storedProfile(username);
      expect(
        stored,
        "no person was provisioned for the MEDICE-shaped token",
      ).not.toBeNull();
      expect(
        stored?.email,
        "the profile hint did not reach the API — is X-DS-Profile being sent?",
      ).toBe(hinted);
      expect(stored?.lastName).toBe("Lorem");

      await context.close();
    } finally {
      await site?.stop();
    }
  });

  test("nimmt nach einem Neustart des Keycloak-Stubs weiter Tokens an", async ({
    browser,
  }) => {
    /*
     * A restarted stub signs with the key the API already holds (P258-09).
     *
     * CI retries a failed test in a new worker, which runs `beforeAll` again
     * and starts a second stub. It used to generate a new key under the same
     * `kid`, the API kept the JWKS it had cached, and every later token in the
     * group was 401 — one real failure became a whole group reading "Ihre
     * Sitzung ist abgelaufen". This is that restart, on purpose.
     */
    keycloak?.kill();
    await new Promise((resolve) => setTimeout(resolve, 500));
    keycloak = await startKeycloak(REPO);

    let site: WordPressSite | undefined;
    try {
      const token = await mintKeycloakToken("wp-nach-neustart@medice.example");
      site = await startWordPress({ repo: REPO, apiBase: API_BASE, token });
      const context = await browser.newContext();
      const page = await context.newPage();
      await openWidgetShadowRoots(page);
      await page.goto(site.url());
      await expect.poll(() => widgetText(page), { timeout: 20_000 }).toContain("DS Demo");
      await context.close();
    } finally {
      await site?.stop();
    }
  });

  test("sagt es, wenn WordPress keinen Token hat", async ({ browser }) => {
    /*
     * A visitor who is not logged in to WordPress: the plugin installs no
     * provider at all, and the endpoint would answer 404 anyway. The widget has
     * to say so rather than render an empty frame — §9.4 — and this is the
     * state a physician lands in when their WordPress session expires.
     */
    let site: WordPressSite | undefined;

    try {
      site = await startWordPress({ repo: REPO, apiBase: API_BASE, token: undefined });

      const context = await browser.newContext();
      const page = await context.newPage();
      await openWidgetShadowRoots(page);
      await page.goto(site.url());

      /*
       * Polled for the *message*, not for "some text".
       *
       * The first version waited for the widget to render anything at all and
       * then read once — and the hero paints before the API has answered, so it
       * read a catalogue still saying „Wird geladen …" and failed one run in
       * three. A poll for the state being asserted is the fix; a longer sleep
       * is not.
       */
      await expect
        .poll(() => widgetText(page), { timeout: 20_000 })
        .toContain("keine Anmeldedaten");

      const text = await widgetText(page);

      /*
       * ## This assertion used to demand the sentence P101-03 removed
       *
       * It read `toContain("Sitzung ist abgelaufen")`, and it was written on
       * 2026-08-18 (`bdc3b75`). One day later `cf6c8c1` fixed a **client-
       * reported** bug: the widget said "Ihre Sitzung ist abgelaufen" whenever
       * the token endpoint answered anything but 200, so a 404 from an
       * uninstalled plugin and a genuinely expired token produced identical
       * screens — and the screen named the one thing that was working. Signing
       * in again cannot fix a 404, so the advice sent the one person who could
       * not help into a loop and told nobody who could.
       *
       * So this test has been asserting the defect ever since, and nothing
       * noticed for thirteen days: the post-deploy smoke runs only
       * `journey.spec.ts` and `zwei-module.spec.ts`
       * (`playwright.smoke.config.ts` `testMatch`), and nothing runs the full
       * browser suite in CI or on deploy. It fails the moment a human types
       * `pnpm test:e2e`, which is what happened.
       *
       * What the widget actually renders, and what this now pins:
       *
       *   "Diese Seite konnte keine Anmeldedaten für das Lernmodul abrufen.
       *    Das liegt nicht an Ihrem Konto — … Technische Angabe:
       *    Token-Endpunkt — endpoint_404."
       *
       * Three properties, and each is the point of P101-03:
       */

      // 1. It says the page could not get credentials — not that the physician's
      //    session ended, which is the claim that was false.
      expect(
        text,
        `a visitor with no WordPress session sees: ${text.slice(0, 300)}`,
      ).toContain("keine Anmeldedaten");

      // 2. It absolves the physician explicitly. This is the sentence that stops
      //    them retrying a sign-in that cannot help.
      expect(text, "the physician is told it is not their account").toContain(
        "nicht an Ihrem Konto",
      );

      // 3. It carries the technical cause for whoever maintains the site — the
      //    person who *can* fix it, which the old message never reached (§9.10).
      expect(text, "the site's maintainer is given the cause").toContain("endpoint_404");

      // And it must not claim the session expired: that is the regression.
      expect(
        text,
        "the removed P101-03 defect is back: a 404 reported as an expired session",
      ).not.toContain("Sitzung ist abgelaufen");
      expect(
        text,
        "a signed-out visitor is told the embed is broken, which is the wrong advice",
      ).not.toContain("nicht korrekt eingebunden");

      await context.close();
    } finally {
      await site?.stop();
    }
  });
});

test.describe("die WordPress-Einbindung, Projekt", () => {
  test("nutzt das Keycloak-Projekt, nicht das Portal-Projekt", () => {
    /*
     * Worth pinning as a fact rather than a comment: the seeds create *two*
     * projects per customer — `ds`/`medice` for the portal, authenticating a
     * password against our own tables, and `ds-demo`/`medice-adhs` bound to
     * the customer's Keycloak realm. The plugin's settings screen takes the
     * project slug, and the wrong one there authenticates nobody.
     */
    expect(WP_PROJECT_SLUG).toBe("ds-demo");
  });
});
