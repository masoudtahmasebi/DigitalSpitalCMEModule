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

import { afterEach, describe, expect, it } from "vitest";
import {
  clearCourseFragment,
  decode,
  decodeCourseSlug,
  encode,
  type WidgetRoute,
} from "./route.js";

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

describe("a link that survives a reload on a catalogue page (P156-02)", () => {
  /*
   * Reported three times, most recently as:
   *
   *   "when i refresh https://…/dscme/#ds/inhalt/f65625e0-… again the main
   *    page opens."
   *
   * Every route this router encodes is **course-relative** — `ds/inhalt/<id>`
   * names a content and nothing else — and the course comes from the
   * `course-slug` attribute on `<ds-lms>`. On a page that does not carry that
   * attribute the widget opens the catalogue, the learner picks a course, and
   * the fragment starts naming contents inside it. Reload, and the attribute is
   * still absent, so the catalogue renders again and the fragment can never be
   * applied: the component that would read it is not mounted.
   *
   * §9.8 — the address existed and was incomplete, which is the same defect as
   * having none.
   */
  it("carries the course when the page does not name one", () => {
    const fragment = encode({ kind: "content", contentId: CONTENT_ID }, "adhs-2026");
    expect(fragment).toBe(`ds/kurs/adhs-2026/inhalt/${CONTENT_ID}`);
  });

  it("reads the course back out", () => {
    expect(decodeCourseSlug(`#ds/kurs/adhs-2026/inhalt/${CONTENT_ID}`)).toBe("adhs-2026");
  });

  it("decodes the screen the same way whether or not the course is named", () => {
    expect(decode(`#ds/kurs/adhs-2026/inhalt/${CONTENT_ID}`)).toEqual({
      kind: "content",
      contentId: CONTENT_ID,
    });
    expect(decode(`#ds/inhalt/${CONTENT_ID}`)).toEqual({
      kind: "content",
      contentId: CONTENT_ID,
    });
  });

  it("keeps every link anybody has already sent working", () => {
    // The old form has no course and must still name the same screen.
    expect(decodeCourseSlug(`#ds/inhalt/${CONTENT_ID}`)).toBeUndefined();
    expect(decode("#ds")).toEqual({ kind: "outline", tab: "overview" });
    expect(decode("#ds/kurs/adhs-2026")).toEqual({ kind: "outline", tab: "overview" });
    expect(decode("#ds/kurs/adhs-2026/zertifizierung")).toEqual({
      kind: "outline",
      tab: "certification",
    });
  });

  it("refuses a course slug that is not one, rather than passing it on", () => {
    // The same reasoning as CONTENT_ID: this string is compared against slugs
    // from the API and written into location.hash.
    expect(decodeCourseSlug("#ds/kurs/..%2f..%2fetc/inhalt/x")).toBeUndefined();
    expect(decodeCourseSlug("#ds/kurs//inhalt/x")).toBeUndefined();
    expect(decodeCourseSlug("#ds/kurs")).toBeUndefined();
  });

  it("leaves a host page's own anchor alone", () => {
    expect(decodeCourseSlug("#kontakt")).toBeUndefined();
  });
});

/*
 * DEP-33. The address leaves with the learner.
 *
 * **Zurück zur Übersicht** rendered the catalogue and left the fragment naming
 * the course — and the tab inside it — so the URL was wrong immediately and a
 * reload put the learner back in the course they had just left.
 *
 * `App.route.test.tsx` asserts the button calls this; these cases are the rule
 * itself, and the second is the one with the sharp edge: `<ds-lms>` does not
 * own its page.
 */
describe("leaving a course for the catalogue", () => {
  afterEach(() => {
    window.history.replaceState(null, "", window.location.pathname);
  });

  it("removes a fragment this router wrote", () => {
    window.history.replaceState(null, "", "#ds/kurs/adhs-2026/referenten");

    expect(clearCourseFragment()).toBe(true);
    expect(window.location.hash).toBe("");
  });

  it("leaves the host page's own anchor exactly where it was", () => {
    // A learner may have arrived from the theme's menu at …/fortbildungen#kontakt.
    // Clearing that would move a WordPress page under them.
    window.history.replaceState(null, "", "#kontakt");

    expect(clearCourseFragment()).toBe(false);
    expect(window.location.hash).toBe("#kontakt");
  });

  it("does nothing when there is no fragment at all", () => {
    expect(clearCourseFragment()).toBe(false);
    expect(window.location.hash).toBe("");
  });
});
