import { describe, expect, it } from "vitest";
import { courseWatchCoverage } from "./coverage.js";
import { watchedPercent } from "./watch.js";
import type { CourseNode } from "./types.js";

/** Two videos of deliberately unequal length, so weighting is observable. */
function course(): CourseNode {
  return {
    id: "course",
    modules: [
      {
        id: "m1",
        ordinal: 0,
        chapters: [
          {
            id: "c1",
            ordinal: 0,
            contents: [
              { id: "long", kind: "video", durationSec: 900 },
              { id: "short", kind: "video", durationSec: 100 },
              { id: "quiz", kind: "quiz" },
            ],
          },
        ],
      },
    ],
  };
}

/**
 * The course figure and the per-content figure are the same number (P68-02).
 *
 * They were not. `watchedPercent` snapped the union to the content's bounds
 * with `BOUNDARY_TOLERANCE_SEC` — a `<video>` cannot report its own endpoints
 * exactly — and this function summed raw seconds without it. One completed
 * eight-second video was therefore 100 % on the player and 99 % at the gate,
 * and `requiredWatchPercent` defaults to 100: the module showed complete, the
 * quiz unlocked, and the Punktemeldung form said "Es fehlt noch: die
 * vollständige Videowiedergabe" with nothing left to watch.
 *
 * The segment below is what a real browser reports for a video played from
 * start to finish, taken from a run of the journey suite.
 */
describe("courseWatchCoverage agrees with watchedPercent", () => {
  const oneVideo = {
    id: "c",
    modules: [
      {
        id: "m",
        ordinal: 0,
        chapters: [
          {
            id: "k",
            ordinal: 0,
            contents: [{ id: "v", kind: "video" as const, durationSec: 8 }],
          },
        ],
      },
    ],
  };

  it("credits a video watched end to end as fully watched, at both levels", () => {
    const segments = [{ startSec: 0.010357, endSec: 8 }];

    expect(watchedPercent(segments, 8)).toBe(100);
    expect(courseWatchCoverage(oneVideo, [{ contentId: "v", segments }]).percent).toBe(
      100,
    );
  });

  it("still refuses a video that was genuinely not finished", () => {
    // Three of eight seconds. The figure is a fraction of the **video**
    // (P94-01), so it is 37 and not 60 — five seconds are still missing and
    // two of them are inside the requirement. What matters here is that the
    // two levels say the same thing, and that "not finished" is still refused.
    const segments = [{ startSec: 0, endSec: 3 }];

    expect(watchedPercent(segments, 8)).toBe(37);
    expect(courseWatchCoverage(oneVideo, [{ contentId: "v", segments }]).percent).toBe(
      37,
    );
  });
});

