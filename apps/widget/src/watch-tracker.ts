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

import { MAX_PLAYBACK_RATE } from "@ds/domain";

export interface Segment {
  readonly startSec: number;
  readonly endSec: number;
}

/** Beyond this, a position change is a seek rather than playback — at 1×. */
const SEEK_TOLERANCE_SEC = 2;

/**
 * The tolerance above is **media** seconds, and playback rate turns it into a
 * different amount of real time (P153-02).
 *
 * `observe` is driven by `timeupdate`, which browsers fire roughly four times a
 * second and throttle freely — a background tab, a GC pause, a slow frame. When
 * two samples land more than the tolerance of *media* apart, the tracker reads a
 * seek, banks the open interval and starts fresh at the new position, so the
 * span between is never recorded. Watched, and thrown away:
 *
 *     observe(100) observe(101) observe(104) observe(105)
 *       -> [100,101] [104,105]        101-104 is gone
 *
 * At 1× that needs a two-second stall. At 2× the media advances twice as fast,
 * so **one** second of stall is enough — the faster a physician watches, the
 * more of it they lose. Scaling by the rate keeps the bound meaning what it was
 * written to mean, half a wall-clock second of missed samples, at every rate the
 * player offers.
 *
 * It does not widen what counts as playback: a real forward seek is a jump of
 * many seconds and stays a seek at every rate. And the server bounds the total
 * independently (`faster_than_wallclock`), which is why a client-side tolerance
 * can be forgiving about lag without being a way to skip.
 *
 * Clamped at `MAX_PLAYBACK_RATE` so a tampered `playbackRate` cannot widen it:
 * the same cap the server credits against, from the same constant.
 */
function seekToleranceFor(rate: number): number {
  const usable =
    Number.isFinite(rate) && rate > 0 ? Math.min(rate, MAX_PLAYBACK_RATE) : 1;
  return SEEK_TOLERANCE_SEC * usable;
}

/** Shorter than this and the interval is noise — a stray event, not viewing. */
const MIN_SEGMENT_SEC = 0.25;

export class WatchTracker {
  /**
   * `continued` records that this interval opened at the previous one's end
   * rather than where the sample landed — see `#startFor`. It is what lets the
   * noise filter below tell a stray event from the tail of a real view.
   */
  #open:
    | {
        start: number;
        end: number;
        continued: boolean;
        /** When the last sample landed, for the wall-clock test in `observe`. */
        observedAtMs: number;
      }
    | undefined;
  #pending: Segment[] = [];

  /**
   * Where the last interval ended, so continued playback resumes from it.
   *
   * ## The bug this exists to close
   *
   * Every interval used to begin at the *first `timeupdate` after it opened*,
   * and `timeupdate` fires about four times a second. So every close-and-resume
   * — a pause, a flush, a backgrounded tab — silently dropped up to a quarter
   * of a second of material the learner did watch.
   *
   * Individually invisible. In aggregate decisive: watching a 25 s video from
   * end to end in a browser credited **97 %**, and `required_watch_percent`
   * defaults to 100 and is 100 on the MEDICE course. The gate was not strict,
   * it was **unreachable** — a physician could watch every frame of an
   * accredited Fortbildung and never be allowed to finish it.
   *
   * Continuing from the recorded end rather than from the next sample is not a
   * loosening: it credits only the span between where playback demonstrably
   * stopped and where it demonstrably resumed, and only when that span is
   * within `SEEK_TOLERANCE_SEC` — the same bound that already separates
   * playback from a seek. A backward jump never continues, so rewinding cannot
   * manufacture coverage, and the server's `faster_than_wallclock` check bounds
   * the total independently.
   */
  #resumeFrom: number | undefined;

  /**
   * Record an observed playhead position.
   *
   * `playing` is passed in rather than read off the element so the caller
   * decides what counts — a paused element still fires `timeupdate` while
   * seeking, and that is not watching.
   */
  observe(
    positionSec: number,
    playing: boolean,
    rate = 1,
    /**
     * The wall clock, injectable so the throttling case above is testable —
     * the whole property is about elapsed real time, and a test that could not
     * control it could only assert the position arithmetic it already had.
     */
    nowMs: number = Date.now(),
  ): void {
    if (!Number.isFinite(positionSec) || positionSec < 0) return;

    if (!playing) {
      this.closeOpen();
      return;
    }

    const tolerance = seekToleranceFor(rate);

    const open = this.#open;
    if (open === undefined) {
      const start = this.#startFor(positionSec, tolerance);
      this.#open = {
        start,
        end: positionSec,
        continued: start !== positionSec,
        observedAtMs: nowMs,
      };
      return;
    }

    const delta = positionSec - open.end;
    if (delta >= 0 && delta <= tolerance) {
      open.end = positionSec;
      open.observedAtMs = nowMs;
      return;
    }

