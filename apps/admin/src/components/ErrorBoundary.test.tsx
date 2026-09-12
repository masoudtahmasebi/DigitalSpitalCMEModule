/**
 * What an operator sees when a screen throws (P233-01).
 *
 * ## Why this file exists
 *
 * There was no error boundary anywhere in the console. React's behaviour
 * without one is to unmount the **whole tree**, so a render-time throw on any
 * screen left a blank white page.
 *
 * The cost is not only that it says nothing. It says nothing *in the shape of
 * something else*: a blank page is what a failed deploy looks like, and what a
 * wrong URL looks like. So the first thing it buys is an hour spent checking
 * the server (§9.9, "which build and which data?") for a fault in the bundle
 * already loaded.
 *
 * ## The property, and why it is asserted through `Shell`
 *
 * The boundary on its own is a React feature and testing it alone would prove
 * React works. What matters is that the console **uses** it, and that the frame
 * survives — §9.7, name the caller. So the tests render `Shell` with a child
 * that throws and assert the sidebar is still there.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ErrorBoundary } from "./ErrorBoundary.js";
import { Shell } from "./shell/Shell.js";
import { de } from "../locale/de.js";

afterEach(cleanup);

/**
 * React logs a caught render error to `console.error` regardless of what the
 * boundary does. Silenced so a passing run is not full of red, and **restored**
 * in `afterEach` — a global left stubbed is P22-08's and §9.8's lesson, and
 * this file would be hiding real errors in every test after it.
 */
function quietReactErrorLogging() {
  return vi.spyOn(console, "error").mockImplementation(() => undefined);
}

function Explode(): never {
  throw new Error("this screen is broken");
}

describe("a screen that throws while rendering", () => {
  it("says what happened instead of leaving a blank page", () => {
    const quiet = quietReactErrorLogging();
    render(
      <ErrorBoundary>
        <Explode />
      </ErrorBoundary>,
    );

    expect(
      screen.getByText(de.error.crashTitle),
      "nothing was rendered in place of the screen that threw, which is a " +
        "blank page — indistinguishable from a failed deploy",
    ).toBeTruthy();
    quiet.mockRestore();
  });

  it("keeps the navigation, so the operator can go somewhere else", () => {
    const quiet = quietReactErrorLogging();
    render(
      <Shell
        operator="Dr. Muster"
        onSignOut={() => undefined}
        nav={<button type="button">Fortbildungen</button>}
        screenKey="courses"
      >
        <Explode />
      </Shell>,
    );

    /*
     * The whole point of putting the boundary inside `Shell` rather than
     * around it. If it were outside, this assertion would fail and the
     * operator's only way out of a broken screen would be the browser's
     * address bar.
     */
    expect(
      screen.getByRole("button", { name: "Fortbildungen" }),
      "a broken screen took the navigation with it, so there is nowhere to go " +
        "from here except the address bar",
    ).toBeTruthy();
    expect(screen.getByText(de.error.crashTitle)).toBeTruthy();
    quiet.mockRestore();
  });

  it("offers a reload, because that is the one thing that helps", () => {
    const quiet = quietReactErrorLogging();
    const reload = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload },
    });

    render(
      <ErrorBoundary>
        <Explode />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByRole("button", { name: de.error.crashReload }));

    expect(reload).toHaveBeenCalledTimes(1);
    quiet.mockRestore();
  });

  it("tries again when the operator navigates to a different screen", () => {
    const quiet = quietReactErrorLogging();
    const view = render(
      <ErrorBoundary resetKey="courses">
        <Explode />
      </ErrorBoundary>,
    );
    expect(screen.getByText(de.error.crashTitle)).toBeTruthy();

    /*
     * Without `resetKey` the boundary's own state outlives the children it
     * wraps, so a screen that threw once stays broken for the rest of the
     * session — the fix producing §9.8's defect, a place you cannot get back
     * to. This is the case that catches that.
     */
    view.rerender(
      <ErrorBoundary resetKey="participants">
        <p>Teilnehmende</p>
      </ErrorBoundary>,
    );

    expect(
      screen.queryByText(de.error.crashTitle),
      "the boundary stayed tripped after navigating to a different screen, so " +
        "one throw breaks every screen for the rest of the session",
    ).toBeNull();
    expect(screen.getByText("Teilnehmende")).toBeTruthy();
    quiet.mockRestore();
  });
});
