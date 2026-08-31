/**
 * That a partial translation is safe (P86-01).
 *
 * The whole design rests on one property: an English table that covers a
 * fraction of the console must never produce a blank label, a key name, or an
 * `undefined` where a component expected a string. If that holds, translating
 * the rest is additive and can be done a screen at a time by somebody who is
 * not a programmer. If it does not, a partial table is a broken console.
 */

import { afterEach, describe, expect, it } from "vitest";
import { uploadLimitLabel } from "@ds/domain";
import { currentLanguage, overlay } from "./language.js";
import { german } from "./de.js";
import { en } from "./en.js";

// The one ambient store this file touches, cleared after every case (§9.8).
afterEach(() => window.localStorage.clear());

const GERMAN = {
  nav: { courses: "Fortbildungen", back: "Zurück" },
  quiz: { title: "Lernerfolgskontrolle" },
  points: (n: number): string => `${n} ${n === 1 ? "Punkt" : "Punkte"}`,
  titles: ["Dr. med.", "Prof."],
};

describe("overlay", () => {
  it("uses the translation where there is one", () => {
    expect(overlay(GERMAN, { nav: { courses: "Courses" } }).nav.courses).toBe("Courses");
  });

  it("falls back to German for a key nobody has translated", () => {
    // Legible to the operator this console is for. The alternative to a
    // fallback is a key name on screen.
    expect(overlay(GERMAN, { nav: { courses: "Courses" } }).nav.back).toBe("Zurück");
  });

  it("falls back for a whole section that is absent", () => {
    expect(overlay(GERMAN, { nav: { courses: "Courses" } }).quiz.title).toBe(
      "Lernerfolgskontrolle",
    );
  });

  it("treats an empty translation as untranslated", () => {
    // A blank entry in a translation file is somebody part-way through, not a
    // decision that this label should be empty.
    expect(overlay(GERMAN, { nav: { back: "" } }).nav.back).toBe("Zurück");
  });

  it("keeps functions, where agreement is decided", () => {
    // Same rule the learner widget's copy overrides follow: a table cannot
    // express "1 Punkt" against "4 Punkten", so translating those means writing
    // an English function and is deliberately outside this mechanism.
    const applied = overlay(GERMAN, { points: "translated" });
    expect(applied.points(1)).toBe("1 Punkt");
    expect(applied.points(4)).toBe("4 Punkte");
  });

  it("never introduces a key the console was not compiled against", () => {
    const applied = overlay(GERMAN, { nav: { invented: "x" } });
    expect(Object.keys(applied.nav)).toEqual(["courses", "back"]);
  });

  it("survives a translation that is not an object at all", () => {
    expect(overlay(GERMAN, "nonsense").nav.courses).toBe("Fortbildungen");
    expect(overlay(GERMAN, null).nav.courses).toBe("Fortbildungen");
  });

  it("never mutates the German table", () => {
    overlay(GERMAN, { nav: { courses: "Courses" } });
    expect(GERMAN.nav.courses).toBe("Fortbildungen");
  });
});

describe("the language a console starts in", () => {
  it("is German unless somebody has chosen otherwise", () => {
    // The first client is German and so is the layout the copy was checked
    // against. English is opt-in.
    window.localStorage.clear();
    expect(currentLanguage()).toBe("de");
  });

  it("remembers the choice across a reload", () => {
    // Which is the whole mechanism: the language is read once at import, so
    // the choice has to outlive the page that made it.
    window.localStorage.setItem("ds-admin-language", "en");
    expect(currentLanguage()).toBe("en");
  });

  it("ignores a stored value it does not recognise", () => {
    // A hand-edited storage entry, or a language removed later. German is the
    // answer rather than a console rendering nothing.
    window.localStorage.setItem("ds-admin-language", "fr");
    expect(currentLanguage()).toBe("de");
  });
});

/**
 * The real tables, not a fixture (P88-03).
 *
 * Every case above drives `overlay` with two small objects, which is the right
 * way to test a merge rule and proves nothing about the file that ships. These
 * three are about `en.ts` itself — the §9.7 shape: a rule exercised
 * exhaustively, and nothing checking that what it is applied to is right.
 *
 * `scripts/i18n-coverage.mjs` counts coverage in CI and in `pnpm verify`. This
 * covers what a line count cannot: that the merged table is actually usable.
 */