describe("courseWatchCoverage weights by duration", () => {
  it("reports 100 % when every video is fully covered", () => {
    const coverage = courseWatchCoverage(course(), [
      { contentId: "long", segments: [{ startSec: 0, endSec: 900 }] },
      { contentId: "short", segments: [{ startSec: 0, endSec: 100 }] },
    ]);

    expect(coverage).toEqual({ percent: 100, watchedSec: 1000, totalSec: 1000 });
  });

  it("does not let a fully-watched short video mask an unwatched long one", () => {
    // Averaging per-video percentages would say 50 %. Duration weighting says
    // 10 %, which is the honest number.
    const coverage = courseWatchCoverage(course(), [
      { contentId: "short", segments: [{ startSec: 0, endSec: 100 }] },
    ]);

    expect(coverage.percent).toBe(10);
  });

  /*
   * Where the anti-skip property lives, after P168-04.
   *
   * It used to be here: two fragments with 700 s between them counted 200 s,
   * because `fillSamplingGaps` refused to bridge a hole wider than a minute.
   * The client's decision — *"credit the hole because the user reached the
   * end"* — removed that limit, and it is only sound because P168-01 made the
   * seek ceiling a rule of the **write path**: a report beginning past the
   * furthest second the record reaches is refused, so the far fragment below
   * cannot be stored in the first place, and every hole is charged to the
   * wall-clock budget as if it had been watched.
   *
   * So this layer no longer distinguishes a hole from watched material, and
   * saying so out loud is the point of these two cases. What it still refuses
   * is everything **outside** the reported range — which is what a drag to the
   * end produces, and what the completion gate actually reads.
   */
  it("never credits a second past the furthest one reported", () => {
    const coverage = courseWatchCoverage(course(), [
      { contentId: "long", segments: [{ startSec: 0, endSec: 100 }] },
    ]);

    // 100 s of the 900 s video, not 900. A max-position implementation would
    // agree here; the case below is the one that separates them.
    expect(coverage.watchedSec).toBe(100);
  });

  it("never credits a second before the first one reported", () => {
    // The drag to 13:20 of a fifteen-minute video: one fragment, no neighbour,
    // nothing bridged. Worth its own case because "coverage is the union" and
    // "coverage is the furthest position" give different answers to exactly
    // this, and only this.
    const coverage = courseWatchCoverage(course(), [
      { contentId: "long", segments: [{ startSec: 800, endSec: 900 }] },
    ]);

    expect(coverage.watchedSec).toBe(100);
  });

  it("collapses overlapping reports rather than double-counting them", () => {
    const coverage = courseWatchCoverage(course(), [
      {
        contentId: "short",
        segments: [
          { startSec: 0, endSec: 80 },
          { startSec: 40, endSec: 100 },
        ],
      },
    ]);

    expect(coverage.watchedSec).toBe(100);
  });

  it("caps a single video's contribution at its own length", () => {
    // Even a segment claiming far more than the video's duration cannot push
    // total coverage above what the course actually contains.
    const coverage = courseWatchCoverage(course(), [
      { contentId: "short", segments: [{ startSec: 0, endSec: 100_000 }] },
    ]);

    expect(coverage.watchedSec).toBe(100);
    expect(coverage.percent).toBe(10);
  });

  it("ignores non-video content — a quiz has no duration to watch", () => {
    const coverage = courseWatchCoverage(course(), [
      { contentId: "quiz", segments: [{ startSec: 0, endSec: 5000 }] },
    ]);

    expect(coverage.watchedSec).toBe(0);
    expect(coverage.totalSec).toBe(1000);
  });

  it("skips a video with a missing or nonsensical duration rather than scoring it", () => {
    const broken: CourseNode = {
      id: "course",
      modules: [
        {
          id: "m1",
          ordinal: 0,
          chapters: [
            {
              id: "c1",
              ordinal: 0,
              contents: [
                { id: "no-duration", kind: "video" },
                { id: "zero", kind: "video", durationSec: 0 },
                { id: "ok", kind: "video", durationSec: 200 },
              ],
            },
          ],
        },
      ],
    };

    const coverage = courseWatchCoverage(broken, [
      { contentId: "ok", segments: [{ startSec: 0, endSec: 100 }] },
    ]);

    // Only the scorable video counts, so an authoring mistake cannot inflate
    // coverage to 100 %.
    expect(coverage.totalSec).toBe(200);
    expect(coverage.percent).toBe(50);
  });

  it("reports 0 % with no segments at all", () => {
    expect(courseWatchCoverage(course(), []).percent).toBe(0);
  });

  it("treats a course with no scorable video as vacuously watched", () => {
    // Otherwise such a course could never be completed, and the watch gate is
    // not the right place to refuse a course that simply has no video.
    const noVideo: CourseNode = {
      id: "course",
      modules: [
        {
          id: "m1",
          ordinal: 0,
          chapters: [{ id: "c1", ordinal: 0, contents: [{ id: "q", kind: "quiz" }] }],
        },
      ],
    };

    expect(courseWatchCoverage(noVideo, []).percent).toBe(100);
  });

  it("floors rather than rounds, so 99.9 % never reads as complete", () => {
    // Ten seconds short on the long video — outside the three-second tail
    // grace, so it is genuinely unwatched content and 990/1000 floors to 99.
    const coverage = courseWatchCoverage(course(), [
      { contentId: "long", segments: [{ startSec: 0, endSec: 890 }] },
      { contentId: "short", segments: [{ startSec: 0, endSec: 100 }] },
    ]);

    expect(coverage.percent).toBe(99);
  });

  it("credits a video whose last three seconds were not reported", () => {
    // The control for the case above, and the client's rule at course level:
    // one second short is inside the grace, so the course is fully watched
    // rather than stuck at 99 with nothing left to watch.
    const coverage = courseWatchCoverage(course(), [
      { contentId: "long", segments: [{ startSec: 0, endSec: 899 }] },
      { contentId: "short", segments: [{ startSec: 0, endSec: 99 }] },
    ]);

    expect(coverage).toEqual({ percent: 100, watchedSec: 1000, totalSec: 1000 });
  });

  it("is pure — repeated calls with the same input agree", () => {
    const input = [
      { contentId: "long", segments: [{ startSec: 0, endSec: 450 }] },
    ] as const;

    expect(courseWatchCoverage(course(), input)).toEqual(
      courseWatchCoverage(course(), input),
    );
  });
});

