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

/** Total seconds covered by the union of the segments. */
export function watchedSeconds(segments: readonly WatchedSegment[]): number {
  return mergeWatchedSegments(segments).reduce(
    (total, s) => total + (s.endSec - s.startSec),
    0,
  );
}

/**
 * Integer percentage 0–100 of the content actually watched.
 *
 * Deliberately floors rather than rounds. At MEDICE's `requiredWatchPercent`
 * of 100 there is no tolerance to hide behind: rounding would report 99.6 %
 * coverage as 100 and complete a video with unwatched content in it. Flooring
 * means the number never overstates what the learner saw.
 */
export function watchedPercent(
  segments: readonly WatchedSegment[],
  durationSec: number,
): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return 0;

  const covered = Math.min(watchedSeconds(segments), durationSec);
  return Math.floor((covered / durationSec) * 100);
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