describe("the English table that ships", () => {
  it("leaves nothing German on a screen an operator opens first", () => {
    /*
     * A spot check with teeth. These are the strings on the sign-in screen, the
     * navigation and the first error somebody meets — if the overlay is wired
     * up at all, these are English, and if it is not, every one of them is the
     * German fallback.
     */
    const merged = overlay(german, en);

    expect(merged.auth.signIn).toBe("Sign in");
    expect(merged.nav.courses).toBe("Courses");
    expect(merged.error.title).toBe("Something went wrong");
    expect(merged.courses.title).toBe("Courses");
    expect(merged.media.nav).toBe("Media library");
  });

  it("keeps the accreditation vocabulary, which is not ours to translate", () => {
    /*
     * CLAUDE.md §7. These words appear verbatim on the Anerkennungsbescheid and
     * in the EIV-FOBI interface, so an operator reconciling a screen against
     * the paperwork needs the same token in both. "Learning assessment" is a
     * translation of Lernerfolgskontrolle and is not the name of the thing.
     */
    const merged = overlay(german, en);

    expect(merged.quiz.title).toBe("Lernerfolgskontrolle");
    expect(merged.course.certificate).toBe("Teilnahmebescheinigung");
    expect(merged.learners.submission).toBe("Punktemeldung");
    expect(merged.participants.columnEfn).toBe("EFN");
  });

  it("keeps every plural-aware sentence in code rather than translating it away", () => {
    /*
     * `overlay` refuses to replace a function, and this is why it matters here:
     * German plural rules live in `de.ts` because "1 Punkt" and "4 Punkten" are
     * a grammar problem rather than a copy problem. An English table that
     * flattened one to a string would silently lose the singular.
     */
    const merged = overlay(german, en);

    expect(typeof merged.media.usedBy).toBe("function");
    expect(merged.media.usedBy(1)).toContain("1 Inhalt ");
    expect(typeof merged.courses.completedOf).toBe("function");
  });
});

describe("the stated upload ceiling", () => {
  /*
   * P133-01, and the whole point of the ticket: **what the screen says the
   * limit is must be what the server enforces.**
   *
   * The console said "MP4 or WebM, up to 2 GB" while the API accepted 5 GB,
   * because the number was a literal in four places and `UPLOAD_MAX_BYTES.video`
   * had moved underneath all of them (§9.3). The client found it by reading the
   * screen, which is the instrument this test replaces.
   *
   * Asserted against `uploadLimitLabel` rather than against "5 GB": a test that
   * pinned the string would need editing on the next change, and a test you have
   * to edit to keep green is one somebody eventually edits without thinking.
   */
  const limit = uploadLimitLabel("video");

  it("states the API's own ceiling, in German", () => {
    expect(german.uploads.videoUploadHint).toContain(limit);
    expect(german.media.uploadHints.video).toContain(limit);
  });

  it("states it in English too", () => {
    const merged = overlay(german, en);

    expect(merged.uploads.videoUploadHint).toContain(limit);
    expect(merged.media.uploadHints.video).toContain(limit);
    // Still English, not silently fallen back to German — the reason these are
    // interpolated strings rather than functions of the table.
    expect(merged.uploads.videoUploadHint).toContain("MP4 or WebM");
  });

  it("states no other size, which is how the 2 GB survived", () => {
    /*
     * The assertions above pass on a hint reading "up to 5 GB (formerly 2 GB)".
     * This one is what makes them evidence: exactly one size claim per hint, and
     * it is the derived one.
     */
    const merged = overlay(german, en);
    const hints = [
      german.uploads.videoUploadHint,
      german.media.uploadHints.video,
      merged.uploads.videoUploadHint,
      merged.media.uploadHints.video,
    ];

    for (const hint of hints) {
      // Simple and linear on purpose: a nested quantifier here is flagged as
      // catastrophic-backtracking bait, and the shape being matched is just
      // "digits, optional decimal, a unit".
      expect(hint.match(/\d+[.,]?\d* ?[KMG]B/gu)).toEqual([limit]);
    }
  });
});
