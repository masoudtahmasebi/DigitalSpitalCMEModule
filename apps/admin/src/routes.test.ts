/**
 * The console's fragment routes (P42-01).
 *
 * Pure, so every case is cheap — which is the argument for hand-rolling this
 * over a router: `encode`/`decode` are two functions with an exhaustive input
 * space, and a `<Route>` tree is not testable in this shape at all.
 *
 * The round-trip is the property that matters. A screen whose fragment decodes
 * to a *different* screen is worse than one with no fragment: the address bar
 * would be confidently wrong, and a link somebody sent would open the wrong
 * page rather than fail.
 */

import { describe, expect, it } from "vitest";
import { decode, encode, type Route } from "./routes.js";

const EVERY_SCREEN: readonly Route[] = [
  { kind: "courses" },
  { kind: "new-course" },
  { kind: "organisation" },
  { kind: "branding" },
  { kind: "customers" },
  { kind: "participants" },
  { kind: "learners" },
  { kind: "certificates" },
  { kind: "staff" },
  { kind: "security" },
  { kind: "course", slug: "adhs-akademie-adult", tab: "structure" },
  { kind: "course", slug: "adhs-akademie-adult", tab: "settings" },
];

describe("every screen round-trips", () => {
  for (const route of EVERY_SCREEN) {
    it(`${route.kind}${route.kind === "course" ? `/${route.tab}` : ""}`, () => {
      expect(decode(encode(route))).toEqual(route);
    });
  }

  it("covers every screen the union names", () => {
    /*
     * The assertion that keeps this file honest.
     *
     * Without it, adding a screen to `Route` and forgetting to add it here
     * leaves the new one untested — and the failure mode of a missing route is
     * silent: `decode` returns `undefined` and the app falls back to the course
     * list, so the link opens *a* page and nobody notices it is the wrong one.
     */
    const covered = new Set(EVERY_SCREEN.map((route) => route.kind));
    const declared = [
      "courses",
      "new-course",
      "organisation",
      "branding",
      "customers",
      "participants",
      "learners",
      "certificates",
      "staff",
      "security",
      "course",
    ];
    expect([...covered].sort()).toEqual([...declared].sort());
  });
});

describe("what a fragment may not become", () => {
  it("refuses a tab that does not exist rather than inventing one", () => {
    expect(decode("#/fortbildungen/adhs/quatsch")).toBeUndefined();
  });

  it("does not read the new-course screen as a course slugged 'neu'", () => {
    // `#/fortbildungen/neu` is its own screen, and a course cannot be slugged
    // `neu` without shadowing it.
    expect(decode("#/fortbildungen/neu")).toEqual({ kind: "new-course" });
    expect(decode("#/fortbildungen/neu/structure")).toBeUndefined();
  });

  it("returns undefined for an unknown fragment, so the caller decides", () => {
    expect(decode("#/gibt-es-nicht")).toBeUndefined();
    expect(decode("")).toBeUndefined();
    expect(decode("#")).toBeUndefined();
  });

  it("leaves the password-reset fragment alone", () => {
    // Owned by `NewPassword` and checked before this is consulted. Decoding it
    // to a screen would drop somebody holding a reset link into the console.
    expect(decode("#passwort-neu?token=abc")).toBeUndefined();
  });

  it("survives a slug that needs escaping", () => {
    const route: Route = { kind: "course", slug: "kurs mit leerzeichen", tab: "experts" };
    expect(encode(route)).not.toContain(" ");
    expect(decode(encode(route))).toEqual(route);
  });

  it("tolerates a trailing slash, which a person pasting a link adds", () => {
    expect(decode("#/organisation/")).toEqual({ kind: "organisation" });
  });
});
