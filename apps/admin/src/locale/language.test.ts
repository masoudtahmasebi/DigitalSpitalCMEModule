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
import { currentLanguage, overlay } from "./language.js";

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
