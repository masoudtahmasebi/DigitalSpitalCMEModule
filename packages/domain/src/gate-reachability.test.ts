/**
 * The reported case is the first test: a 45-second recording behind a 25:24
 * authored length, at MEDICE's gate of 100 %.
 */

import { describe, expect, it } from "vitest";
import { lengthsAgree, mediaLengthVerdict } from "./gate-reachability.js";

describe("mediaLengthVerdict", () => {
  describe("the gate cannot be reached", () => {
    it("names the shortfall for the course that was reported", () => {
      // P75: durationSec 1524 inherited from the seed, a 45 s file uploaded
      // over it, requiredWatchPercent 100. "0 % der Fortbildung absolviert"
      // after watching every frame.
      const verdict = mediaLengthVerdict({
        configuredDurationSec: 1524,
        measuredDurationSec: 45,
        requiredWatchPercent: 100,
      });

      expect(verdict.kind).toBe("unreachable");
      if (verdict.kind !== "unreachable") return;
      expect(verdict.attainablePercent).toBe(2);
      expect(verdict.shortfallSec).toBe(1479);
    });

    it("is judged against the course's gate, not against 100", () => {
      // Half the file missing is fatal at 100 % and fine at 50 %.
      const short = { configuredDurationSec: 600, measuredDurationSec: 300 };
      expect(mediaLengthVerdict({ ...short, requiredWatchPercent: 100 }).kind).toBe(
        "unreachable",
      );
      expect(mediaLengthVerdict({ ...short, requiredWatchPercent: 50 }).kind).toBe("ok");
    });

    it("catches the boundary where the gate becomes impossible by one percent", () => {
      // 80 % of 100 s is 80 s. A 79 s file floors to 79 %.
      expect(
        mediaLengthVerdict({
          configuredDurationSec: 100,
          measuredDurationSec: 79,
          requiredWatchPercent: 80,
        }).kind,
      ).toBe("unreachable");
      expect(
        mediaLengthVerdict({
          configuredDurationSec: 100,
          measuredDurationSec: 80,
          requiredWatchPercent: 80,
        }).kind,
      ).toBe("ok");
    });
  });

  describe("the endpoint tolerance", () => {
    it("does not call a file half a second short misconfigured", () => {
      // The same half second `watchedSecondsWithin` snaps. Warning here would
      // put a permanent error on a course that completes perfectly well.
      expect(
        mediaLengthVerdict({
          configuredDurationSec: 1545,
          measuredDurationSec: 1544.6,
          requiredWatchPercent: 100,
        }).kind,
      ).toBe("ok");
    });

    it("still refuses a file a full second short at 100 %", () => {
      expect(
        mediaLengthVerdict({
          configuredDurationSec: 1545,
          measuredDurationSec: 1543,
          requiredWatchPercent: 100,
        }).kind,
      ).toBe("unreachable");
    });
  });

  describe("the quieter mistake, in the other direction", () => {
    it("reports a file materially longer than its authored length", () => {
      // Nobody is blocked, so no learner will ever report this — and the gate
      // credits a complete viewing after 600 s of a 900 s recording.
      const verdict = mediaLengthVerdict({
        configuredDurationSec: 600,
        measuredDurationSec: 900,
        requiredWatchPercent: 100,
      });
      expect(verdict.kind).toBe("overrun");
      if (verdict.kind !== "overrun") return;
      expect(verdict.excessSec).toBe(300);
    });

    it("ignores trailing black and container rounding", () => {
      for (const measured of [600.4, 602, 609]) {
        expect(
          mediaLengthVerdict({
            configuredDurationSec: 600,
            measuredDurationSec: measured,
            requiredWatchPercent: 100,
          }).kind,
        ).toBe("ok");
      }
    });
  });

  describe("it stays silent when it cannot be sure", () => {
    it("says nothing without a measured length", () => {
      // The ordinary case for a CDN that sends no CORS headers. A warning here
      // would appear on working courses and teach everyone to ignore it.
      for (const measured of [null, undefined, 0, -1, Number.NaN]) {
        expect(
          mediaLengthVerdict({
            configuredDurationSec: 1524,
            measuredDurationSec: measured,
            requiredWatchPercent: 100,
          }).kind,
        ).toBe("ok");
      }
    });

    it("says nothing without an authored length", () => {
      for (const configured of [null, undefined, 0, Number.NaN]) {
        expect(
          mediaLengthVerdict({
            configuredDurationSec: configured,
            measuredDurationSec: 45,
            requiredWatchPercent: 100,
          }).kind,
        ).toBe("ok");
      }
    });

    it("says nothing when there is no watch gate at all", () => {
      // A lesson outside the gate cannot be blocked by one.
      expect(
        mediaLengthVerdict({
          configuredDurationSec: 1524,
          measuredDurationSec: 45,
          requiredWatchPercent: 0,
        }).kind,
      ).toBe("ok");
    });

    it("treats a nonsensical percentage as no gate rather than throwing", () => {
      expect(
        mediaLengthVerdict({
          configuredDurationSec: 1524,
          measuredDurationSec: 45,
          requiredWatchPercent: Number.NaN,
        }).kind,
      ).toBe("ok");
    });

    it("clamps a percentage above 100 instead of demanding the impossible of a correct file", () => {
      // A file exactly as long as its authored length must never be called
      // unreachable, whatever nonsense the percentage holds.
      expect(
        mediaLengthVerdict({
          configuredDurationSec: 600,
          measuredDurationSec: 600,
          requiredWatchPercent: 150,
        }).kind,
      ).toBe("ok");
    });
  });
});

describe("lengthsAgree", () => {
  it("reports the stored figure that blocked the reported course", () => {
    expect(lengthsAgree(1524, 45)).toBe(false);
  });

  it("forgives what a container cannot report exactly", () => {
    expect(lengthsAgree(1545, 1544.6)).toBe(true);
    expect(lengthsAgree(1545, 1545.5)).toBe(true);
    expect(lengthsAgree(1545, 1544)).toBe(false);
  });

  it("answers the operator's question, not the learner's", () => {
    // 590 s stored as 600 on a course gated at 80 % is completable today and
    // still a wrong number. `mediaLengthVerdict` says "ok" here by design.
    expect(lengthsAgree(600, 590)).toBe(false);
    expect(
      mediaLengthVerdict({
        configuredDurationSec: 600,
        measuredDurationSec: 590,
        requiredWatchPercent: 80,
      }).kind,
    ).toBe("ok");
  });

  it("has nothing to say about a content still being authored", () => {
    for (const stored of [null, undefined, 0, Number.NaN]) {
      expect(lengthsAgree(stored, 45)).toBe(true);
    }
    for (const measured of [null, undefined, 0, Number.NaN]) {
      expect(lengthsAgree(1524, measured)).toBe(true);
    }
  });
});
