import { describe, expect, it } from "vitest";
import {
  isSeekAllowed,
  maxWatchedPosition,
  mergeWatchedSegments,
  validateSegments,
  watchedPercent,
  watchedSeconds,
} from "./watch.js";

describe("mergeWatchedSegments", () => {
  it("merges overlapping segments", () => {
    expect(
      mergeWatchedSegments([
        { startSec: 0, endSec: 30 },
        { startSec: 20, endSec: 50 },
      ]),
    ).toEqual([{ startSec: 0, endSec: 50 }]);
  });

  it("merges segments that touch at a point, since that is continuous viewing", () => {
    expect(
      mergeWatchedSegments([
        { startSec: 0, endSec: 10 },
        { startSec: 10, endSec: 20 },
      ]),
    ).toEqual([{ startSec: 0, endSec: 20 }]);
  });

  it("keeps genuinely disjoint segments apart", () => {
    expect(
      mergeWatchedSegments([
        { startSec: 0, endSec: 10 },
        { startSec: 20, endSec: 30 },
      ]),
    ).toEqual([
      { startSec: 0, endSec: 10 },
      { startSec: 20, endSec: 30 },
    ]);
  });

  it("absorbs a segment fully contained in another", () => {
    expect(
      mergeWatchedSegments([
        { startSec: 0, endSec: 100 },
        { startSec: 20, endSec: 30 },
      ]),
    ).toEqual([{ startSec: 0, endSec: 100 }]);
  });

  it("is order independent", () => {
    const forward = mergeWatchedSegments([
      { startSec: 0, endSec: 10 },
      { startSec: 5, endSec: 20 },
    ]);
    const reverse = mergeWatchedSegments([
      { startSec: 5, endSec: 20 },
      { startSec: 0, endSec: 10 },
    ]);
    expect(forward).toEqual(reverse);
  });

  it("discards malformed segments rather than propagating them", () => {
    expect(
      mergeWatchedSegments([
        { startSec: 10, endSec: 5 },
        { startSec: -5, endSec: 10 },
        { startSec: 3, endSec: 3 },
        { startSec: Number.NaN, endSec: 10 },
      ]),
    ).toEqual([]);
  });
});

describe("watchedPercent", () => {
  it("counts the union, not the furthest position reached", () => {
    // The whole point of the package: a learner who jumped to the end has a max
    // position of 100 but has watched 10 % of the content.
    const scrubbedToEnd = [
      { startSec: 0, endSec: 10 },
      { startSec: 99, endSec: 100 },
    ];
    expect(maxWatchedPosition(scrubbedToEnd)).toBe(100);
    expect(watchedPercent(scrubbedToEnd, 100)).toBe(11);
  });

  it("does not inflate when the same interval is re-watched", () => {
    const once = watchedPercent([{ startSec: 0, endSec: 50 }], 100);
    const thrice = watchedPercent(
      [
        { startSec: 0, endSec: 50 },
        { startSec: 0, endSec: 50 },
        { startSec: 10, endSec: 40 },
      ],
      100,
    );
    expect(once).toBe(50);
    expect(thrice).toBe(50);
  });

  it("never exceeds 100", () => {
    expect(watchedPercent([{ startSec: 0, endSec: 100 }], 100)).toBe(100);
  });

  it("floors rather than rounds, so 99.6 %% coverage never reports as complete", () => {
    // 996 of 1000 seconds. Rounding would report 100 and complete a video with
    // four unwatched seconds in it at MEDICE's 100 %% requirement.
    expect(watchedPercent([{ startSec: 0, endSec: 996 }], 1000)).toBe(99);
  });

  it("reports exactly 100 only for full coverage", () => {
    expect(watchedPercent([{ startSec: 0, endSec: 1000 }], 1000)).toBe(100);
    expect(watchedPercent([{ startSec: 0, endSec: 999.9 }], 1000)).toBe(99);
  });

  it("handles the 80 %% threshold boundary exactly", () => {
    expect(watchedPercent([{ startSec: 0, endSec: 80 }], 100)).toBe(80);
    expect(watchedPercent([{ startSec: 0, endSec: 79 }], 100)).toBe(79);
  });

  it("returns 0 for a zero or missing duration rather than dividing by zero", () => {
    expect(watchedPercent([{ startSec: 0, endSec: 10 }], 0)).toBe(0);
    expect(watchedPercent([], 100)).toBe(0);
  });

  it("sums disjoint segments", () => {
    expect(
      watchedSeconds([
        { startSec: 0, endSec: 10 },
        { startSec: 20, endSec: 30 },
      ]),
    ).toBe(20);
  });
});

