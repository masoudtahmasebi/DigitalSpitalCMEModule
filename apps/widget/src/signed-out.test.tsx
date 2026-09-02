/**
 * The three reasons a widget has no token, told apart (P99-03).
 *
 * They used to be one, and the one was the wrong one: anything that failed to
 * produce a token rendered *"Diese Fortbildung ist nicht korrekt eingebunden.
 * Bitte wenden Sie sich an den Betreiber der Seite."* On the MEDICE site the
 * commonest reason is that the visitor has not logged in — so a physician was
 * told to ring the webmaster about their own sign-in.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
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

describe("a page that says nobody is signed in", () => {
  it("invites them to sign in rather than blaming the embed", () => {
    render(<App {...config} getToken={undefined} signedIn={false} signInUrl="/login" />);

    expect(screen.getByText(de.signedOut.title)).toBeTruthy();
    expect(screen.queryByText(de.error.misconfigured)).toBeNull();
  });

  it("gives them something that works, pointing where the host said", () => {
    render(
      <App {...config} getToken={undefined} signedIn={false} signInUrl="/anmelden" />,
    );

    const action = screen.getByText(de.signedOut.action);
    expect(action.getAttribute("href")).toBe("/anmelden");
  });

  it("makes no request at all, so a signed-out page has a clean console", () => {
    // The whole point of the client's request: not "show the errors more
    // nicely" but "do not produce them".
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    render(<App {...config} getToken={undefined} signedIn={false} signInUrl="/login" />);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("offers no dead link when the host named no sign-in address", () => {
    // §9.2: better no control than one that cannot work.
    render(<App {...config} getToken={undefined} signedIn={false} />);

    expect(screen.getByText(de.signedOut.title)).toBeTruthy();
    expect(screen.queryByText(de.signedOut.action)).toBeNull();
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
