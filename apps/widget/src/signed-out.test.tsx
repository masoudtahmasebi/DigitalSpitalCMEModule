/**
 * The three reasons a widget has no token, told apart (P99-03) — and what a
 * DocCheck visitor gets instead of the third (P213-01).
 *
 * They used to be one, and the one was the wrong one: anything that failed to
 * produce a token rendered *"Diese Fortbildung ist nicht korrekt eingebunden.
 * Bitte wenden Sie sich an den Betreiber der Seite."* On the MEDICE site the
 * commonest reason is that the visitor has not logged in — so a physician was
 * told to ring the webmaster about their own sign-in.
 *
 * Since P213-01 the signed-out branch asks the API whether this project offers
 * the catalogue preview before deciding what to draw. Every case below
 * therefore answers that one request, and the project that has **not** opted in
 * is asserted to land on exactly the screen it landed on before — because that
 * is the claim the change rests on.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { App } from "./App.js";
import { de } from "./locale/de.js";

/*
 * §9.8, in a test file: reset every ambient store, not only the one that broke.
 *
 * Without this the previous render's DOM is still mounted and `getByText`
 * finds two of everything — which reads as "the component rendered twice" and
 * sends you looking at the component.
 */
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const config = {
  apiBase: "https://api.example.test",
  projectSlug: "medice-adhs",
  courseSlug: "adhs-akademie-adult",
} as const;

/** Every request this render makes, in order. */
let requested: string[] = [];

/**
 * A project that has **not** opted into the preview.
 *
 * 404 is what `resolve_catalogue_preview` produces for it — and the same 404 it
 * produces for a project that does not exist, which is the point (§9.5).
 */
function noPreview(): void {
  requested = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    requested.push(new URL(input.toString()).pathname);
    return new Response(JSON.stringify({ title: "not found" }), {
      status: 404,
      headers: { "content-type": "application/problem+json" },
    });
  });
}

beforeEach(noPreview);

describe("a page that says nobody is signed in, on a project with no preview", () => {
  it("invites them to sign in rather than blaming the embed", async () => {
    render(<App {...config} getToken={undefined} signedIn={false} signInUrl="/login" />);

    expect(await screen.findByText(de.signedOut.title)).toBeTruthy();
    expect(screen.queryByText(de.error.misconfigured)).toBeNull();
  });

  it("gives them something that works, pointing where the host said", async () => {
    render(
      <App {...config} getToken={undefined} signedIn={false} signInUrl="/anmelden" />,
    );

    const action = await screen.findByText(de.signedOut.action);
    expect(action.getAttribute("href")).toBe("/anmelden");
  });

  /*
   * This used to assert *no* request at all, and the client's words behind it
   * were "not show the errors more nicely but do not produce them". That still
   * holds and is what is asserted: one request, to the route whose whole job is
   * to answer this question, and nothing else — no enrolment, no branding font,
   * no catalogue. The 404 it gets back is an answer, not an error the visitor
   * caused, and nothing on the screen mentions it.
   */
  it("asks exactly one question and makes no other request", async () => {
    render(<App {...config} getToken={undefined} signedIn={false} signInUrl="/login" />);
    await screen.findByText(de.signedOut.title);

    expect(requested).toEqual(["/preview/courses"]);
  });

  it("offers no dead link when the host named no sign-in address", async () => {
    // §9.2: better no control than one that cannot work.
    render(<App {...config} getToken={undefined} signedIn={false} />);

    expect(await screen.findByText(de.signedOut.title)).toBeTruthy();
    expect(screen.queryByText(de.signedOut.action)).toBeNull();
  });

  it("does not ask at all when the embed named no API to ask", async () => {
    // There is nothing to query, and `PreviewApp` would spend the render
    // failing to build a URL. The previous screen is the right one.
    render(<App {...config} apiBase="" getToken={undefined} signedIn={false} />);

    expect(await screen.findByText(de.signedOut.title)).toBeTruthy();
    expect(requested).toEqual([]);
  });
});

describe("a page that says nothing", () => {
  it("keeps the old behaviour exactly, because every unupdated host is here", () => {
    // Absent must not read as "signed out": that would blank the widget on
    // every site running an older plugin.
    render(<App {...config} getToken={undefined} />);

    expect(screen.getByText(de.error.misconfigured)).toBeTruthy();
    expect(screen.queryByText(de.signedOut.title)).toBeNull();
  });
});

describe("a page that says somebody is signed in but is genuinely misconfigured", () => {
  it("still names the operator's problem as the operator's problem", () => {
    render(<App {...config} apiBase="" getToken={undefined} signedIn={true} />);

    expect(screen.getByText(de.error.misconfigured)).toBeTruthy();
  });
});
