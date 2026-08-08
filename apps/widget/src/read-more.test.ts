/**
 * Where prose is cut for its collapsed state (#63).
 *
 * The behaviour worth pinning is not "does slice work" — it is the two things
 * that decide whether the fold reads as a fold or as a bug:
 *
 * - text shorter than the limit is **not** truncated, so the component knows
 *   not to draw a toggle that would do nothing;
 * - the cut lands on a word boundary, because "…psychopharmakolog Mehr lesen…"
 *   reads as a rendering fault rather than as a fold.
 */

import { describe, expect, it } from "vitest";
import { BIOGRAPHY_LIMIT, DESCRIPTION_LIMIT, readMoreCut } from "./read-more.js";

describe("text that fits", () => {
  it("is returned whole, and marked as not truncated", () => {
    // The bug this replaces: `line-clamp` clips nothing when the text is
    // already short, so the toggle appeared anyway and clicking it changed the
    // page in no way.
    const short = "Eine kurze Beschreibung.";

    expect(readMoreCut(short, DESCRIPTION_LIMIT)).toEqual({
      head: short,
      truncated: false,
    });
  });

  it("is not truncated at exactly the limit", () => {
    expect(readMoreCut("a".repeat(20), 20).truncated).toBe(false);
    expect(readMoreCut("a".repeat(21), 20).truncated).toBe(true);
  });

  it("loses surrounding whitespace rather than reporting a cut", () => {
    expect(readMoreCut("   Kurz.   ", 10)).toEqual({ head: "Kurz.", truncated: false });
  });
});

describe("text that does not fit", () => {
  const long =
    "Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy " +
    "eirmod tempor invidunt ut labore et dolore magna aliquyam erat.";

  it("cuts on a word boundary", () => {
    const cut = readMoreCut(long, 30);

    expect(cut.truncated).toBe(true);
    expect(cut.head.length).toBeLessThanOrEqual(30);
    // The whole point: the head is a prefix of the text ending at a word.
    expect(long.startsWith(cut.head)).toBe(true);
    expect(cut.head.endsWith(" ")).toBe(false);
  });

  it("does not leave punctuation hanging in front of the toggle", () => {
    // "…dolor sit amet, Mehr lesen…" — the comma belongs to a clause that is
    // no longer there.
    const cut = readMoreCut("Lorem ipsum dolor sit amet, consetetur elitr", 27);

    expect(cut.head).toBe("Lorem ipsum dolor sit amet");
  });

  it("cuts hard when the first word is longer than the limit", () => {
    // No boundary exists. Showing the whole word would be showing the whole
    // text, which is the one thing the fold must not do.
    const cut = readMoreCut("Arzneimittelwechselwirkungen sind komplex", 10);

    expect(cut).toEqual({ head: "Arzneimitt", truncated: true });
  });
});

describe("the two limits", () => {
  it("give the narrower biography column the smaller one", () => {
    // Not a tautology: they were one constant, and one column is visibly
    // narrower than the other. A biography clamped at the description's limit
    // runs to six lines where the layout draws three.
    expect(BIOGRAPHY_LIMIT).toBeLessThan(DESCRIPTION_LIMIT);
  });
});
