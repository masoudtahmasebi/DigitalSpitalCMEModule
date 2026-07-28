/**
 * The German duration copy.
 *
 * Worth testing for the pluralisation boundaries and for the two cases a naive
 * implementation gets wrong: exactly one hour with no minutes, and a duration
 * shorter than a minute that must still say something.
 */

import { describe, expect, it } from "vitest";
import { germanDuration, germanMinutesAndSeconds } from "./duration.js";

describe("germanDuration", () => {
  it("uses the singular for exactly one", () => {
    expect(germanDuration(3600)).toBe("1 Stunde");
    expect(germanDuration(60)).toBe("1 Minute");
  });

  it("uses the plural otherwise", () => {
    expect(germanDuration(7200)).toBe("2 Stunden");
    expect(germanDuration(120)).toBe("2 Minuten");
  });

  it("joins hours and minutes", () => {
    expect(germanDuration(9000)).toBe("2 Stunden 30 Minuten");
  });

  it("omits a zero part rather than saying '0 Minuten'", () => {
    expect(germanDuration(7200)).toBe("2 Stunden");
  });

  it("rounds down, so a course never reads as longer than it is", () => {
    expect(germanDuration(9059)).toBe("2 Stunden 30 Minuten");
  });

  it("still says something for under a minute", () => {
    // An empty string would drop the part from the card's metadata line and
    // misalign its separators.
    expect(germanDuration(30)).toBe("unter 1 Minute");
    expect(germanDuration(0)).toBe("unter 1 Minute");
  });

  it("treats nonsense input as zero rather than rendering NaN", () => {
    expect(germanDuration(-10)).toBe("unter 1 Minute");
    expect(germanDuration(Number.NaN)).toBe("unter 1 Minute");
  });
});

describe("germanMinutesAndSeconds", () => {
  it("pads the seconds", () => {
    expect(germanMinutesAndSeconds(1524)).toBe("25:24 Min.");
    expect(germanMinutesAndSeconds(65)).toBe("1:05 Min.");
    expect(germanMinutesAndSeconds(9)).toBe("0:09 Min.");
  });
});
