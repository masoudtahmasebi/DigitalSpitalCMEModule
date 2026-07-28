/**
 * The portal's routing.
 *
 * Six lines of string handling that decide which course a bookmarked link
 * opens, which makes them worth testing rather than trusting — particularly the
 * round trip, since a slug is user-visible and may contain characters that need
 * escaping.
 */

import { describe, expect, it } from "vitest";
import { parseRoute, routePath } from "./routes.js";

describe("parseRoute", () => {
  it("reads the catalogue from the root", () => {
    expect(parseRoute("/")).toEqual({ kind: "catalogue" });
    expect(parseRoute("")).toEqual({ kind: "catalogue" });
  });

  it("reads a course slug", () => {
    expect(parseRoute("/kurs/adhs-akademie-adult")).toEqual({
      kind: "course",
      slug: "adhs-akademie-adult",
    });
  });

  it("tolerates a trailing slash", () => {
    expect(parseRoute("/kurs/adhs-akademie-adult/")).toEqual({
      kind: "course",
      slug: "adhs-akademie-adult",
    });
  });

  it("decodes a percent-escaped slug", () => {
    expect(parseRoute("/kurs/adhs%20akademie")).toEqual({
      kind: "course",
      slug: "adhs akademie",
    });
  });

  it("falls back to the catalogue for anything unrecognised", () => {
    // A stale link or a typo in a two-screen app is far more likely than a
    // deliberate visit to a third screen, and the list is more useful than
    // being told nothing is here.
    expect(parseRoute("/nope")).toEqual({ kind: "catalogue" });
    expect(parseRoute("/kurs")).toEqual({ kind: "catalogue" });
    expect(parseRoute("/kurs/a/b")).toEqual({ kind: "catalogue" });
  });

  it("falls back rather than throwing on a malformed escape", () => {
    // `decodeURIComponent("%")` throws. An unhandled exception here would blank
    // the page for a mistyped URL.
    expect(parseRoute("/kurs/%")).toEqual({ kind: "catalogue" });
  });
});

describe("routePath", () => {
  it("is the inverse of parseRoute", () => {
    for (const slug of ["adhs-akademie-adult", "a b", "ä-ö-ü", "100%-ok"]) {
      const route = { kind: "course", slug } as const;
      expect(parseRoute(routePath(route))).toEqual(route);
    }
  });

  it("maps the catalogue to the root", () => {
    expect(routePath({ kind: "catalogue" })).toBe("/");
  });

  it("escapes a slug so the path stays parseable", () => {
    expect(routePath({ kind: "course", slug: "a/b" })).toBe("/kurs/a%2Fb");
  });
});
