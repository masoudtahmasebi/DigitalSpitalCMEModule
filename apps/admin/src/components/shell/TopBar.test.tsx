/**
 * The top bar, which is the one part of the console a person looks at on every
 * screen and the one part nothing could render on its own.
 *
 * `App.test.tsx` is still the test that proves the console mounts this (§9.7).
 * What is here is the behaviour that does not need a session or an API: what
 * the bar says when there is nobody signed in, and whether the mobile menu
 * button describes its own state.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { TopBar } from "./TopBar.js";
import { de } from "../../locale/de.js";

afterEach(cleanup);

describe("signed out", () => {
  it("offers nothing that would refuse, and says what the application is", () => {
    render(<TopBar signedIn={false} menuOpen={false} />);

    // §9.2: a sign-out button before there is a session is a control that can
    // only fail, and the language switch and customer picker are both about a
    // session that does not exist yet.
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("heading", { name: de.appTitle })).toBeTruthy();
  });
});

describe("signed in", () => {
  function draw(menuOpen = false) {
    const events: string[] = [];
    render(
      <TopBar
        signedIn
        menuOpen={menuOpen}
        operator="asta@medice.example"
        onSignOut={() => events.push("sign-out")}
        onToggleMenu={() => events.push("toggle")}
        scope={<span>Kundenauswahl</span>}
      />,
    );
    return events;
  }

  it("names whose session this is", () => {
    draw();
    // An operator with two accounts — their own and a super admin one — has no
    // other way to tell which they are acting as, and the two differ in what
    // they can destroy.
    expect(screen.getByText("asta@medice.example")).toBeTruthy();
  });

  it("carries the scope controls it was given", () => {
    draw();
    expect(screen.getByText("Kundenauswahl")).toBeTruthy();
  });

  it("says whether the menu is open, rather than only looking it", () => {
    draw(false);
    expect(
      screen.getByRole("button", { name: de.nav.menu }).getAttribute("aria-expanded"),
    ).toBe("false");
    cleanup();

    draw(true);
    const open = screen.getByRole("button", { name: de.nav.closeMenu });
    expect(open.getAttribute("aria-expanded")).toBe("true");
  });

  it("reports a menu toggle and a sign-out to its caller", () => {
    const events = draw();
    screen.getByRole("button", { name: de.nav.menu }).click();
    screen.getByRole("button", { name: de.auth.signOut }).click();
    expect(events).toEqual(["toggle", "sign-out"]);
  });

  it("offers the language switch with a label that says which language it goes to", () => {
    draw();
    // §9.4 — "EN" on its own is two letters. Somebody who cannot read the
    // current language is exactly the person who needs this control, so the
    // accessible name has to say where it leads.
    const target = de.language.switchTo(de.language.english);
    expect(screen.getByRole("button", { name: target }).textContent).toBe("EN");
  });
});
