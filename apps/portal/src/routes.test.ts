/**
 * The portal's routing, which is now the thing that decides which customer a
 * visitor is looking at (P21-03).
 *
 * That makes it worth more tests than a three-screen app usually deserves: a
 * bug here does not render the wrong page, it renders **another customer's**
 * catalogue, or sends somebody to an identity provider they have nothing to do
 * with. The second of those was reported from production.
 */

import { describe, expect, it } from "vitest";
import { parseRoute, routePath, routeTenant } from "./routes.js";

describe("parseRoute", () => {
  it("gives the root a welcome page and nothing else", () => {
    // The reported bug: the root used to *be* MEDICE, and opening it bounced a
    // visitor straight into `login.medice.de` with no way back.
    expect(parseRoute("/")).toEqual({ kind: "welcome" });
    expect(parseRoute("")).toEqual({ kind: "welcome" });
  });

  it("reads a tenant out of the first segment", () => {
    expect(parseRoute("/medice")).toEqual({ kind: "catalogue", tenant: "medice" });
    expect(parseRoute("/ds")).toEqual({ kind: "catalogue", tenant: "ds" });
  });

  it("tolerates a trailing slash, which is what a pasted link has", () => {
    expect(parseRoute("/medice/")).toEqual({ kind: "catalogue", tenant: "medice" });
  });

  it("reads a course inside a tenant", () => {
    expect(parseRoute("/medice/kurs/adhs-adult")).toEqual({
      kind: "course",
      tenant: "medice",
      slug: "adhs-adult",
    });
  });

  it("decodes a percent-escaped slug", () => {
    expect(parseRoute("/medice/kurs/a%2Db")).toEqual({
      kind: "course",
      tenant: "medice",
      slug: "a-b",
    });
  });

  it("falls back to the tenant's catalogue for a malformed escape", () => {
    expect(parseRoute("/medice/kurs/%E0%A4%A")).toEqual({
      kind: "catalogue",
      tenant: "medice",
    });
  });

  it("falls back to the catalogue for an empty course slug", () => {
    expect(parseRoute("/medice/kurs/")).toEqual({ kind: "catalogue", tenant: "medice" });
  });

  it("keeps the tenant when the rest of the path is not understood", () => {
    // They named a customer, so we know where they belong even if the rest is
    // a stale link.
    expect(parseRoute("/medice/nonsense/here")).toEqual({
      kind: "catalogue",
      tenant: "medice",
    });
  });

  // --- what must never become a tenant ------------------------------------
  //
  // The tenant ends up in an `X-DS-Project` header, so anything path-like or
  // scheme-like reaching that far is a request to the API on somebody's behalf
  // with a value they chose. The grammar is the same one the platform issues
  // slugs under, so nothing legitimate is turned away by checking it here.

  it.each([
    ["/..", "a parent-directory traversal"],
    ["/../etc/passwd", "a traversal with a payload"],
    ["/%2e%2e", "an encoded traversal"],
    ["/MEDICE", "upper case, which no issued slug uses"],
    ["/medice_adhs", "an underscore, which the grammar excludes"],
    ["/-medice", "a leading hyphen"],
    ["/medice-", "a trailing hyphen"],
    ["/med--ice", "a doubled hyphen"],
    ["/http:", "something scheme-shaped"],
    ["/%2f", "an encoded slash"],
    ["/a b", "a space"],
    ["/<script>", "markup"],
  ])("refuses %s as a tenant (%s)", (path) => {
    expect(parseRoute(path)).toEqual({ kind: "welcome" });
  });
});

describe("routePath", () => {
  it("is the inverse of parseRoute for every route shape", () => {
    const routes = [
      { kind: "welcome" },
      { kind: "catalogue", tenant: "medice" },
      { kind: "course", tenant: "medice", slug: "adhs-adult" },
    ] as const;

    for (const route of routes) {
      expect(parseRoute(routePath(route))).toEqual(route);
    }
  });

  it("encodes a slug that needs it", () => {
    expect(routePath({ kind: "course", tenant: "medice", slug: "a/b" })).toBe(
      "/medice/kurs/a%2Fb",
    );
  });

  it("puts the welcome page at the root", () => {
    expect(routePath({ kind: "welcome" })).toBe("/");
  });
});

describe("routeTenant", () => {
  it("is undefined only for the welcome page", () => {
    expect(routeTenant({ kind: "welcome" })).toBeUndefined();
    expect(routeTenant({ kind: "catalogue", tenant: "ds" })).toBe("ds");
    expect(routeTenant({ kind: "course", tenant: "ds", slug: "x" })).toBe("ds");
  });
});
