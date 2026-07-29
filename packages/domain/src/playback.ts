/**
 * The player's arithmetic (P5-12).
 *
 * Every function here turns numbers into something the learner reads or the
 * scrub bar draws. None of them decides anything: the watch percentage the
 * gate uses is computed in `watch.ts` from the segments the **server** merged,
 * and `coverageBars` renders those same segments rather than deriving a second
 * opinion about them.
 *
 * The reason they are here rather than inline in the component is that each one
 * is a place a plausible implementation is subtly wrong, and none of the
 * mistakes are visible on screen:
 *
 * - **`seekFraction`** off by the thumb's width sends the learner a few seconds
 *   from where they clicked, every time, on every video.
 * - **`coverageBars`** without a merge draws overlapping translucent blocks, so
 *   re-watched passages look *more* watched than passages seen once — the
 *   opposite of what union coverage means.
 * - **`remainingSec`** on a media element whose `duration` is still `NaN`
 *   produces "NaN verbleibend" on first paint.
 *
 * A component test would catch none of these; they are arithmetic, and they are
 * tested as arithmetic.
 */

import { mergeWatchedSegments, type WatchedSegment } from "./watch.js";

/**
 * The rates the speed menu offers.
 *
 * Capped at 2×. Not a UI preference: the API rejects a report claiming more
 * media seconds than wall-clock seconds allow (`faster_than_wallclock`), so a
 * rate the server would refuse to credit is a rate that silently costs the
 * learner watch time. The tolerance leaves room for 2× and not for 4×.
 */
export const PLAYBACK_RATES: readonly number[] = [0.75, 1, 1.25, 1.5, 1.75, 2];

/** How far a left/right arrow key moves the playhead. */
export const SEEK_STEP_SEC = 5;

/** How far J and L move it — the coarse step, as every video player uses. */
export const SEEK_JUMP_SEC = 10;

/** Volume step for the up/down arrows, as a fraction. */
export const VOLUME_STEP = 0.05;

/**
 * Seconds left, floored at zero and safe before metadata loads.
 *
 * `video.duration` is `NaN` until `loadedmetadata`, and the panel renders
 * before that on every single view.
 */
export function remainingSec(positionSec: number, durationSec: number): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return 0;
  const position = Number.isFinite(positionSec) ? Math.max(0, positionSec) : 0;
  return Math.max(0, durationSec - position);
}

/** Position as a 0–1 fraction of the duration, for the scrub bar's fill. */
export function positionFraction(positionSec: number, durationSec: number): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return 0;
  const position = Number.isFinite(positionSec) ? positionSec : 0;
  return clamp01(position / durationSec);
}

/**
 * Where a pointer landed on the scrub bar, as a 0–1 fraction.
 *
 * Takes the geometry rather than the event so it can be tested without a DOM,
 * and so the one place that could be off by the element's own left offset is
 * the one place that is asserted.
 */
export function seekFraction(
  clientX: number,
  rect: { left: number; width: number },
): number {
  if (!Number.isFinite(rect.width) || rect.width <= 0) return 0;
  return clamp01((clientX - rect.left) / rect.width);
}

/** A fraction back to a position, clamped inside the media. */
export function seekPositionSec(fraction: number, durationSec: number): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return 0;
  return clamp01(fraction) * durationSec;
}

/** Move the playhead by a step, staying inside the media. */
export function nudgePositionSec(
  positionSec: number,
  deltaSec: number,
  durationSec: number,
): number {
  const position = Number.isFinite(positionSec) ? positionSec : 0;
  const next = position + deltaSec;
  if (!Number.isFinite(durationSec) || durationSec <= 0) return Math.max(0, next);
  return Math.min(durationSec, Math.max(0, next));
}

export function clampVolume(volume: number): number {
  return Number.isFinite(volume) ? clamp01(volume) : 0;
}

/**
 * The next rate in the menu, wrapping.
 *
 * Wrapping rather than stopping at 2× so the keyboard shortcut is reversible
 * without a second key — a learner who overshoots presses it again rather than
 * reaching for the mouse.
 */
export function nextPlaybackRate(current: number): number {
  const index = PLAYBACK_RATES.indexOf(current);
  if (index === -1) return 1;
  return PLAYBACK_RATES[(index + 1) % PLAYBACK_RATES.length] ?? 1;
}

export interface CoverageBar {
  /** Percentage from the left edge, 0–100. */
  readonly startPercent: number;
  /** Width as a percentage of the whole bar, 0–100. */
  readonly widthPercent: number;
}

/**
 * The watched passages, as bars to draw over the scrub track.
 *
 * **Merged before measuring**, which is the entire point. Drawing the raw
 * segments would stack translucent blocks wherever a learner rewound, so a
 * passage watched three times would look darker than one watched once — and a
 * learner reading that as "more complete" would be reading the exact opposite
 * of what union coverage means. The merge here is the same function the server
 * computes the credited percentage with, so the bar and the number cannot tell
 * different stories.
 *
 * Segments beyond the duration are clipped rather than dropped: a re-encode
 * that shortened a video by a second should not erase the whole last passage
 * from the bar.
 */
export function coverageBars(
  segments: readonly WatchedSegment[],
  durationSec: number,
): readonly CoverageBar[] {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return [];

  const bars: CoverageBar[] = [];
  for (const segment of mergeWatchedSegments(segments)) {
    const start = Math.max(0, Math.min(durationSec, segment.startSec));
    const end = Math.max(0, Math.min(durationSec, segment.endSec));
    if (end <= start) continue;

    bars.push({
      startPercent: (start / durationSec) * 100,
      widthPercent: ((end - start) / durationSec) * 100,
    });
  }

  return bars;
}

/**
 * The buffered ranges, as bars, straight from a `TimeRanges`-shaped object.
 *
 * Taken as a plain array of pairs rather than a `TimeRanges` so this stays
 * testable without a media element; the component does the two-line conversion.
 */
export function bufferedBars(
  ranges: ReadonlyArray<readonly [number, number]>,
  durationSec: number,
): readonly CoverageBar[] {
  return coverageBars(
    ranges.map(([startSec, endSec]) => ({ startSec, endSec })),
    durationSec,
  );
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
