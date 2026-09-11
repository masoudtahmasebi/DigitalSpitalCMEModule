/**
 * A session that ends while somebody is reading (P214-01).
 *
 * ## The report this comes from
 *
 * A physician on `/dscme/`, signed in, saw:
 *
 * > **Es ist ein Fehler aufgetreten** — Diese Seite konnte keine Anmeldedaten
 * > für das Lernmodul abrufen. Das liegt nicht an Ihrem Konto — bitte versuchen
 * > Sie es später erneut oder wenden Sie sich an den Betreiber der Seite.
 * > Technische Angabe: Token-Endpunkt — endpoint_403.
 *
 * Their Keycloak session had expired. Nothing was broken, nobody needed to be
 * contacted, and the one thing that would have fixed it — signing in again —
 * was the one thing the screen did not offer.
 *
 * ## Why these tests drive `App`
 *
 * §9.7. The defect lived in the **wiring**: `describeError` mapped
 * `no_token_held` to a sensible sentence and had done for months, and the
 * screen that rendered it wrapped it in a red alert with no way forward. A test
 * of `describeError`, or of `FailureNotice` alone, would have been green
 * throughout. The property that matters is what a physician sees, so the test
 * starts where they start: the element, with a token endpoint that answers the
 * way WordPress answers.
 *
 * ## The two halves, and why both are asserted
 *
 * The plugin half (P214-01 in `class-ds-lms-token-endpoint.php`) makes the
 * endpoint answer **404 `no_token_held`** instead of a forbidden status. The
 * widget half turns that into the expired notice. Either alone leaves the
 * defect: the old status still reads as a fault, and the old screen still draws
 * a red alert. So one case per half, plus the case that must NOT change.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { App } from "./App.js";
import { de } from "./locale/de.js";
import { resolveTokenProvider } from "./token.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const config = {
  apiBase: "https://api.example.test",
  projectSlug: "medice-adhs",
  courseSlug: "adhs-akademie-adult",
} as const;

/** Every URL the widget asked for, so a case can prove what did not happen. */
let requested: string[] = [];

/**
 * A host page that names a token endpoint answering `answer`.
 *
 * `signed-in` is deliberately **not** false in these tests: the whole point is
 * the visitor the page believes is signed in. `signedIn === false` is the
 * DocCheck/never-logged-in branch and has its own suite.
 */
function hostWithTokenEndpoint(answer: Response | (() => Response)): void {
  requested = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = new URL(input.toString(), "https://wp.example.test");
    requested.push(url.toString());
    if (url.pathname === "/wp-json/ds-lms/v1/token") {
      return typeof answer === "function" ? answer() : answer.clone();
    }
    return new Response("{}", { status: 500 });
  });
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/*
 * The real provider, built the way `element.ts` builds it from the element's
 * `token-endpoint` attribute — not a stub.
 *
 * The defect being tested is a chain: an HTTP **status** becomes a `reason`
 * becomes a screen. A hand-made provider that threw the right error would skip
 * the first link, which is the one the plugin change is about.
 */
function renderWidget() {
  const getToken = resolveTokenProvider({ endpoint: "/wp-json/ds-lms/v1/token" });
  if (getToken === undefined) throw new Error("the endpoint should yield a provider");

  render(<App {...config} getToken={getToken} signInUrl="/anmelden" />);
}

describe("the token endpoint says this session holds nothing", () => {
  beforeEach(() => {
    // What the plugin answers after P214-01: the documented 404, with the
    // reason that distinguishes it from every other 404.
    hostWithTokenEndpoint(() => json({ token: null, reason: "no_token_held" }, 404));
  });

  it("says the session expired, not that the site is broken", async () => {
    renderWidget();

    expect(await screen.findByText(de.signedOut.expiredTitle)).toBeTruthy();
    expect(screen.queryByText(de.error.title)).toBeNull();
  });

  it("tells them their progress is kept, which is the fact they need", async () => {
    renderWidget();

    expect(await screen.findByText(de.signedOut.expiredMessage)).toBeTruthy();
  });

  it("offers the way back in, where the host page said", async () => {
    renderWidget();

    const action = await screen.findByText(de.signedOut.action);
    expect(action.getAttribute("href")).toBe("/anmelden");
  });

  it("never mentions the operator of the site", async () => {
    renderWidget();
    await screen.findByText(de.signedOut.expiredTitle);

    expect(screen.queryByText(/Betreiber der Seite/u)).toBeNull();
  });

  /*
   * Asserted as "nothing reached the API", not "exactly one request happened".
   *
   * The screen loads the course and the enrolment, so the provider is asked
   * twice and a failure is deliberately not cached — a retry must be able to
   * succeed. Pinning the count would make this test fail the next time a screen
   * gains a parallel load, which is not the property it is here to defend.
   */
  it("sends nothing to the API — there is no token to send", async () => {
    renderWidget();
    await screen.findByText(de.signedOut.expiredTitle);

    expect(requested.filter((url) => url.includes("api.example.test"))).toEqual([]);
    expect(requested.length).toBeGreaterThan(0);
  });
});

/*
 * The half that must not change, and the reason `isSessionExpired` tests the
 * *reason* rather than "did the token fetch fail".
 *
 * A token endpoint that is down, misconfigured or behind a broken proxy is a
 * fault somebody has to fix. Telling that physician "please sign in again"
 * sends them round a loop that cannot end — which is exactly the defect
 * P101-03 records, and the reason this suite has a case for it.
 */
describe("the token endpoint itself is broken", () => {
  it("still says so, and still offers a retry", async () => {
    hostWithTokenEndpoint(() => new Response("nope", { status: 500 }));
    renderWidget();

    expect(await screen.findByText(de.error.title)).toBeTruthy();
    expect(screen.queryByText(de.signedOut.expiredTitle)).toBeNull();
  });

  /*
   * The status the plugin used to answer for an expired session. Pinned as a
   * *fault* on purpose: after P214-01 nothing produces it for that condition,
   * and if something ever does, it is genuinely a refusal rather than an empty
   * session — a wrong nonce or another origin — which is an operator's problem
   * and must keep saying so.
   */
  it("treats a forbidden status as a fault, because now that is what it means", async () => {
    hostWithTokenEndpoint(() => json({ code: "rest_forbidden" }, 403));
    renderWidget();

    expect(await screen.findByText(de.error.title)).toBeTruthy();
    expect(screen.queryByText(de.signedOut.expiredTitle)).toBeNull();
  });
});
