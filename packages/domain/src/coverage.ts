/**
 * Course-level watch coverage (P3-05).
 *
 * This is the number the completion gate compares against
 * `requiredWatchPercent`, so it decides whether a physician earns a CME point
 * and therefore belongs here rather than in a service (`CLAUDE.md` §4
 * invariant 4).
 *
 * Two properties worth stating, because both are ways an implementation could
 * quietly become wrong:
 *
 * 1. **Duration-weighted, not per-video-averaged.** A 25-minute module and a
 *    2-minute one do not count equally. Averaging per-video percentages would
 *    let a learner skip most of the longest video and still show high coverage.
 * 2. **Built on the interval union**, via `watchedSeconds`, never on a furthest
 *    position — the same invariant the per-content gate rests on
 *    (`CLAUDE.md` §4 invariant 5).
 *
 * Non-video content is ignored entirely: a quiz has no duration, and counting
 * it as unwatched would make 100 % unreachable on every course that has one.
 */

import type { CourseNode } from "./types.js";
import { watchedSecondsWithin, type WatchedSegment } from "./watch.js";

/** The stored segments for one piece of video content. */
export interface ContentSegments {
  readonly contentId: string;
  readonly segments: readonly WatchedSegment[];
}

export interface WatchCoverage {
  /** Integer 0–100, floored. */
  readonly percent: number;
  readonly watchedSec: number;
  readonly totalSec: number;
}

export function courseWatchCoverage(
  course: CourseNode,
  segmentsByContent: readonly ContentSegments[],
): WatchCoverage {
  const stored = new Map(
    segmentsByContent.map((entry) => [entry.contentId, entry.segments]),
  );

  let watchedSec = 0;
  let totalSec = 0;

  for (const module of course.modules) {
    for (const chapter of module.chapters) {
      for (const content of chapter.contents) {
        if (content.kind !== "video") continue;

        const duration = content.durationSec;
        // A video with no duration cannot be scored. Skipping it rather than
        // treating it as zero-length keeps an authoring mistake from silently
        // inflating coverage to 100 %.
        if (duration === undefined || !Number.isFinite(duration) || duration <= 0) {
          continue;
        }

        /*
         * The video's own length, both sides of the fraction (§4 invariant 6).
         *
         * P93-01 briefly made this the *credited* length, because
         * `watchedSecondsWithin` could then never return more than that and a
         * raw denominator capped the rollup at 92 % on a ten-second video. In
         * P94-01 that function went back to crediting the whole file whenever
         * nothing is outstanding, so the two agree again on the honest length —
         * and the course figure is once more a fraction of the seconds of video
         * the course actually contains, which is what a physician reading
         * "55 % der Fortbildung absolviert" takes it to be.
         */
        totalSec += duration;
        /*
         * The **same** seconds the per-content percentage is built on.
         *
         * It used to be raw `watchedSeconds`, capped here. That cap is still
         * applied — inside `watchedSecondsWithin` — but the endpoint tolerance
         * was not, and its absence is what made this figure disagree with the
         * one on the player. A learner who had watched a video from end to end
         * was 100 % there and 99 % here, and 99 does not complete a course
         * whose `requiredWatchPercent` is 100. See `watchedSecondsWithin`.
         */
        watchedSec += watchedSecondsWithin(stored.get(content.id) ?? [], duration);
      }
    }
  }

  // A course with no scorable video is vacuously fully watched. The alternative
  // — 0 % — would make such a course impossible to complete, and the watch gate
  // is not the right place to refuse a course that simply has no video.
  if (totalSec === 0) {
    return { percent: 100, watchedSec: 0, totalSec: 0 };
  }

  return {
    percent: Math.floor((watchedSec / totalSec) * 100),
    watchedSec,
    totalSec,
  };
}