describe("isSeekAllowed", () => {
  const watched = [{ startSec: 0, endSec: 100 }];

  it("allows seeking backwards", () => {
    expect(isSeekAllowed(watched, 10)).toBe(true);
  });

  it("allows seeking within tolerance of the furthest point reached", () => {
    expect(isSeekAllowed(watched, 104, 5)).toBe(true);
  });

  it("refuses a forward seek beyond tolerance", () => {
    expect(isSeekAllowed(watched, 500, 5)).toBe(false);
  });

  it("refuses a seek on an unwatched video", () => {
    expect(isSeekAllowed([], 500)).toBe(false);
  });

  it("refuses a negative target", () => {
    expect(isSeekAllowed(watched, -1)).toBe(false);
  });
});

describe("validateSegments", () => {
  it("rejects a whole video claimed in one call", () => {
    // The attack this exists to stop: post [0, duration] once and complete
    // any video instantly. The interval is well-formed, so only comparing it
    // against elapsed real time reveals it.
    const result = validateSegments([{ startSec: 0, endSec: 1500 }], {
      durationSec: 1500,
      elapsedWallClockSec: 30,
    });

    expect(result.accepted).toEqual([]);
    expect(result.rejected[0]?.reason).toBe("faster_than_wallclock");
  });

  it("accepts a plausible heartbeat", () => {
    const result = validateSegments([{ startSec: 0, endSec: 30 }], {
      durationSec: 1500,
      elapsedWallClockSec: 30,
    });

    expect(result.accepted).toHaveLength(1);
    expect(result.rejected).toEqual([]);
  });

  it("allows slack for playback jitter", () => {
    const result = validateSegments([{ startSec: 0, endSec: 31 }], {
      durationSec: 1500,
      elapsedWallClockSec: 30,
      wallClockToleranceSec: 2,
    });

    expect(result.accepted).toHaveLength(1);
  });

  it("rejects a segment beyond the content duration", () => {
    const result = validateSegments([{ startSec: 0, endSec: 2000 }], {
      durationSec: 1500,
    });

    expect(result.rejected[0]?.reason).toBe("beyond_duration");
  });

  it("rejects reversed, negative and non-finite segments with distinct reasons", () => {
    const result = validateSegments(
      [
        { startSec: 50, endSec: 20 },
        { startSec: -5, endSec: -1 },
        { startSec: Number.POSITIVE_INFINITY, endSec: 10 },
      ],
      { durationSec: 1500 },
    );

    expect(result.rejected.map((r) => r.reason)).toEqual([
      "zero_or_reversed",
      "negative",
      "not_finite",
    ]);
  });

  it("applies the wall-clock budget across the whole batch, not per segment", () => {
    const result = validateSegments(
      [
        { startSec: 0, endSec: 20 },
        { startSec: 100, endSec: 120 },
      ],
      { durationSec: 1500, elapsedWallClockSec: 25, wallClockToleranceSec: 0 },
    );

    expect(result.accepted).toHaveLength(1);
    expect(result.rejected[0]?.reason).toBe("faster_than_wallclock");
  });

  it("skips the plausibility check when there is no previous report to measure against", () => {
    const result = validateSegments([{ startSec: 0, endSec: 1500 }], {
      durationSec: 1500,
    });

    expect(result.accepted).toHaveLength(1);
  });
});
