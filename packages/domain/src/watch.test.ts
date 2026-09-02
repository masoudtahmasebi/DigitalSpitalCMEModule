import { describe, expect, it } from "vitest";
import type { WatchedSegment } from "./watch.js";
import { PLAYBACK_RATES } from "./playback.js";
import {
  creditedDurationSec,
  MAX_PLAYBACK_RATE,
  isSeekAllowed,
  maxWatchedPosition,
  mergeWatchedSegments,
  validateSegments,
  watchedPercent,
  uncoveredSpans,
  watchedSecondsWithin,
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
    // position of 103 but has watched 10 % of the content.
    //
    // 103 s of content, of which 100 are required — the last three are the tail
    // grace (P93-01), which is why the sliver at the far end credits nothing at
    // all here rather than the one per cent it used to. The property under test
    // is unchanged: reaching the end is not watching the middle.
    const scrubbedToEnd = [
      { startSec: 0, endSec: 10 },
      { startSec: 102, endSec: 103 },
    ];
    expect(maxWatchedPosition(scrubbedToEnd)).toBe(103);
    expect(watchedPercent(scrubbedToEnd, 103)).toBe(10);
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
    // 993 of the 997 credited seconds of a 1000 s video. Rounding would report
    // 100 and complete a video with four unwatched seconds in it at MEDICE's
    // 100 %% requirement.
    expect(watchedPercent([{ startSec: 0, endSec: 993 }], 1000)).toBe(99);
  });

  it("reports exactly 100 for full coverage", () => {
    expect(watchedPercent([{ startSec: 0, endSec: 1000 }], 1000)).toBe(100);
  });

  /**
   * The endpoint tolerance (P29-01).
   *
   * A `<video>` cannot be observed at exactly 0 and exactly `duration`: `play`
   * fires a fraction in and the last `timeupdate` lands a fraction short. A
   * learner who watched every frame of a real 25 s video reported
   * `[0.0007, 25]` — 99.997 %, floored to 99 — against a gate of 100. The gate
   * was not strict, it was unreachable.
   *
   * What must NOT change is the treatment of a hole: half a second at an
   * endpoint is the measuring instrument, four seconds anywhere is content.
   */
  describe("the endpoint tolerance", () => {
    it("credits a start a sliver past zero as the start", () => {
      expect(watchedPercent([{ startSec: 0.0007, endSec: 25 }], 25)).toBe(100);
    });

    it("credits an end a sliver short of the duration as the end", () => {
      expect(watchedPercent([{ startSec: 0, endSec: 999.9 }], 1000)).toBe(100);
    });

    it("credits both ends at once", () => {
      expect(watchedPercent([{ startSec: 0.3, endSec: 24.7 }], 25)).toBe(100);
    });

    it("stops at half a second at the start — a second short is a second short", () => {
      // The start keeps the half-second snap and nothing else: a video begins
      // where it begins, and a learner who joined a second in has missed a
      // second of content.
      //
      // The far end no longer has a half-second answer — `TAIL_GRACE_SEC`
      // governs it, and its own cases are in "the tail grace" below. That is
      // the client's rule, not a slackened tolerance: the *length* being
      // measured shrank, the union rule did not.
      expect(watchedPercent([{ startSec: 1, endSec: 1000 }], 1000)).toBe(99);
    });

    it("never closes a hole a person could go and watch", () => {
      // A one-second hole in the middle of a 1000 s video is content, and stays
      // content: the two ends are exact and the number still refuses to reach
      // 100. This is the case the tolerance must never be mistaken for.
      const withHole = watchedPercent(
        [
          { startSec: 0, endSec: 499.5 },
          { startSec: 500.5, endSec: 1000 },
        ],
        1000,
      );
      expect(withHole).toBe(99);
    });

    it("does forgive a hole below one playback sample, and says so both ways", () => {
      /*
       * A tenth of a second in the middle. Nobody can go and watch it, and
       * before P94-01 this sat at 99 %% with an empty "Diese Stellen fehlen
       * noch" list beside it — correct and unusable, which is P85-01's report
       * and CLAUDE.md §9.10.
       *
       * The tolerance is now a budget for the **whole** video rather than per
       * gap, so forgiving it here cannot be repeated a hundred times to skip
       * half the file.
       */
      const segments = [
        { startSec: 0, endSec: 499.95 },
        { startSec: 500.05, endSec: 1000 },
      ];
      expect(uncoveredSpans(mergeWatchedSegments(segments), 1000)).toEqual([]);
      expect(watchedPercent(segments, 1000)).toBe(100);
    });

    it("refuses to forgive many small holes that add up", () => {
      // The attack a per-gap tolerance would allow: every hole is under a
      // quarter second on its own, and together they are two seconds of
      // unwatched content.
      const segments = [];
      for (let start = 0; start < 100; start += 10) {
        segments.push({ startSec: start, endSec: start + 9.8 });
      }
      expect(uncoveredSpans(mergeWatchedSegments(segments), 100).length).toBeGreaterThan(
        0,
      );
      expect(watchedPercent(segments, 100)).toBeLessThan(100);
    });

    it("does not credit an unwatched course as complete", () => {
      // Nothing reported is nothing watched — the tolerance has no endpoints
      // to snap and must not invent them.
      expect(watchedPercent([], 25)).toBe(0);
      // And a single sliver near the start is still a sliver.
      expect(watchedPercent([{ startSec: 0, endSec: 0.4 }], 1000)).toBe(0);
    });
  });

  it("handles the 80 %% threshold boundary exactly", () => {
    expect(watchedPercent([{ startSec: 0, endSec: 80 }], 100)).toBe(80);
    expect(watchedPercent([{ startSec: 0, endSec: 79 }], 100)).toBe(79);
  });

  it("returns 0 for a zero or missing duration rather than dividing by zero", () => {
    expect(watchedPercent([{ startSec: 0, endSec: 10 }], 0)).toBe(0);
    expect(watchedPercent([], 100)).toBe(0);
  });

  it("sums disjoint segments, leaving the hole between them a hole", () => {
    // 0–10 and 20–30 of a 30 s video is twenty seconds watched, not thirty:
    // the ten-second gap is content the learner did not see, and the tail
    // grace does not touch a hole in the middle.
    const disjoint = [
      { startSec: 0, endSec: 10 },
      { startSec: 20, endSec: 30 },
    ];
    expect(watchedSecondsWithin(disjoint, 30)).toBe(20);
    expect(watchedPercent(disjoint, 30)).toBe(66);
  });

  it("never credits more seconds than the content has", () => {
    // The P68-02 property, pinned where the removed `watchedSeconds` used to be
    // asserted. That function returned the raw union with no cap, so segments
    // overrunning the duration — which a `<video>` reporting past its own end
    // produces — credited more than the file contains, and a course-level sum
    // of those figures disagreed with the per-content percentage.
    expect(watchedSecondsWithin([{ startSec: 0, endSec: 400 }], 300)).toBe(300);
    expect(watchedPercent([{ startSec: 0, endSec: 400 }], 300)).toBe(100);
  });
});

