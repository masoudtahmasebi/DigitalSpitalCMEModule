/**
 * The German duration copy.
 *
 * Worth testing for the pluralisation boundaries and for the two cases a naive
 * implementation gets wrong: exactly one hour with no minutes, and a duration
 * shorter than a minute that must still say something.
 */

import { describe, expect, it } from "vitest";
import { clockTime, germanDuration, germanMinutesAndSeconds } from "./duration.js";

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

  it("stays in minutes past an hour, because it states a length", () => {
    expect(germanMinutesAndSeconds(5400)).toBe("90:00 Min.");
  });
});

describe("clockTime", () => {
  it("renders the layout's `14:35 / 25:45` positions", () => {
    expect(clockTime(875)).toBe("14:35");
    expect(clockTime(1545)).toBe("25:45");
  });

  it("pads the seconds but not a leading single-digit minute", () => {
    expect(clockTime(65)).toBe("1:05");
    expect(clockTime(9)).toBe("0:09");
    expect(clockTime(0)).toBe("0:00");
  });

  it("rolls into hours, unlike germanMinutesAndSeconds", () => {
    // The one behavioural difference between the two, and the reason both
    // exist: a clock beside a scrub bar reads 1:30:00, a stated length reads
    // 90:00 Min.
    expect(clockTime(5400)).toBe("1:30:00");
    expect(clockTime(3661)).toBe("1:01:01");
    expect(clockTime(3600)).toBe("1:00:00");
  });

  it("treats nonsense input as zero rather than rendering NaN", () => {
    // `video.duration` is NaN until metadata loads, and the player reads it on
    // the very first render. A "NaN:NaN" beside the scrub bar would be the
    // first thing every learner saw.
    expect(clockTime(Number.NaN)).toBe("0:00");
    expect(clockTime(Number.POSITIVE_INFINITY)).toBe("0:00");
    expect(clockTime(-5)).toBe("0:00");
  });
});
