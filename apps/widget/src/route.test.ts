/**
 * Unit tests for the fragment grammar (P82-04).
 *
 * These are the *easy* half and they prove less than they look like they do.
 * `apps/admin/src/routes.test.ts` round-tripped every screen through
 * `encode`/`decode` and would have passed unchanged on a console that called
 * neither — where the address bar never moved (CLAUDE.md §9.7). The property
 * that actually matters here is that `App` reads the fragment on mount and
 * writes it on every change, and that is asserted in `App.route.test.tsx`.
 *
 * What is worth testing here is the part with a sharp edge: deciding which
 * fragments are *not* ours. `<ds-lms>` runs inside a customer's WordPress page.
 */

import { describe, expect, it } from "vitest";
import { decode, encode, type WidgetRoute } from "./route.js";

const CONTENT_ID = "aaaaaaaa-0000-4000-8000-000000000001";

const ROUTES: readonly WidgetRoute[] = [
  { kind: "outline", tab: "overview" },
  { kind: "outline", tab: "speakers" },
  { kind: "outline", tab: "certification" },
  { kind: "outline", tab: "library" },
  { kind: "content", contentId: CONTENT_ID },
  { kind: "evaluation" },
  { kind: "reporting" },
];

describe("encode / decode", () => {
  it.each(ROUTES)("round-trips %j", (route) => {
    expect(decode(`#${encode(route)}`)).toEqual(route);
  });

  it("uses the learner's own words in the URL", () => {
    // CLAUDE.md §5: the copy is German and authoritative, and a link is copy.
    expect(encode({ kind: "content", contentId: CONTENT_ID })).toContain("inhalt");
    expect(encode({ kind: "reporting" })).toContain("punktemeldung");
    expect(encode({ kind: "outline", tab: "library" })).toContain("mediathek");
    expect(encode({ kind: "outline", tab: "certification" })).toContain("zertifizierung");
  });

  /*
   * The overview keeps the bare prefix (P123-01).
   *
   * Every link anybody has sent since P82-04 points at `#ds`, and giving the
   * overview a segment of its own would leave those links decoding to a tab
   * that did not exist when they were written.
   */
  it("leaves the overview at the address it has always had", () => {
    expect(encode({ kind: "outline", tab: "overview" })).toBe("ds");
    expect(decode("#ds")).toEqual({ kind: "outline", tab: "overview" });
  });

  /*
   * A tab segment must not be mistaken for a screen, or the reverse. These four
   * share one shape — `ds/<word>` — and the only thing keeping them apart is
   * which table the word is looked up in.
   */
  it("tells a tab apart from a screen at the same depth", () => {
    expect(decode("#ds/mediathek")).toEqual({ kind: "outline", tab: "library" });
    expect(decode("#ds/evaluation")).toEqual({ kind: "evaluation" });
    expect(decode("#ds/punktemeldung")).toEqual({ kind: "reporting" });
  });
});

describe("fragments that belong to the host page", () => {
  /*
   * The reason for the prefix. Each of these is something a real WordPress
   * theme or plugin puts in the address bar, and treating any of them as a
   * route would close whatever the learner was watching.
   */
  it.each(["#kontakt", "#main", "#/kurse", "#comment-1428", "#", ""])(
    "leaves %s alone",
    (hash) => {
      expect(decode(hash)).toBeUndefined();
    },
  );

  it("distinguishes 'not ours' from 'the overview'", () => {
    // Both would be falsy if `decode` answered `undefined` for the outline, and
    // the caller would have no way to tell "change nothing" from "go to the
    // course overview".
    expect(decode("#kontakt")).toBeUndefined();
    expect(decode("#ds")).toEqual({ kind: "outline", tab: "overview" });
  });
});

describe("fragments that are ours but malformed", () => {
  it("refuses a content id that is not one", () => {
    // Keeps anything path-like out of a value compared against API ids.
    expect(decode("#ds/inhalt/..%2F..%2Fetc")).toBeUndefined();
    expect(decode("#ds/inhalt/not-a-uuid")).toBeUndefined();
  });

  it("survives a malformed percent-escape", () => {
    expect(decode("#ds/inhalt/%E0%A4%A")).toBeUndefined();
  });

  it("falls back to the overview for a shape it does not know", () => {
    // A truncated link, or a fragment from a version that knew another screen.
    // Ours by prefix, so the course's first page is the honest answer.
    expect(decode("#ds/zertifikat")).toEqual({ kind: "outline", tab: "overview" });
    expect(decode("#ds/inhalt")).toEqual({ kind: "outline", tab: "overview" });
  });

  it("tolerates the slashes a person pastes", () => {
    expect(decode("#/ds/punktemeldung")).toEqual({ kind: "reporting" });
    expect(decode("#ds/punktemeldung/")).toEqual({ kind: "reporting" });
  });
});
