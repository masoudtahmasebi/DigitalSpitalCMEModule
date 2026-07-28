/**
 * Turns `<video>` playback into the watched intervals the API expects (P3-03).
 *
 * ## What this is and is not
 *
 * This is a **reporter**, not a gate. It observes the element and describes
 * what was played; the API merges those intervals, computes the union, and
 * decides whether the learner may proceed. Every number produced here is
 * re-derived server-side, and the server rejects anything implausible —
 * reversed, out of bounds, or faster than wall-clock. Nothing here can unlock
 * anything.
 *
 * That division is why this file can be simple and still be safe: a bug in it
 * costs a learner watch credit they earned (annoying, recoverable) but cannot
 * grant credit they did not (a compliance incident).
 *
 * ## How an interval is built
 *
 * On each `timeupdate` while playing, the gap between the last observed
 * position and the current one is examined:
 *
 * - a **small forward step** is normal playback and extends the open interval;
 * - a **jump** (forward or backward) beyond the tolerance is a seek: the open
 *   interval closes at the last observed position and a new one opens at the
 *   new position.
 *
 * The tolerance is deliberately generous. `timeupdate` fires roughly every
 * 250 ms but a busy main thread, a background tab or a slow decode can stretch
 * that to seconds; treating a legitimately-played 1.5 s gap as a seek would
 * lose real watch time. The server's `faster_than_wallclock` check is what
 * bounds abuse, so this side can afford to be forgiving.
 *
 * Playback rate is not consulted. At 2× the learner covers twice the media
 * seconds in the same wall-clock time — and the media seconds are what the
 * accreditation counts, so the intervals are simply correct as observed. The
 * server independently checks the wall-clock budget.
 */

export interface Segment {
  readonly startSec: number;
  readonly endSec: number;
}

/** Beyond this, a position change is a seek rather than playback. */
const SEEK_TOLERANCE_SEC = 2;

/** Shorter than this and the interval is noise — a stray event, not viewing. */
const MIN_SEGMENT_SEC = 0.25;

export class WatchTracker {
  #open: { start: number; end: number } | undefined;
  #pending: Segment[] = [];

  /**
   * Record an observed playhead position.
   *
   * `playing` is passed in rather than read off the element so the caller
   * decides what counts — a paused element still fires `timeupdate` while
   * seeking, and that is not watching.
   */
  observe(positionSec: number, playing: boolean): void {
    if (!Number.isFinite(positionSec) || positionSec < 0) return;

    if (!playing) {
      this.closeOpen();
      return;
    }

    const open = this.#open;
    if (open === undefined) {
      this.#open = { start: positionSec, end: positionSec };
      return;
    }

    const delta = positionSec - open.end;
    if (delta >= 0 && delta <= SEEK_TOLERANCE_SEC) {
      open.end = positionSec;
      return;
    }

    // A seek: bank what was genuinely played, then start fresh.
    this.closeOpen();
    this.#open = { start: positionSec, end: positionSec };
  }

  /** Playback stopped — pause, ended, seeking, or the component unmounting. */
  closeOpen(): void {
    const open = this.#open;
    this.#open = undefined;
    if (open === undefined) return;
    if (open.end - open.start < MIN_SEGMENT_SEC) return;
    this.#pending.push({ startSec: open.start, endSec: open.end });
  }

  /**
   * Hand over everything recorded so far, including the interval still in
   * progress, and reset.
   *
   * The open interval is included as a snapshot and then reopened at the
   * current position, so a learner who watches twenty minutes without pausing
   * still has their progress flushed periodically rather than losing it all if
   * the tab is closed.
   */
  drain(): Segment[] {
    const open = this.#open;
    this.closeOpen();
    const drained = this.#pending;
    this.#pending = [];
    if (open !== undefined) this.#open = { start: open.end, end: open.end };
    return drained;
  }

  /** True when there is something worth sending. */
  get hasPending(): boolean {
    if (this.#pending.length > 0) return true;
    const open = this.#open;
    return open !== undefined && open.end - open.start >= MIN_SEGMENT_SEC;
  }
}

/**
 * Merge adjacent intervals before sending.
 *
 * Purely a bandwidth measure — the server computes the authoritative union
 * regardless, and the contract caps a report at 500 segments. A twenty-minute
 * video flushed every fifteen seconds would otherwise send eighty near-adjacent
 * intervals that describe one continuous view.
 */
export function coalesce(segments: readonly Segment[], gapSec = 0.5): Segment[] {
  const sorted = [...segments].sort((a, b) => a.startSec - b.startSec);
  const merged: Segment[] = [];

  for (const segment of sorted) {
    const last = merged[merged.length - 1];
    if (last !== undefined && segment.startSec <= last.endSec + gapSec) {
      merged[merged.length - 1] = {
        startSec: last.startSec,
        endSec: Math.max(last.endSec, segment.endSec),
      };
      continue;
    }
    merged.push(segment);
  }

  return merged;
}
