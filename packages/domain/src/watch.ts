/**
 * Watched-interval arithmetic — the anti-skip primitive.
 *
 * `CLAUDE.md` §4 invariant 5: watched percentage is the coverage of the UNION
 * of watched intervals, never the maximum playback position.
 *
 * The rejected alternative is worth stating explicitly, because it is the
 * implementation a hurried reader would write and it passes casual review: if
 * watched percentage were `maxPosition / duration`, a learner could satisfy a
 * 100 % watch requirement by dragging the scrub bar to the end of the video.
 * Every CME point the system had issued would then be indefensible. Union
 * coverage is the only version that means what the accreditation rule says it
 * means.
 */

export interface WatchedSegment {
  readonly startSec: number;
  readonly endSec: number;
}

export type SegmentRejectionReason =
  | "not_finite"
  | "negative"
  | "zero_or_reversed"
  | "beyond_duration"
  | "faster_than_wallclock";

export interface RejectedSegment {
  readonly segment: WatchedSegment;
  readonly reason: SegmentRejectionReason;
}

export interface SegmentValidationResult {
  readonly accepted: readonly WatchedSegment[];
  readonly rejected: readonly RejectedSegment[];
}

export interface SegmentValidationOptions {
  readonly durationSec: number;
  /**
   * Wall-clock seconds that actually elapsed on the server between this report
   * and the previous one. A client cannot watch 600 s of video in 30 s of real
   * time, so a claim that it did is rejected.
   *
   * Omit only when no previous report exists to measure against.
   */
  readonly elapsedWallClockSec?: number;
  /** Slack for playback-rate variation and clock jitter. Default 2 s. */
  readonly wallClockToleranceSec?: number;
}

const DEFAULT_WALL_CLOCK_TOLERANCE_SEC = 2;

/**
 * Merge overlapping and adjacent intervals into a minimal disjoint set.
 *
 * Adjacent intervals touching at a point (`[0,10]` and `[10,20]`) are merged —
 * they represent continuous viewing across two heartbeats, not a gap.
 */
export function mergeWatchedSegments(
  segments: readonly WatchedSegment[],
): readonly WatchedSegment[] {
  const usable = segments
    .filter(
      (s) =>
        Number.isFinite(s.startSec) &&
        Number.isFinite(s.endSec) &&
        s.startSec >= 0 &&
        s.endSec > s.startSec,
    )
    .sort((a, b) => a.startSec - b.startSec);

  const merged: WatchedSegment[] = [];

  for (const segment of usable) {
    const last = merged[merged.length - 1];

    if (last !== undefined && segment.startSec <= last.endSec) {
      if (segment.endSec > last.endSec) {
        merged[merged.length - 1] = { startSec: last.startSec, endSec: segment.endSec };
      }
      continue;
    }

    merged.push({ startSec: segment.startSec, endSec: segment.endSec });
  }

  return merged;
}

/**
 * There is deliberately no exported `watchedSeconds`.
 *
 * There was one — "total seconds covered by the union of the segments", raw,
 * uncapped, no endpoint tolerance — and summing it across a course is precisely
 * what caused P68-02: the same stored segments read as 100 % per content and
 * 99 % per course, in one response, with no way out of the state. See
 * `watchedSecondsWithin`, which is the answer to that question and the only one.
 *
 * It survived the fix as an unused export, which is the dangerous shape: the
 * name is the obvious thing to reach for, the docstring made it sound like the
 * primitive, and nothing would have objected to a second rollup calling it. A
 * duplicate of a compliance rule that is one import away from a caller is worse
 * than no rule at all, because the two disagree quietly (CLAUDE.md §4
 * invariant 6). Found by `scripts/unused-rules.mjs` (P76-02).
 *
 * If you want the union itself, `mergeWatchedSegments` is exported and honest
 * about being intervals rather than a credited figure.
 */

/**
 * How far from an endpoint still counts as being at it.
 *
 * A `<video>` timeline is continuous and the events that observe it are not.
 * `play` fires with `currentTime` already a fraction past zero, and the last
 * `timeupdate` lands a fraction before the end — so a learner who watches every
 * frame reports something like `[0.0007, 25]` of a 25 s video, which is
 * 99.997 % and **floors to 99**.
 *
 * That is not a rounding nicety. `required_watch_percent` defaults to 100 and
 * is 100 on the MEDICE course, so before this the gate was not strict but
 * *unreachable*: a physician could watch an accredited Fortbildung end to end
 * and never be permitted to finish it. Found by playing a real video in a real
 * browser (P29-01).
 *
 * Half a second, and applied **only at the two endpoints** — never to a gap in
 * the middle. That is the distinction that matters: a hole is content the
 * learner did not see and must stay a hole, while an endpoint sliver is the
 * measuring instrument, not the measurement. Half a second cannot hide content
 * at either end, and the wall-clock check bounds the total independently.
 */
const BOUNDARY_TOLERANCE_SEC = 0.5;

/**
 * The union, with each end snapped to the content's own bounds when it lands
 * within a sampling artefact of them.
 *
 * Deliberately not exported, and deliberately not used by `maxWatchedPosition`:
 * snapping the far end to the duration there would raise the forward-seek
 * ceiling to the end of the video on the strength of a rounding error, which is
 * the one thing the ceiling exists to prevent.
 */