    /*
     * Throttled playback and a forward scrub look identical in position, and
     * differ completely in **wall-clock time** (P166-01).
     *
     * The client reported holes four times; the last was ninety seconds missing
     * from the middle of a video that had played end to end, while they *"let
     * the video be played and did my own stuff"* — a backgrounded tab.
     * `timeupdate` fires about four times a second in front; backgrounded, the
     * browser throttles that timer hard **while the media element keeps
     * playing** — audio does not stop — so the next sample lands tens of
     * seconds later, tens of seconds on. Read as a seek, that banks the
     * interval and opens a new one past a hole `fillSamplingGaps` cannot close:
     * its limit is `min(60, duration × 0.1)`.
     *
     * The first attempt at this simply credited every forward jump, and three
     * existing tests refused it — correctly. A scrub from 0:05 to 5:00 is a
     * forward jump too, and crediting it would hand a learner 295 seconds they
     * did not watch. One of those tests is explicitly an abuse case. The delta
     * rule is a second line of defence behind `VideoPlayer`'s `seeking` event
     * and it is not mine to remove.
     *
     * What tells the two apart is time. A media element cannot advance
     * `currentTime` faster than wall-clock × rate, so **N media seconds of real
     * playback take at least N/rate seconds of real time** — throttled or not.
     * A scrub covers N media seconds in approximately none. So the jump is
     * bridged only when the clock agrees it could have been played, at the
     * fastest rate the player offers, with one sampling step of slack.
     *
     * This is the same shape as the server's `faster_than_wallclock` budget
     * (P153-01), and deliberately not a replacement for it: this side decides
     * what to *report*, the server decides what to *credit*, and the server
     * re-derives it from its own clock. A client that lies here still cannot
     * get past that.
     */
    const elapsedSec = (nowMs - open.observedAtMs) / 1000;
    const playableSec = elapsedSec * MAX_PLAYBACK_RATE + tolerance;
    if (delta > 0 && delta <= playableSec) {
      open.end = positionSec;
      open.observedAtMs = nowMs;
      return;
    }

    // A backward jump: bank what was genuinely played, then start fresh **at
    // the new position**. Not `#startFor` — a rewind is precisely the case
    // continuity must not bridge, and `closeOpen` has just moved `#resumeFrom`
    // to the old end which is now somewhere else entirely.
    this.closeOpen();
    this.#resumeFrom = undefined;
    this.#open = {
      start: positionSec,
      end: positionSec,
      continued: false,
      observedAtMs: nowMs,
    };
  }

  /**
   * Where an interval opening at `positionSec` should actually start.
   *
   * The recorded end of the previous interval when playback simply carried on
   * across a close; otherwise the position itself.
   */
  #startFor(positionSec: number, toleranceSec: number): number {
    const resume = this.#resumeFrom;
    if (resume === undefined) return positionSec;
    const gap = positionSec - resume;
    // Forward only, and within one playback step. A backward gap is a rewind.
    return gap >= 0 && gap <= toleranceSec ? resume : positionSec;
  }

  /** Playback stopped — pause, ended, seeking, or the component unmounting. */
  closeOpen(): void {
    const open = this.#open;
    this.#open = undefined;
    if (open === undefined) return;
    // Recorded even when the interval is too short to bank: the *boundary* is
    // what a resume needs, and a sub-threshold interval is exactly the case
    // that used to lose it — `drain` reopens a zero-length one on every flush.
    this.#resumeFrom = open.end;
    // The noise filter, and the one case it must not apply to.
    //
    // A short interval that opened where the last one closed is not a stray
    // event — it is the tail of a view already in progress, and dropping it
    // leaves a hole. That is not hypothetical: a flush landing within a
    // quarter-second of a video's end deleted the final fragment and left the
    // learner at 99 % of a course requiring 100. An interval that opened on
    // its own, however short, is still noise.
    if (!open.continued && open.end - open.start < MIN_SEGMENT_SEC) return;
    if (open.end <= open.start) return;
    this.#pending.push({ startSec: open.start, endSec: open.end });
  }

  /**
   * Hand over everything recorded so far, including the interval still in
   * progress, and reset.
   *
   * A learner who watches twenty minutes without pausing still has their
   * progress flushed periodically rather than losing it all if the tab closes.
   * There is no explicit reopen here any more: `closeOpen` leaves the boundary
   * in `#resumeFrom` and the next `observe` continues from it, which is the
   * same rule a pause and a backgrounded tab now follow. One rule, three
   * callers — the reopen was a fourth that only half worked, because it was
   * skipped whenever the interval had already been closed a moment earlier.
   */
  drain(): Segment[] {
    this.closeOpen();
    const drained = this.#pending;
    this.#pending = [];
    return drained;
  }

  /**
   * Put drained intervals back, because the request carrying them failed
   * (P154-02).
   *
   * ## What this repairs
   *
   * `drain()` empties `#pending` unconditionally. The caller then posts them,
   * and if that post failed — offline, timeout, 429, a 5xx — the intervals were
   * **gone**: nothing held them and nothing re-sent them. The next flush
   * carried only what had been watched since. `LessonScreen`'s catch said "the
   * next flush retries", and it did not; the seconds a physician watched during
   * a connectivity blip were discarded, permanently, under a screen reading
   * "Ihr Fortschritt wird automatisch gespeichert".
   *
   * Restored at the **front**, so the union is offered in the order it was
   * watched, and merged by `coalesce` on the way out like everything else. The
   * server merges again and validates against the wall clock, so returning an
   * interval here cannot credit anything that was not played — it only stops
   * the client throwing away its own evidence.
   *
   * Nothing here is time-bounded on purpose: the pending list only grows while
   * the network is failing, and the tracker lives no longer than the screen.
   * A durable queue across reloads is a different decision, with storage and
   * identity consequences, and is not this.
   */
  restore(segments: readonly Segment[]): void {
    if (segments.length === 0) return;
    this.#pending = [...segments, ...this.#pending];
  }

  /** True when there is something worth sending. */
  get hasPending(): boolean {
    if (this.#pending.length > 0) return true;
    const open = this.#open;
    if (open === undefined) return false;
    if (open.end <= open.start) return false;
    return open.continued || open.end - open.start >= MIN_SEGMENT_SEC;
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
