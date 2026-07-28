import { describe, expect, it } from "vitest";
import { courseWatchCoverage } from "./coverage.js";
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

  it("counts the union of intervals, not the furthest position", () => {
    // Watching 0–100 then seeking to 800–900 is 200 s of a 900 s video, even
    // though the playhead reached the end.
    const coverage = courseWatchCoverage(course(), [
      {
        contentId: "long",
        segments: [
          { startSec: 0, endSec: 100 },
          { startSec: 800, endSec: 900 },
        ],
      },
    ]);

    expect(coverage.watchedSec).toBe(200);
    expect(coverage.percent).toBe(20);
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
    const coverage = courseWatchCoverage(course(), [
      { contentId: "long", segments: [{ startSec: 0, endSec: 899 }] },
      { contentId: "short", segments: [{ startSec: 0, endSec: 100 }] },
    ]);

    expect(coverage.percent).toBe(99);
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