/**
 * The tail grace (P93-01).
 *
 * Reported twice, the second time with the number and the wording it produced:
 *
 * > _"now i have watched the complete video, it still says only `92 %
 * > angesehen` … there is also this `Diese Stellen fehlen noch: 0:09–0:10`"_
 *
 * Ten seconds of video, watched to the end, 92 %. These are the cases that
 * decide whether the client can finish a video, so each states the length, what
 * was watched, and what a person is told.
 */
describe("the tail grace", () => {
  it("completes the ten-second video the client watched to the end", () => {
    // The reported case exactly: the last `timeupdate` landed at 9.2 s.
    expect(watchedPercent([{ startSec: 0, endSec: 9.2 }], 10)).toBe(100);
    expect(uncoveredSpans([{ startSec: 0, endSec: 9.2 }], 10)).toEqual([]);
  });

  it("credits the whole video the moment the last three seconds begin", () => {
    expect(watchedPercent([{ startSec: 0, endSec: 7 }], 10)).toBe(100);
  });

  it("does not credit a video stopped before the tail", () => {
    // A second short of the requirement is a second short. The grace moves the
    // finish line; it does not remove it — and the number is six of ten
    // seconds seen, which is what the learner can check against the clock.
    expect(watchedPercent([{ startSec: 0, endSec: 6 }], 10)).toBe(60);
    expect(watchedPercent([{ startSec: 0, endSec: 6 }], 10)).toBeLessThan(100);
  });

  it("still refuses a scrub to the end", () => {
    // §4 invariant 5 is what the grace must not weaken: the seconds before the
    // tail have to be genuinely covered. The one second actually played is
    // credited, because it was — what a scrub cannot buy is the other nine.
    expect(watchedPercent([{ startSec: 9, endSec: 10 }], 10)).toBe(10);
    expect(watchedPercent([{ startSec: 1400, endSec: 1500 }], 1500)).toBe(6);
  });

  it("keeps a hole in the middle a hole", () => {
    // Eight of ten seconds seen, and the two unseen ones are inside the
    // requirement, so it is not complete however far the playhead reached.
    expect(
      watchedPercent(
        [
          { startSec: 0, endSec: 4 },
          { startSec: 6, endSec: 10 },
        ],
        10,
      ),
    ).toBe(80);
  });

  it("does not shrink a video shorter than the grace to nothing", () => {
    // The one outcome worse than the bug: a two-second clip credited to
    // somebody who watched none of it.
    expect(creditedDurationSec(2)).toBe(2);
    expect(watchedPercent([], 2)).toBe(0);
    expect(watchedPercent([{ startSec: 0, endSec: 1 }], 2)).toBe(50);
    expect(watchedPercent([{ startSec: 0, endSec: 2 }], 2)).toBe(100);
  });

  it("agrees with the list of gaps, in both directions", () => {
    /*
     * The property P94-01 is for, and the one the client was reading against:
     *
     *     watchedPercent === 100   ⟺   uncoveredSpans is empty
     *
     * Two screens draw these — the percentage beside the section title and the
     * "Diese Stellen fehlen noch" line under the player — and P68-02 was
     * exactly the state where one said finished and the other did not.
     */
    const cases: ReadonlyArray<readonly [readonly WatchedSegment[], number]> = [
      [[], 10],
      [[{ startSec: 0, endSec: 1 }], 10],
      [[{ startSec: 0, endSec: 6.9 }], 10],
      [[{ startSec: 0, endSec: 7 }], 10],
      [[{ startSec: 0, endSec: 10 }], 10],
      [[{ startSec: 9, endSec: 10 }], 10],
      [
        [
          { startSec: 0, endSec: 4 },
          { startSec: 6, endSec: 10 },
        ],
        10,
      ],
      [[{ startSec: 0, endSec: 1497 }], 1500],
      [[{ startSec: 0, endSec: 1400 }], 1500],
    ];

    for (const [segments, duration] of cases) {
      const complete = watchedPercent(segments, duration) === 100;
      const nothingLeft =
        uncoveredSpans(mergeWatchedSegments(segments), duration).length === 0;
      expect(complete, `duration=${String(duration)}`).toBe(nothingLeft);
    }
  });

  it("is three seconds, and 0.2 %% of an accredited module", () => {
    // Twenty-five minutes is the shape of MEDICE's course. The grace has to be
    // large enough to cover a browser that stops reporting early and small
    // enough that it is not a way to skip content.
    expect(creditedDurationSec(1500)).toBe(1497);
    expect(watchedPercent([{ startSec: 0, endSec: 1497 }], 1500)).toBe(100);
    expect(watchedPercent([{ startSec: 0, endSec: 1400 }], 1500)).toBe(93);
    // And the ten-second upload the client tested with, where three seconds is
    // 30 %% of the file: seven seconds seen is complete, six is not.
    expect(watchedPercent([{ startSec: 0, endSec: 7 }], 10)).toBe(100);
    expect(watchedPercent([{ startSec: 0, endSec: 6 }], 10)).toBe(60);
  });

  it("answers zero for a length it cannot use", () => {
    expect(creditedDurationSec(0)).toBe(0);
    expect(creditedDurationSec(-5)).toBe(0);
    expect(creditedDurationSec(Number.NaN)).toBe(0);
    expect(creditedDurationSec(Number.POSITIVE_INFINITY)).toBe(0);
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
    /*
     * Numbers restated for the 2× bound (P153-01): the budget here is
     * 25 × 2 = 50 s, so the two 30-second segments are individually plausible
     * and together are not. The property under test is unchanged — one batch,
     * one budget — and it is the property that stops a client splitting an
     * impossible claim into possible-looking pieces.
     */
    const result = validateSegments(
      [
        { startSec: 0, endSec: 30 },
        { startSec: 100, endSec: 130 },
      ],
      { durationSec: 1500, elapsedWallClockSec: 25, wallClockToleranceSec: 0 },
    );

    expect(result.accepted).toHaveLength(1);
    expect(result.rejected[0]?.reason).toBe("faster_than_wallclock");
  });

  /*
   * The speed control the player actually offers (P153-01).
   *
   * `PLAYBACK_RATES` goes up to 2×, and its own comment claimed "the tolerance
   * leaves room for 2× and not for 4×". The tolerance is two **seconds**, flat,
   * so a 15-second flush (the widget's cadence) at 1.25× claims 18.75 s against
   * a budget of 17 and is thrown away whole — as is every rate above 1×.
   *
   * The invariant is stated in terms of the rates the product offers rather
   * than the widget's flush interval, because it must hold whatever that
   * cadence is: a learner may watch at any rate the player can be set to, and
   * every second of it has to be credited.
   */
  it.each(PLAYBACK_RATES)(
    "credits a heartbeat watched at %s×, which the player offers",
    (rate) => {
      const elapsed = 15; // apps/widget/src/components/LessonScreen.tsx FLUSH_INTERVAL_MS
      const result = validateSegments([{ startSec: 0, endSec: elapsed * rate }], {
        durationSec: 2490,
        elapsedWallClockSec: elapsed,
      });

      expect(
        result.rejected,
        `${String(elapsed * rate)} s watched at ${String(rate)}× over ${String(elapsed)} s ` +
          "of wall clock was refused, so the learner watched it and was not credited",
      ).toEqual([]);
      expect(result.accepted).toHaveLength(1);
    },
  );

  it("still refuses a whole video claimed at more than the fastest rate on offer", () => {
    // The anti-skip property the budget exists for, restated against the new
    // bound: 2 × 30 s of wall clock is 60 s of credit, and 1500 is not that.
    const result = validateSegments([{ startSec: 0, endSec: 1500 }], {
      durationSec: 1500,
      elapsedWallClockSec: 30,
    });

    expect(result.accepted).toEqual([]);
    expect(result.rejected[0]?.reason).toBe("faster_than_wallclock");
  });

  it("caps the budget at the fastest rate the player offers, not higher", () => {
    // One second past 2× is refused: the bound is the product's own cap, so a
    // client cannot claim a rate the player cannot be set to.
    const result = validateSegments(
      [{ startSec: 0, endSec: 15 * MAX_PLAYBACK_RATE + 3 }],
      {
        durationSec: 2490,
        elapsedWallClockSec: 15,
        wallClockToleranceSec: 2,
      },
    );

    expect(result.rejected[0]?.reason).toBe("faster_than_wallclock");
  });

  it("skips the plausibility check when there is no previous report to measure against", () => {
    const result = validateSegments([{ startSec: 0, endSec: 1500 }], {
      durationSec: 1500,
    });

    expect(result.accepted).toHaveLength(1);
  });
});