function snapToBounds(
  merged: readonly WatchedSegment[],
  durationSec: number,
): readonly WatchedSegment[] {
  if (merged.length === 0) return merged;

  const first = merged[0];
  const last = merged[merged.length - 1];
  // Non-null: length is at least one, so both indices exist.
  if (first === undefined || last === undefined) return merged;

  const snapped = [...merged];
  if (first.startSec > 0 && first.startSec <= BOUNDARY_TOLERANCE_SEC) {
    snapped[0] = { startSec: 0, endSec: first.endSec };
  }
  const lastIndex = snapped.length - 1;
  const tail = snapped[lastIndex];
  if (
    tail !== undefined &&
    tail.endSec < durationSec &&
    durationSec - tail.endSec <= BOUNDARY_TOLERANCE_SEC
  ) {
    snapped[lastIndex] = { startSec: tail.startSec, endSec: durationSec };
  }

  return snapped;
}

/**
 * Seconds covered, with the endpoint tolerance applied and capped at the
 * content's own length.
 *
 * ## Why this exists rather than two callers doing it themselves
 *
 * It was two callers doing it themselves, and they disagreed (P68-02).
 * `watchedPercent` snapped the union to the content's bounds before measuring;
 * `courseWatchCoverage` summed raw `watchedSeconds` across the course and did
 * not. So one physician's single completed video was **100 % per content and
 * 99 % per course**, from the same stored segments, in the same response.
 *
 * The consequence was not cosmetic. `requiredWatchPercent` defaults to 100, and
 * the course-level figure is what the completion gate compares against — so a
 * learner who watched every frame saw the module marked complete, the
 * Lernerfolgskontrolle unlocked, the player reporting 100 % angesehen, and then
 * "Es fehlt noch: die vollständige Videowiedergabe" on the Punktemeldung form,
 * with nothing left to watch. There was no way out of that state.
 *
 * `BOUNDARY_TOLERANCE_SEC` exists precisely because a `<video>` cannot report
 * its own endpoints exactly; applying it in one place and not the other made
 * the tolerance itself the source of the inconsistency. CLAUDE.md §4 invariant
 * 6 — one rollup path — now holds for this number too.
 */
export function watchedSecondsWithin(
  segments: readonly WatchedSegment[],
  durationSec: number,
): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return 0;

  const merged = snapToBounds(mergeWatchedSegments(segments), durationSec);
  return Math.min(
    merged.reduce((total, s) => total + (s.endSec - s.startSec), 0),
    durationSec,
  );
}

/**
 * Integer percentage 0–100 of the content actually watched.
 *
 * Deliberately floors rather than rounds. At MEDICE's `requiredWatchPercent`
 * of 100 there is no tolerance to hide behind: rounding would report 99.6 %
 * coverage as 100 and complete a video with unwatched content in it. Flooring
 * means the number never overstates what the learner saw.
 *
 * The endpoints are snapped first — see `BOUNDARY_TOLERANCE_SEC`. Flooring and
 * snapping answer different questions: flooring refuses to round a *hole* away,
 * snapping refuses to call the sampling interval a hole.
 */
export function watchedPercent(
  segments: readonly WatchedSegment[],
  durationSec: number,
): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return 0;

  return Math.floor((watchedSecondsWithin(segments, durationSec) / durationSec) * 100);
}

/**
 * The furthest position the learner has legitimately reached — the end of the
 * last merged segment. This is the anchor for forward-seek restriction.
 */
export function maxWatchedPosition(segments: readonly WatchedSegment[]): number {
  const merged = mergeWatchedSegments(segments);
  const last = merged[merged.length - 1];
  return last === undefined ? 0 : last.endSec;
}

/**
 * Whether seeking to `targetSec` is permitted.
 *
 * Backward seeks are always allowed — re-watching is legitimate and, because
 * coverage is a union, it cannot inflate the percentage. Forward seeks are
 * allowed only within tolerance of the furthest point already reached.
 */
export function isSeekAllowed(
  segments: readonly WatchedSegment[],
  targetSec: number,
  toleranceSec = 5,
): boolean {
  if (!Number.isFinite(targetSec) || targetSec < 0) return false;
  return targetSec <= maxWatchedPosition(segments) + toleranceSec;
}

/**
 * Reject implausible reported segments before they are stored.
 *
 * The load-bearing check is `faster_than_wallclock`: without it, a client can
 * post `[0, duration]` in a single call and complete any video instantly. The
 * merge logic alone cannot catch that, because the interval is internally
 * well-formed — only comparing it against elapsed real time reveals it.
 */
export function validateSegments(
  segments: readonly WatchedSegment[],
  options: SegmentValidationOptions,
): SegmentValidationResult {
  const accepted: WatchedSegment[] = [];
  const rejected: RejectedSegment[] = [];

  const tolerance = options.wallClockToleranceSec ?? DEFAULT_WALL_CLOCK_TOLERANCE_SEC;
  const budget =
    options.elapsedWallClockSec === undefined
      ? undefined
      : options.elapsedWallClockSec + tolerance;

  let claimed = 0;

  for (const segment of segments) {
    const reason = rejectionReason(segment, options.durationSec);

    if (reason !== undefined) {
      rejected.push({ segment, reason });
      continue;
    }

    const length = segment.endSec - segment.startSec;

    if (budget !== undefined && claimed + length > budget) {
      rejected.push({ segment, reason: "faster_than_wallclock" });
      continue;
    }

    claimed += length;
    accepted.push(segment);
  }

  return { accepted, rejected };
}

function rejectionReason(
  segment: WatchedSegment,
  durationSec: number,
): SegmentRejectionReason | undefined {
  if (!Number.isFinite(segment.startSec) || !Number.isFinite(segment.endSec)) {
    return "not_finite";
  }
  if (segment.startSec < 0 || segment.endSec < 0) return "negative";
  if (segment.endSec <= segment.startSec) return "zero_or_reversed";
  if (segment.endSec > durationSec) return "beyond_duration";
  return undefined;
}