/*
 * P163-01. The third call site, and the one that decides the CME point.
 *
 * `fillSamplingGaps` was applied on the write path (the stored percentage) and
 * on the read path (the segments the player draws), so the bar, the number and
 * the gap list agree. The course-level coverage — the figure `isCourseComplete`
 * compares against `requiredWatchPercent` — was fed the raw stored intervals.
 *
 * The consequence is a screen that contradicts itself: every content ticked,
 * "100 % der Fortbildung absolviert" in the header, the Lernerfolgskontrolle
 * passed, and "Für die CME-Punkte fehlen noch Abschnitte der Fortbildung"
 * underneath — with no way to reach the EFN step. §4 invariant 6 exactly: two
 * implementations of one rollup, disagreeing on a CME record.
 */
describe("the course figure credits the same seconds the player does", () => {
  const oneVideo: CourseNode = {
    modules: [
      {
        id: "m1",
        chapters: [
          {
            id: "c1",
            contents: [{ id: "v1", kind: "video", durationSec: 600 }],
          },
        ],
      },
    ],
  } as unknown as CourseNode;

  it("reaches 100 % for a video watched end to end through a sampling clock", () => {
    /*
     * A fifteen-second flush that missed a beat three times: 600 seconds of
     * video reported as four runs with three one-second holes. The player
     * credits this as complete, so the content is ticked and the rollup says
     * 100 %. Raw, it is 597/600 = 99 %, and 99 does not complete a course whose
     * requiredWatchPercent is 100.
     */
    const withHoles = [
      { startSec: 0, endSec: 150 },
      { startSec: 151, endSec: 300 },
      { startSec: 301, endSec: 450 },
      { startSec: 451, endSec: 600 },
    ];

    const coverage = courseWatchCoverage(oneVideo, [
      { contentId: "v1", segments: withHoles },
    ]);

    expect(coverage.percent).toBe(100);
  });

  it("credits a wide hole too, because the write path refuses the seek that makes one", () => {
    /*
     * Ten minutes of video with four minutes missing in the middle. This used
     * to assert 60 % — "nothing about that is a missed flush" — and the
     * premise was wrong in a way that mattered: until P168-01 nothing stopped a
     * client posting the far side of a hole, so the width was evidence of
     * nothing, and a physician whose tab was throttled for four minutes was
     * told to re-watch what they had seen.
     *
     * Now a segment beginning past the furthest second the record reaches is
     * refused (`beyond_ceiling`), and the crossing is charged to the wall-clock
     * budget. A record in this shape is therefore a report of ours that never
     * arrived — or one written before that rule existed. The client's ruling:
     * *"credit the hole because the user reached the end."*
     *
     * The gate is not skippable as a result: it is the **write path** that
     * refuses the skip, and `watch.test.ts` holds it to that.
     */
    const hole = [
      { startSec: 0, endSec: 120 },
      { startSec: 360, endSec: 600 },
    ];

    const coverage = courseWatchCoverage(oneVideo, [{ contentId: "v1", segments: hole }]);

    expect(coverage.percent).toBe(100);
  });

  it("still credits nothing for a fragment with no neighbour", () => {
    // The guard that survived, and the one that carries the weight here: a
    // single fragment near the end is 5 s of a 600 s video, whatever position
    // it claims.
    const coverage = courseWatchCoverage(oneVideo, [
      { contentId: "v1", segments: [{ startSec: 595, endSec: 600 }] },
    ]);

    expect(coverage.percent).toBe(0);
  });
});
