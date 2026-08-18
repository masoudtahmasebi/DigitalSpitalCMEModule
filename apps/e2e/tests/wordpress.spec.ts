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
import { fileURLToPath } from "node:url";
import { openWidgetShadowRoots } from "../support/shadow.js";
import { API_BASE } from "../support/stack.js";
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
  test.setTimeout(180_000);

  test("mountet, holt sich einen Token und zeigt den Katalog", async ({ browser }) => {
    /*
     * The whole embedded path in one browser: WordPress mints a token from its
     * own session, the element upgrades, and a physician the platform has never
     * seen reaches a catalogue — provisioned on the way through (P94-03).
     */
    const keycloak = await startKeycloak(REPO);
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
            "  2. `tokenProvider` was lost — it is assigned before upgrade here,",
            "     which is what `#upgradeProperty` in element.ts exists for",
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
      keycloak.kill();
    }
  });

  test("sagt es, wenn WordPress keinen Token hat", async ({ browser }) => {
    /*
     * A visitor who is not logged in to WordPress: the plugin installs no
     * provider at all, and the endpoint would answer 404 anyway. The widget has
     * to say so rather than render an empty frame — §9.4 — and this is the
     * state a physician lands in when their WordPress session expires.
     */
    const keycloak = await startKeycloak(REPO);
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
        .toContain("Sitzung ist abgelaufen");

      const text = await widgetText(page);

      /*
       * "Ihre Sitzung ist abgelaufen. Bitte laden Sie die Seite neu und melden
       * Sie sich erneut an." — the API's 401 rendered as something a physician
       * can act on, rather than an empty frame or the misconfiguration notice.
       *
       * Which of the two it is matters: `misconfigured` sends them to the site
       * operator, and this is not the operator's problem. It is a WordPress
       * session that has ended, and the fix is to log in again.
       */
      expect(
        text,
        `a visitor with no WordPress session sees: ${text.slice(0, 300)}`,
      ).toContain("Sitzung ist abgelaufen");
      expect(
        text,
        "a signed-out visitor is told the embed is broken, which is the wrong advice",
      ).not.toContain("nicht korrekt eingebunden");

      await context.close();
    } finally {
      await site?.stop();
      keycloak.kill();
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
