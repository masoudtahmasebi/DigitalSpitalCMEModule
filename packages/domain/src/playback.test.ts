/**
 * The player's arithmetic.
 *
 * Three of these are here because the wrong version is invisible: a scrub bar
 * that ignores its own left offset, a coverage overlay that stacks instead of
 * merging, and a duration that is `NaN` on first paint. None would fail a
 * rendering test, and all three are wrong on every video, every time.
 */

import { describe, expect, it } from "vitest";
import { MAX_PLAYBACK_RATE } from "./watch.js";
import {
  bufferedBars,
  clampVolume,
  coverageBars,
  nextPlaybackRate,
  nudgePositionSec,
  PLAYBACK_RATES,
  positionFraction,
  remainingSec,
  seekFraction,
  seekPositionSec,
  watchedCoverageBars,
} from "./playback.js";

describe("remainingSec", () => {
  it("is the gap to the end", () => {
    expect(remainingSec(875, 1545)).toBe(670);
  });

  it("is zero at and past the end", () => {
    expect(remainingSec(1545, 1545)).toBe(0);
    // A media element can report a position a hair past its duration.
    expect(remainingSec(1546, 1545)).toBe(0);
  });

  it("survives the NaN duration a media element reports before metadata loads", () => {
    // The panel renders before `loadedmetadata` on every single view, so this
    // is the first thing every learner would otherwise see.
    expect(remainingSec(0, Number.NaN)).toBe(0);
    expect(remainingSec(Number.NaN, 1545)).toBe(1545);
    expect(remainingSec(10, Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("positionFraction", () => {
  it("maps position onto 0–1", () => {
    expect(positionFraction(0, 100)).toBe(0);
    expect(positionFraction(25, 100)).toBe(0.25);
    expect(positionFraction(100, 100)).toBe(1);
  });

  it("clamps rather than overflowing the bar", () => {
    expect(positionFraction(150, 100)).toBe(1);
    expect(positionFraction(-5, 100)).toBe(0);
    expect(positionFraction(10, 0)).toBe(0);
    expect(positionFraction(10, Number.NaN)).toBe(0);
  });
});

describe("seekFraction", () => {
  it("measures from the track's own left edge, not the viewport's", () => {
    // The bug this exists to prevent: forgetting `rect.left` sends every seek
    // a fixed distance from where the learner clicked, on every video.
    expect(seekFraction(150, { left: 100, width: 200 })).toBe(0.25);
    expect(seekFraction(100, { left: 100, width: 200 })).toBe(0);
    expect(seekFraction(300, { left: 100, width: 200 })).toBe(1);
  });

  it("clamps a drag that left the element", () => {
    expect(seekFraction(50, { left: 100, width: 200 })).toBe(0);
    expect(seekFraction(400, { left: 100, width: 200 })).toBe(1);
  });

  it("returns zero for a track with no width rather than dividing by it", () => {
    expect(seekFraction(150, { left: 100, width: 0 })).toBe(0);
  });
});

describe("seekPositionSec", () => {
  it("is the inverse of positionFraction", () => {
    expect(seekPositionSec(0.25, 1600)).toBe(400);
    expect(seekPositionSec(0, 1600)).toBe(0);
    expect(seekPositionSec(1, 1600)).toBe(1600);
  });

  it("refuses to produce a position in a media of unknown length", () => {
    expect(seekPositionSec(0.5, Number.NaN)).toBe(0);
    expect(seekPositionSec(0.5, 0)).toBe(0);
  });
});

describe("nudgePositionSec", () => {
  it("moves by the step in both directions", () => {
    expect(nudgePositionSec(100, 5, 200)).toBe(105);
    expect(nudgePositionSec(100, -10, 200)).toBe(90);
  });

  it("stops at both ends", () => {
    expect(nudgePositionSec(198, 5, 200)).toBe(200);
    expect(nudgePositionSec(2, -10, 200)).toBe(0);
  });

  it("still moves forward when the duration is not yet known", () => {
    // Arrow keys pressed during buffering should not be swallowed.
    expect(nudgePositionSec(10, 5, Number.NaN)).toBe(15);
    expect(nudgePositionSec(2, -10, Number.NaN)).toBe(0);
  });
});

describe("clampVolume", () => {
  it("keeps volume inside what a media element accepts", () => {
    // Assigning outside 0–1 throws in the browser.
    expect(clampVolume(1.4)).toBe(1);
    expect(clampVolume(-0.2)).toBe(0);
    expect(clampVolume(0.5)).toBe(0.5);
    expect(clampVolume(Number.NaN)).toBe(0);
  });
});

describe("nextPlaybackRate", () => {
  it("advances through the menu and wraps", () => {
    expect(nextPlaybackRate(1)).toBe(1.25);
    expect(nextPlaybackRate(2)).toBe(0.75);
  });

  it("returns to normal speed from a rate the menu does not offer", () => {
    expect(nextPlaybackRate(3)).toBe(1);
  });

  it("offers nothing the server would refuse to credit", () => {
    // The API rejects a report claiming more media seconds than wall-clock
    // allows. A rate above 2× would silently cost the learner watch time.
    expect(Math.max(...PLAYBACK_RATES)).toBeLessThanOrEqual(2);
  });
});

describe("coverageBars", () => {
  it("turns segments into percentages of the track", () => {
    expect(coverageBars([{ startSec: 0, endSec: 50 }], 200)).toEqual([
      { startPercent: 0, widthPercent: 25 },
    ]);
  });

  it("merges overlaps, so re-watching does not look like more progress", () => {
    // Drawing the raw segments stacks translucent blocks wherever a learner
    // rewound, making a thrice-watched passage darker than a once-watched one
    // — the opposite of what union coverage means.
    const bars = coverageBars(
      [
        { startSec: 0, endSec: 60 },
        { startSec: 30, endSec: 90 },
        { startSec: 50, endSec: 70 },
      ],
      200,
    );
    expect(bars).toEqual([{ startPercent: 0, widthPercent: 45 }]);
  });

  it("keeps genuine gaps apart", () => {
    expect(
      coverageBars(
        [
          { startSec: 0, endSec: 20 },
          { startSec: 100, endSec: 120 },
        ],
        200,
      ),
    ).toEqual([
      { startPercent: 0, widthPercent: 10 },
      { startPercent: 50, widthPercent: 10 },
    ]);
  });

  it("clips past the end instead of dropping the passage", () => {
    // A re-encode that shortened the video by a second should not erase the
    // whole last passage from the bar.
    expect(coverageBars([{ startSec: 180, endSec: 260 }], 200)).toEqual([
      { startPercent: 90, widthPercent: 10 },
    ]);
  });

  it("draws nothing when there is nothing to draw", () => {
    expect(coverageBars([], 200)).toEqual([]);
    expect(coverageBars([{ startSec: 0, endSec: 50 }], 0)).toEqual([]);
    expect(coverageBars([{ startSec: 0, endSec: 50 }], Number.NaN)).toEqual([]);
    // Entirely beyond the media.
    expect(coverageBars([{ startSec: 300, endSec: 400 }], 200)).toEqual([]);
  });
});

describe("watchedCoverageBars", () => {
  it("fills the tail once nothing is outstanding", () => {
    // A ten-second video watched to 9.2 s: the gate says 100 % (P93-01), so a
    // bar with a third of its width unfilled next to the words "100 %
    // angesehen" is the screen disagreeing with the answer.
    expect(watchedCoverageBars([{ startSec: 0, endSec: 9.2 }], 10)).toEqual([
      { startPercent: 0, widthPercent: 100 },
    ]);
  });

  it("leaves the tail alone while something is still outstanding", () => {
    // Stopped at 6 s of ten, one second short of the requirement: the bar must
    // still show a gap, because there is one.
    expect(watchedCoverageBars([{ startSec: 0, endSec: 6 }], 10)).toEqual([
      { startPercent: 0, widthPercent: 60 },
    ]);
  });

  it("does not close a hole in the middle by filling the end", () => {
    // The case that would make this a lie: everything after the hole is
    // watched, so the last bar reaches the credited end — and the video is
    // still not complete.
    expect(
      watchedCoverageBars(
        [
          { startSec: 0, endSec: 4 },
          { startSec: 6, endSec: 10 },
        ],
        10,
      ),
    ).toEqual([
      { startPercent: 0, widthPercent: 40 },
      { startPercent: 60, widthPercent: 40 },
    ]);
  });

  it("draws nothing for a video nobody has watched", () => {
    expect(watchedCoverageBars([], 10)).toEqual([]);
    expect(watchedCoverageBars([{ startSec: 0, endSec: 5 }], 0)).toEqual([]);
  });

  it("agrees with coverageBars on a video with no tail to close", () => {
    const segments = [{ startSec: 0, endSec: 100 }];
    expect(watchedCoverageBars(segments, 100)).toEqual(coverageBars(segments, 100));
  });
});

describe("bufferedBars", () => {
  it("takes the pairs a TimeRanges converts to", () => {
    expect(
      bufferedBars(
        [
          [0, 40],
          [100, 140],
        ],
        200,
      ),
    ).toEqual([
      { startPercent: 0, widthPercent: 20 },
      { startPercent: 50, widthPercent: 20 },
    ]);
  });

  it("is empty before anything has buffered", () => {
    expect(bufferedBars([], 200)).toEqual([]);
  });
});

describe("the speed menu and the wall-clock budget agree (P153-01)", () => {
  /*
   * The two used to disagree silently: the menu offered 2× and the server
   * credited 1×, so the faster a physician watched the less they were given.
   * Nothing failed — the seconds were simply dropped — which is why this is a
   * test and not a comment. Adding a rate the budget will not credit now costs
   * a red run rather than somebody's CME point.
   */
  it("offers no rate the server would refuse to credit", () => {
    const tooFast = PLAYBACK_RATES.filter((rate) => rate > MAX_PLAYBACK_RATE);

    expect(
      tooFast,
      `the speed menu offers ${tooFast.join(", ")}×, above the ${String(MAX_PLAYBACK_RATE)}× ` +
        "the wall-clock budget credits — every second watched at those rates is discarded",
    ).toEqual([]);
  });

  it("offers the fastest rate the budget allows, so the cap is not accidental", () => {
    expect(Math.max(...PLAYBACK_RATES)).toBe(MAX_PLAYBACK_RATE);
  });
});
