/**
 * Where a learner resumes, and how far they may seek (P15-01).
 *
 * Two rules, both of which decide what counts towards a CME point, so both are
 * here rather than in the player. The client renders the answer; it does not
 * reach it (CLAUDE.md §4 invariant 1).
 *
 * ## Resuming rewinds to the start of the minute
 *
 * A learner who leaves at 14:35 comes back to **14:00**, not to 14:35.
 *
 * The reason is comprehension rather than accounting: dropping somebody into
 * the middle of a sentence they have already half-forgotten is worse than
 * replaying thirty seconds they have seen. The union-of-intervals coverage
 * makes the replay free — re-watching the same seconds cannot inflate the
 * percentage, because a union counts each second once however often it is
 * watched (invariant 5). So the rewind costs the learner a little time and
 * costs the compliance record nothing.
 *
 * It is deliberately the *containing* minute and not "sixty seconds back":
 * 14:35 → 14:00 is predictable and lands on a number the learner can see on
 * the clock, where 14:35 → 13:35 lands somewhere arbitrary.
 *
 * ## Seeking forward is not allowed past what has been watched
 *
 * `isSeekAllowed` in `watch.ts` is the rule. What this file adds is the
 * *position* the player has to clamp to, so that the rule can be enforced in
 * the interface rather than only detected afterwards. A scrub bar that lets a
 * learner drag to the end and then silently refuses to credit it is a worse
 * experience than one that will not drag there.
 *
 * Both are enforced twice regardless: the player clamps, and the API validates
 * every reported segment against the wall clock (`validateSegments`). The
 * clamp is a courtesy; the validation is the gate.
 */

import {
  maxWatchedPosition,
  SEEK_CEILING_TOLERANCE_SEC,
  type WatchedSegment,
} from "./watch.js";

/**
 * The granularity a resume rewinds to.
 *
 * A minute, matching the `mm:ss` the player displays. Anything finer would not
 * be visible to the learner as a rule; anything coarser starts costing real
 * time on a 25-minute module.
 */
export const RESUME_GRANULARITY_SEC = 60;

export interface ResumeInput {
  /** Where playback stopped, as last reported and stored. */
  readonly lastPositionSec: number;
  /** The content's length, when known. Absent for a source not yet probed. */
  readonly durationSec?: number | null | undefined;
}

/**
 * The second playback should start from.
 *
 * Floored to the containing minute, never negative, and never past the end —
 * a stored position beyond the duration means the duration was corrected
 * downwards after the fact, and resuming past the end would present as a video
 * that refuses to play.
 */
export function resumePosition(input: ResumeInput): number {
  const last = input.lastPositionSec;
  if (!Number.isFinite(last) || last <= 0) return 0;

  const floored = Math.floor(last / RESUME_GRANULARITY_SEC) * RESUME_GRANULARITY_SEC;

  const duration = input.durationSec;
  if (duration === undefined || duration === null || !Number.isFinite(duration)) {
    return floored;
  }

  // At or past the end: the module is finished, so the honest resume point is
  // the last whole minute rather than the very end, where there is nothing to
  // watch and the controls look broken.
  if (floored >= duration) {
    return Math.max(
      0,
      Math.floor(Math.max(0, duration - 1) / RESUME_GRANULARITY_SEC) *
        RESUME_GRANULARITY_SEC,
    );
  }

  return floored;
}

/**
 * The furthest second the player may seek to.
 *
 * The end of what has actually been watched, plus a small tolerance so that
 * nudging the scrub bar forward by a frame at the live edge is not refused —
 * the same tolerance `isSeekAllowed` applies, and it is here so the two cannot
 * drift apart.
 *
 * That tolerance was five seconds, which is what the right-arrow key moves, so
 * the key stepped exactly onto the ceiling and a learner could walk the video
 * in five-second hops. It is now `SEEK_CEILING_TOLERANCE_SEC`, defined in
 * `watch.ts` beside the rule that applies it — see there for the whole of it
 * (P154-01).
 *
 * A learner who has watched nothing may still not seek: the ceiling is zero
 * and the video plays from the start, which is the point.
 */
export function seekCeiling(
  segments: readonly WatchedSegment[],
  toleranceSec = SEEK_CEILING_TOLERANCE_SEC,
): number {
  return maxWatchedPosition(segments) + toleranceSec;
}

/**
 * There is deliberately no `clampSeek` taking segments.
 *
 * There was one, and it composed the two functions either side of this comment
 * into a single call — which is convenient and is the one thing the split
 * exists to prevent. The two halves live on opposite sides of the API boundary
 * on purpose: the **server** turns segments into `seekCeilingSec`, and the
 * **client** clamps against that number. A function that does both can only be
 * called somewhere that holds both, and on the client that means recomputing
 * the server's answer from its inputs — which `clampSeekToLimit` below names as
 * how the two come to disagree (CLAUDE.md §4 invariant 6).
 *
 * So it was not merely unused: any use of it would have been the bug. Removed
 * in P76-02, found by `scripts/unused-rules.mjs` once that scanner stopped
 * skipping files it mistook for binary.
 */

/**
 * `targetSec`, clamped against a limit that has already been computed.
 *
 * This is the form the player uses: the ceiling reaches it as a number from the
 * API (`seekCeilingSec`) rather than as a set of intervals, because the client
 * is a renderer and recomputing the server's answer from its inputs is how the
 * two come to disagree (CLAUDE.md §4 invariant 6).
 *
 * A non-finite limit means *no* limit. That is the deliberate direction to fail
 * in: a missing ceiling should leave the controls working, because the ceiling
 * is not what enforces the gate — the union of reported intervals is, and it is
 * computed on the server from segments validated against the wall clock. A
 * player that locked itself when a field went missing would break watching for
 * everyone in exchange for no compliance benefit at all.
 */
export function clampSeekToLimit(targetSec: number, limitSec: number): number {
  if (!Number.isFinite(targetSec) || targetSec < 0) return 0;
  if (!Number.isFinite(limitSec)) return targetSec;
  return Math.min(targetSec, Math.max(0, limitSec));
}

/**
 * The limit the player enforces, combining the server's ceiling with this
 * session's own playback.
 *
 * `seekCeilingSec` is only as fresh as the last progress flush, which is every
 * fifteen seconds. Enforcing it alone would drag a *playing* video backwards
 * the moment the playhead passed the last flushed second — the learner watching
 * normally would be the one punished, which is exactly backwards.
 *
 * So the limit is whichever is further: what the server has credited, or what
 * this session has actually played through. `reachedSec` must only be advanced
 * by ordinary playback, never by a seek; advancing it on a seek would let the
 * limit pull itself up by its own bootstraps.
 */
export function playerSeekLimit(
  serverCeilingSec: number | null | undefined,
  reachedSec: number,
): number {
  if (
    serverCeilingSec === null ||
    serverCeilingSec === undefined ||
    !Number.isFinite(serverCeilingSec)
  ) {
    return Number.POSITIVE_INFINITY;
  }
  const reached = Number.isFinite(reachedSec) ? Math.max(0, reachedSec) : 0;
  return Math.max(Math.max(0, serverCeilingSec), reached);
}