describe("uncoveredSpans", () => {
  it("names the hole in the middle of an otherwise watched video", () => {
    // The reported shape: a full-looking bar, "noch 0:00", and 96 %.
    expect(
      uncoveredSpans(
        [
          { startSec: 0, endSec: 8 },
          { startSec: 9, endSec: 20 },
        ],
        20,
      ),
    ).toEqual([{ startSec: 8, endSec: 9 }]);
  });

  it("names a gap at the very start", () => {
    expect(uncoveredSpans([{ startSec: 2, endSec: 20 }], 20)).toEqual([
      { startSec: 0, endSec: 2 },
    ]);
  });

  it("names a gap at the very end, up to where the requirement ends", () => {
    // 20 s of video, 17 of them credited. Stopping at 14 leaves three seconds
    // the learner genuinely has to go back for; the span names those and stops
    // at 17, because sending somebody to 0:17–0:20 is what P93-01 was reported
    // for.
    expect(uncoveredSpans([{ startSec: 0, endSec: 14 }], 20)).toEqual([
      { startSec: 14, endSec: 17 },
    ]);
  });

  it("says nothing about the tail grace itself", () => {
    // The exact report: a ten-second video watched to 9.2 s was told
    // "Diese Stellen fehlen noch: 0:09–0:10".
    expect(uncoveredSpans([{ startSec: 0, endSec: 9.2 }], 10)).toEqual([]);
    // And the same one second short of where the requirement ends.
    expect(uncoveredSpans([{ startSec: 0, endSec: 6 }], 10)).toEqual([
      { startSec: 6, endSec: 7 },
    ]);
  });

  it("says nothing about a video that was fully watched", () => {
    expect(uncoveredSpans([{ startSec: 0, endSec: 20 }], 20)).toEqual([]);
  });

  it("ignores a sliver below one playback sample", () => {
    // Nobody can go and watch a tenth of a second, and listing it would send
    // somebody hunting for a gap they cannot close.
    expect(
      uncoveredSpans(
        [
          { startSec: 0, endSec: 9.9 },
          { startSec: 10, endSec: 20 },
        ],
        20,
      ),
    ).toEqual([]);
  });

  it("clamps to the video rather than reporting past its end", () => {
    expect(uncoveredSpans([{ startSec: 0, endSec: 25 }], 20)).toEqual([]);
  });

  it("answers nothing for a video with no usable length", () => {
    expect(uncoveredSpans([{ startSec: 0, endSec: 5 }], 0)).toEqual([]);
  });
});
