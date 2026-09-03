import { describe, expect, it } from "vitest";
import type { WatchedSegment } from "./watch.js";
import { PLAYBACK_RATES, SEEK_JUMP_SEC, SEEK_STEP_SEC } from "./playback.js";
import {
  CEILING_ACCEPTANCE_TOLERANCE_SEC,
  creditedDurationSec,
  fillSamplingGaps,
  MAX_PLAYBACK_RATE,
  isSeekAllowed,
  SEEK_CEILING_TOLERANCE_SEC,
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

describe("the forward seek ceiling (P154-01)", () => {
  /*
   * From the network capture in DEP-25, on a real session:
   *
   *   watchedSegments: [ {0 -> 15.147841}, {20.147841 -> 50.27983}, … ]
   *   seekCeilingSec: 130.09301   (= 125.09301 + 5)
   *
   * The gap is 5.000000 s to six decimal places, and `SEEK_STEP_SEC` is 5.
   * The right-arrow key steps exactly to the ceiling, playback carries the
   * ceiling forward, and the learner walks the video in five-second hops —
   * each leaving five seconds nobody watched. The screen says "Vorspulen ist
   * nicht möglich" the whole time.
   *
   * `seekCeiling`'s own comment says the tolerance is there "so that nudging
   * the scrub bar forward by a frame at the live edge is not refused". A frame
   * is 0.04 s. The number was 5.
   */
  it("refuses the arrow-key step past the watched edge", () => {
    const watched = [{ startSec: 0, endSec: 15.147841 }];

    expect(
      isSeekAllowed(watched, 15.147841 + SEEK_STEP_SEC),
      "one press of the forward key walked past five unwatched seconds",
    ).toBe(false);
  });

  it("still allows the frame-sized nudge the tolerance exists for", () => {
    expect(isSeekAllowed([{ startSec: 0, endSec: 15.147841 }], 15.187841)).toBe(true);
  });

  it("keeps the tolerance below every forward control the player offers", () => {
    // The guard, not the instance: a tolerance at or above the smallest
    // forward jump is a way to walk through unwatched content, whatever the
    // numbers happen to be. Same shape as the speed-menu guard in P153.
    expect(SEEK_CEILING_TOLERANCE_SEC).toBeLessThan(
      Math.min(SEEK_STEP_SEC, SEEK_JUMP_SEC),
    );
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

describe("the last seconds of a video, and the holes sampling leaves (P158)", () => {
  /*
   * From a real session, reported as "i have watched the whole video" with
   * 98 % on screen. The response body settles both halves.
   *
   *   rejected: [{ segment: { startSec: 2483.913576, endSec: 2490.282667 },
   *                reason: "beyond_duration" }]
   *   accepted: 0
   *   watchedPercent: 98
   *
   * The stored duration is 2490 s. The element reported a final position
   * 0.282667 s past it — browsers do that; `currentTime` at `ended` is not
   * exactly `duration` — and `validateSegments` rejected the **whole** six-and-
   * a-half-second segment for it. Every video's last segment meets this.
   */
  it("credits playback that overshoots the stored duration, clamped to it", () => {
    const result = validateSegments([{ startSec: 2483.913576, endSec: 2490.282667 }], {
      durationSec: 2490,
      elapsedWallClockSec: 30,
    });

    expect(
      result.rejected,
      "the final seconds of the video were thrown away for a quarter-second overshoot",
    ).toEqual([]);
    expect(result.accepted).toEqual([{ startSec: 2483.913576, endSec: 2490 }]);
  });

  it("still refuses a segment that lies entirely past the end", () => {
    const result = validateSegments([{ startSec: 3000, endSec: 3010 }], {
      durationSec: 2490,
      elapsedWallClockSec: 30,
    });
    expect(result.rejected[0]?.reason).toBe("beyond_duration");
  });
});

describe("holes a sampling clock leaves behind (P158-02)", () => {
  /*
   * The same session's union had **thirteen** interior gaps totalling 37.52 s,
   * the largest exactly 5.000 s. Every one is bounded by watched material on
   * both sides — they are what a throttled `timeupdate` and the arrow-key hops
   * from before P154-01 leave behind, not content anybody skipped.
   *
   * ## Why this is not the rule that had to be reverted
   *
   * S32's first form credited every whole minute below the furthest point, and
   * an existing test caught it at once: a learner drags to 09:55 of a
   * ten-minute video, the client posts one five-second fragment, and the rule
   * credits nine minutes nobody watched.
   *
   * This one closes gaps **between two watched regions**. A single fragment has
   * no neighbour, so nothing is bridged and the drag case is refused for a
   * structural reason rather than by a number. Nothing before the first segment
   * or after the last is ever added, so it cannot credit an unwatched start or
   * an unwatched end.
   */
  it("closes the gaps a real session leaves, and reaches the end", () => {
    const session = [
      { startSec: 0, endSec: 15.147841 },
      { startSec: 20.147841, endSec: 50.27983 },
      { startSec: 50.363214, endSec: 50.601112 },
      { startSec: 55.42434, endSec: 55.802273 },
      { startSec: 66.318741, endSec: 2489.117804 },
    ];

    expect(fillSamplingGaps(session)).toEqual([{ startSec: 0, endSec: 2489.117804 }]);
  });

  it("refuses the drag-to-the-end fragment, which has nothing to bridge to", () => {
    // The case that killed the previous attempt. One fragment near the end of a
    // ten-minute video: no neighbour, so no gap, so no credit. Since P168-01
    // the write path refuses to store it in the first place, and this stays as
    // the second lock on the same door.
    const drag = [{ startSec: 595, endSec: 600 }];
    expect(fillSamplingGaps(drag)).toEqual(drag);
  });

  /*
   * These two asserted the width limit, and P168-04 removed it. They are kept
   * and inverted rather than deleted, because the change is not "the threshold
   * got bigger" — it is that a threshold was answering the wrong question.
   *
   * A width asks *is this hole too wide to be jitter?* What decides a CME point
   * is *could this learner have got to the far side of it?* Since P168-01 the
   * answer is no unless they reported their way across, and the crossing is
   * charged to the wall-clock budget either way. So these are exactly the cases
   * that used to separate a bridged hole from an unbridged one, and both are
   * now bridged. The case that must never be bridged is the one directly above,
   * and it is refused structurally rather than by a number.
   */
  it("bridges a wide interior hole, which a refused forward seek cannot produce", () => {
    const skipped = [
      { startSec: 0, endSec: 100 },
      { startSec: 900, endSec: 1000 },
    ];

    expect(fillSamplingGaps(skipped)).toEqual([{ startSec: 0, endSec: 1000 }]);
  });

  it("bridges an interior hole on a very short video too", () => {
    // A ten-second video with a nine-second hole between two samples. Under the
    // old rule this was "most of the content, not an artefact" — but reporting
    // 9.5 s requires having been allowed there. The client's ten-second case
    // ("what happens if a video is only 10 seconds long?") is answered by the
    // write path now, rather than by a fraction of the length.
    const short = [
      { startSec: 0, endSec: 0.5 },
      { startSec: 9.5, endSec: 10 },
    ];

    expect(fillSamplingGaps(short)).toEqual([{ startSec: 0, endSec: 10 }]);
  });

  it("never credits before the first sample or after the last", () => {
    const late = [
      { startSec: 600, endSec: 700 },
      { startSec: 705, endSec: 800 },
    ];
    expect(fillSamplingGaps(late)).toEqual([{ startSec: 600, endSec: 800 }]);
  });
});

/*
 * P168-01. The invariant the player promises, enforced by the server.
 *
 * The client, on a video they had played to the very end:
 *
 * > _"how can i have reached the end of the video if i have not watched that
 * > part when i can not skip?"_
 *
 * They are right, and the answer is that they *could* — not in the player, but
 * in the record. `rejectionReason` refused a segment past the **duration**;
 * nothing refused one past the **seek ceiling**. The ceiling was computed,
 * handed to the player and clamped there, and never checked on the way back in,
 * so "Vorspulen ist nicht möglich" was a property of the renderer. CLAUDE.md §4
 * invariant 1, exactly: the client may not be the source of truth for anything
 * that decides a CME point. A first report of `[1400, 1489]` on a video nobody
 * had opened was accepted and stored.
 *
 * ## Why the answer is refusal and not credit
 *
 * The tempting fix was the other one: they reached the end, so bridge the hole
 * and credit it. Every version of that reduces to crediting media time nobody
 * reported, justified by wall-clock time — and wall-clock time accumulates
 * while a page sits open. A ten-minute video, an hour-old tab and one
 * five-second fragment at 09:55 would then be a completed Fortbildung. That is
 * `watchedPercent` becoming max-position by a longer route, which is the one
 * thing §4 invariant 5 exists to prevent.
 *
 * Refusing the jump makes the sentence true instead of aspirational, and the
 * hole cannot form: to be credited at 07:50 you must have reported your way
 * there.
 *
 * ## Why refusing does not strand anybody
 *
 * A rejected report leaves the record where it was, and `resumeAtSec` is
 * already capped at `seekCeiling(storedSegments)` — so a reload puts the
 * learner back at the last second the server agrees they watched, never past
 * it. A failed flush is re-sent (`restore`), and a throttled tab is bridged in
 * the tracker while it is still an observation rather than a claim (P166-01).
 */
describe("a forward jump the server never authorised", () => {
  it("refuses a segment starting beyond the ceiling the record implies", () => {
    const result = validateSegments([{ startSec: 600, endSec: 700 }], {
      durationSec: 1489,
      previousSegments: [{ startSec: 0, endSec: 100 }],
      elapsedWallClockSec: 3600,
    });

    expect(result.accepted).toEqual([]);
    expect(result.rejected[0]?.reason).toBe("beyond_ceiling");
  });

  it("refuses it however long the page has been open", () => {
    /*
     * The guard on the rule that was not shipped. An hour of wall clock is
     * enough budget for ten minutes of video, so the wall-clock check alone
     * accepts a drag to 09:55 — the ceiling is what refuses it, and it must not
     * be expressible in seconds of elapsed time.
     */
    const result = validateSegments([{ startSec: 595, endSec: 600 }], {
      durationSec: 600,
      previousSegments: [],
      elapsedWallClockSec: 3600,
    });

    expect(result.rejected[0]?.reason).toBe("beyond_ceiling");
  });

  it("allows playback continuing from where the record left off", () => {
    const result = validateSegments([{ startSec: 100, endSec: 200 }], {
      durationSec: 1489,
      previousSegments: [{ startSec: 0, endSec: 100 }],
      elapsedWallClockSec: 3600,
    });

    expect(result.accepted).toEqual([{ startSec: 100, endSec: 200 }]);
  });

  it("allows a rewind, which cannot manufacture coverage", () => {
    const result = validateSegments([{ startSec: 10, endSec: 50 }], {
      durationSec: 1489,
      previousSegments: [{ startSec: 0, endSec: 900 }],
      elapsedWallClockSec: 3600,
    });

    expect(result.accepted).toEqual([{ startSec: 10, endSec: 50 }]);
  });

  it("starts a fresh enrolment at the beginning and nowhere else", () => {
    // Nothing watched, so the ceiling is the start of the video. This is the
    // case that makes the rule bite: without it a first report of [1400, 1489]
    // would be accepted on a video nobody had opened.
    const result = validateSegments([{ startSec: 1400, endSec: 1489 }], {
      durationSec: 1489,
      previousSegments: [],
      elapsedWallClockSec: 3600,
    });

    expect(result.rejected[0]?.reason).toBe("beyond_ceiling");
  });

  it("accepts a run of consecutive intervals in one report", () => {
    /*
     * The case that decides whether this rule is shippable at all. One flush of
     * an ordinary player carries several intervals in playback order, and each
     * begins past what the *stored* record reaches — so a ceiling fixed at the
     * stored maximum refuses everything after the first, and a learner watching
     * normally is credited one heartbeat in four.
     *
     * Written before the ceiling advanced within a report, and it was red.
     */
    const result = validateSegments(
      [
        { startSec: 100, endSec: 115 },
        { startSec: 115.2, endSec: 130 },
        { startSec: 130.1, endSec: 145 },
      ],
      {
        durationSec: 1489,
        previousSegments: [{ startSec: 0, endSec: 100 }],
        elapsedWallClockSec: 30,
      },
    );

    expect(result.rejected).toEqual([]);
    expect(result.accepted).toHaveLength(3);
  });

  it("does not let a report walk itself past the ceiling in one jump", () => {
    // The other half of the running ceiling: it advances by what was
    // *accepted*, so a batch cannot manufacture reach. [0,100] moves it to 100;
    // [900,1000] is still eight hundred seconds beyond it.
    const result = validateSegments(
      [
        { startSec: 0, endSec: 100 },
        { startSec: 900, endSec: 1000 },
      ],
      {
        durationSec: 1489,
        previousSegments: [],
        elapsedWallClockSec: 3600,
      },
    );

    expect(result.accepted).toEqual([{ startSec: 0, endSec: 100 }]);
    expect(result.rejected[0]?.reason).toBe("beyond_ceiling");
  });

  it("is not applied when the caller has no record to compare against", () => {
    // `previousSegments` omitted: the admin re-scoring path and the unit tests
    // that predate this have no prior state, and inventing one would refuse
    // every segment they pass.
    const result = validateSegments([{ startSec: 600, endSec: 700 }], {
      durationSec: 1489,
      elapsedWallClockSec: 3600,
    });

    expect(result.accepted).toEqual([{ startSec: 600, endSec: 700 }]);
  });

  it("charges the hop to the budget, so the tolerance is not a free skip", () => {
    /*
     * The exploit the tolerance opens if the hole below it is free, and the
     * reason `validateSegments` charges `gap` as well as `length`.
     *
     * A client posts a tenth of a second of playback every
     * `CEILING_ACCEPTANCE_TOLERANCE_SEC` — each report legal on its own, each
     * leaving a hole small enough for `fillSamplingGaps` to bridge into full
     * coverage. Uncharged, that walks 2.6 s of video per 0.1 s of budget and a
     * twenty-five-minute Fortbildung is complete in one request.
     *
     * Charged, the budget bounds the furthest point reached to what real time
     * allows, which is the same bound a person watching has.
     */
    // A step just inside the tolerance, so the ceiling itself never refuses a
    // hop and the budget is the only thing standing in the way.
    const step = CEILING_ACCEPTANCE_TOLERANCE_SEC - 0.1;
    const hops: WatchedSegment[] = [];
    for (let i = 0; i < 200; i += 1) {
      hops.push({ startSec: i * step, endSec: i * step + 0.1 });
    }

    const elapsedWallClockSec = 30;
    const result = validateSegments(hops, {
      durationSec: 1489,
      previousSegments: [],
      elapsedWallClockSec,
    });

    // The budget is elapsed x MAX_PLAYBACK_RATE + 2 s of tolerance, and nothing
    // may reach past it — 62 s of a 24:49 video, not 520.
    const budget = elapsedWallClockSec * MAX_PLAYBACK_RATE + 2;
    expect(maxWatchedPosition(result.accepted)).toBeLessThanOrEqual(budget);
    expect(result.rejected.some((r) => r.reason === "faster_than_wallclock")).toBe(true);
  });

  it("keeps the tolerance below the smallest forward control the player offers", () => {
    /*
     * The same property `SEEK_CEILING_TOLERANCE_SEC` is held to one function
     * up, for the same reason: a tolerance as wide as a forward control is a
     * way to walk the video in hops. This one is a sampling step wider, because
     * playback may begin *at* the ceiling and the first sample lands after it.
     */
    expect(CEILING_ACCEPTANCE_TOLERANCE_SEC).toBeLessThan(SEEK_STEP_SEC);
    expect(CEILING_ACCEPTANCE_TOLERANCE_SEC).toBeLessThan(SEEK_JUMP_SEC);
  });
});
