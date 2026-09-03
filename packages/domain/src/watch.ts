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
  | "beyond_ceiling"
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
   * time — at the fastest rate the player offers it could have watched 60 s —
   * so a claim beyond that is rejected.
   *
   * Omit only when no previous report exists to measure against.
   */
  readonly elapsedWallClockSec?: number;
  /**
   * Slack for clock jitter and the reporting boundary. Default 2 s.
   *
   * **Not** where playback rate is accounted for — that is `MAX_PLAYBACK_RATE`,
   * a multiplier on the elapsed time, because the overclaim from a fast rate
   * grows with the reporting interval and a constant cannot follow it
   * (P153-01).
   */
  readonly wallClockToleranceSec?: number;
  /**
   * What this enrolment had already watched of this content (P168-01).
   *
   * The player is given `seekCeilingSec` and clamps to it, and until now that
   * was the *only* place the rule lived: `rejectionReason` refused a segment
   * past the **duration** and nothing refused one past the **ceiling**. So
   * "Vorspulen ist nicht möglich" was a property of the client, and a report
   * claiming `[1400, 1489]` on a video nobody had opened was stored.
   *
   * That is §4 invariant 1 — the client is a renderer and may never be the
   * source of truth for anything deciding a CME point — and it is what let the
   * client ask the question this exists to answer: *"how can i have reached the
   * end of the video if i have not watched that part when i can not skip?"*
   *
   * Omit it and the check does not run. `undefined` means "the caller holds no
   * record to compare against", which is not the same as "nothing was watched"
   * — the latter is `[]`, and it correctly pins a first report to the start of
   * the video.
   */
  readonly previousSegments?: readonly WatchedSegment[];
}

const DEFAULT_WALL_CLOCK_TOLERANCE_SEC = 2;

/**
 * The fastest the player can be set to play, and therefore the fastest a
 * learner can legitimately watch (P153-01).
 *
 * ## The defect this closes
 *
 * The budget used to be `elapsed + tolerance`, with the tolerance described as
 * "slack for playback-rate variation" — two seconds of it, flat. The widget
 * flushes every 15 s (`LessonScreen.tsx`), so one heartbeat at the rates the
 * player offers claims:
 *
 * | rate  | claimed | budget (15 + 2) | outcome      |
 * | ----- | ------- | --------------- | ------------ |
 * | 1×    | 15 s    | 17 s            | accepted     |
 * | 1.25× | 18.75 s | 17 s            | **rejected** |
 * | 1.5×  | 22.5 s  | 17 s            | **rejected** |
 * | 2×    | 30 s    | 17 s            | **rejected** |
 *
 * Every rate above 1× the product itself offers was thrown away **whole** —
 * `validateSegments` rejects a segment, not the excess — so a physician who
 * sped up watched the video and was credited nothing for it. It arrives as
 * "watched to the end, 29 % angesehen", with the gap list naming passages they
 * are certain they saw.
 *
 * ## Why the bound is a multiplier and not a bigger constant
 *
 * A flat tolerance cannot express this: the overclaim grows with the flush
 * interval, so any constant that fits a 15-second heartbeat at 2× is a
 * constant a slow reporter can hide a skip behind. The honest bound is the
 * product's own cap — a learner may watch at up to 2×, so up to two media
 * seconds per real second may be credited, and not one more.
 *
 * The anti-skip property this budget exists for is unchanged in kind: a client
 * posting `[0, duration]` in one call still cannot be credited, because a
 * whole video is far more than twice the elapsed time. It is weakened by
 * exactly the factor the speed menu already hands every learner.
 *
 * `PLAYBACK_RATES` in `playback.ts` is checked against this, so the menu and
 * the budget cannot drift into disagreeing about what a learner is allowed to
 * do (§9.11 — one rule, not two opinions). It lives here rather than there
 * because `playback.ts` imports this module and not the other way round.
 */
export const MAX_PLAYBACK_RATE = 2;

/**
 * How far past the watched edge the player may seek (P154-01).
 *
 * ## What it was, and what its own comment said it was for
 *
 * Five seconds, with `seekCeiling` explaining it as "a small tolerance so that
 * nudging the scrub bar forward by a frame at the live edge is not refused".
 * A frame is about 0.04 s. Five seconds is a hundred and twenty-five of them —
 * and it is exactly `SEEK_STEP_SEC`, the distance the right-arrow key moves.
 *
 * So one press of the forward key landed exactly on the ceiling. Playback then
 * carried the ceiling forward, and the next press did it again: a learner could
 * walk an entire video in five-second hops, leaving a five-second hole each
 * time, while the player said "Vorspulen ist nicht möglich". It arrived as a
 * real capture (DEP-25) whose union has two gaps of exactly 5.000000 s and a
 * `seekCeilingSec` of `maxWatched + 5`.
 *
 * ## Why 0.5
 *
 * The stated purpose — a nudge at the live edge — needs a frame. What actually
 * has to be forgiven is one `timeupdate` sample of jitter, which browsers fire
 * about every 0.25 s, so half a second covers a sample and a nudge with room
 * to spare. It is the same magnitude as `BOUNDARY_TOLERANCE_SEC`, which exists
 * for the same kind of reason one function down.
 *
 * The property that matters is not the number but the ratio: the tolerance must
 * stay **below the smallest forward control the player offers**, or that control
 * is a way to skip. `watch.test.ts` asserts exactly that against
 * `SEEK_STEP_SEC` and `SEEK_JUMP_SEC`, so raising this back to 5 fails a test
 * rather than quietly reopening the hole.
 *
 * This does not restrict rewinding, which is unbounded and always has been:
 * coverage is a union, so re-watching cannot inflate it.
 */
export const SEEK_CEILING_TOLERANCE_SEC = 0.5;

/**
 * How far past the watched edge a *reported* segment may begin (P168-01).
 *
 * The player may seek to `SEEK_CEILING_TOLERANCE_SEC` past the edge — that is
 * what the ceiling is — and then begin playing there, and the first `timeupdate`
 * lands a sample later. So the bound is the ceiling's own tolerance plus a
 * couple of sampling steps, and nothing more: this number is the width of the
 * crack a forward jump can squeeze through, and `watch.test.ts` holds it below
 * the smallest forward control the player offers for the same reason
 * `SEEK_CEILING_TOLERANCE_SEC` is held there.
 *
 * It is not, on its own, what stops a client hopping the video in
 * tolerance-wide steps. That is `validateSegments` charging the hop to the
 * wall-clock budget — see the `gap` there, and the exploit it closes.
 */
export const CEILING_ACCEPTANCE_TOLERANCE_SEC = SEEK_CEILING_TOLERANCE_SEC + 2;

/**
 * The widest hole that can be a sampling artefact rather than content
 * (P158-02).
 *
 * Bounded twice, because one bound is wrong at one end of the range. A minute
 * is generous for a forty-minute Fortbildung and absurd for a ten-second one —
 * the client asked exactly that: *"what happens if a video is only 10 seconds
 * long?"* So it is also capped at a tenth of the video, which keeps the rule
 * about jitter rather than about content whatever the length.
 */
export const SAMPLING_GAP_MAX_SEC = 60;
const SAMPLING_GAP_FRACTION = 0.1;

/**
 * Close the holes a sampling clock leaves, and nothing else.
 *
 * ## What the holes are
 *
 * `timeupdate` fires about four times a second and browsers throttle it freely.
 * A real forty-minute session arrived with **thirteen** interior gaps totalling
 * 37.52 s — the largest exactly 5.000 s — after the learner had watched the
 * video from end to end. The screen said 98 % and named three of them, and the
 * learner was asked to go back and re-watch seconds they had already seen.
 *
 * ## Why this is not the rule that had to be reverted
 *
 * S32's first form credited every whole minute below the furthest point
 * reached, and an existing test caught it immediately: a learner drags to 09:55
 * of a ten-minute video, the client posts one five-second fragment, and nine
 * unwatched minutes are credited. The lesson was that the seek ceiling
 * constrains the *player*, not the API — anything that can post a segment can
 * put one anywhere.
 *
 * This bridges only **between two watched regions**. A single fragment has no
 * neighbour, so nothing is bridged and the drag case is refused structurally
 * rather than by a threshold. Nothing is ever added before the first segment or
 * after the last, so an unwatched beginning stays unwatched and an unwatched end
 * stays unwatched — which is what the completion gate actually reads.
 *
 * A gap wide enough to be content is left alone. To have it bridged, a client
 * would have to post coverage on *both* sides of every hole, at most a minute
 * apart, all the way through — which is watching the video with extra steps.
 *
 * Derived, never stored: the reported union stays the evidence.
 */
export function fillSamplingGaps(
  segments: readonly WatchedSegment[],
  durationSec: number,
): readonly WatchedSegment[] {
  const merged = mergeWatchedSegments(segments);
  if (merged.length < 2) return merged;

  const limit = Math.min(
    SAMPLING_GAP_MAX_SEC,
    Number.isFinite(durationSec) && durationSec > 0
      ? durationSec * SAMPLING_GAP_FRACTION
      : SAMPLING_GAP_MAX_SEC,
  );

  const out: WatchedSegment[] = [];
  let open = merged[0]!;
  for (const next of merged.slice(1)) {
    if (next.startSec - open.endSec <= limit) {
      open = { startSec: open.startSec, endSec: next.endSec };
      continue;
    }
    out.push(open);
    open = next;
  }
  out.push(open);
  return out;
}

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
 * The tail of a video that is not required to be watched (P93-01).
 *
 * ## Why a whole three seconds, when there is already a half-second snap
 *
 * The client, twice, and the second time after watching a ten-second video to
 * the end and being told **92 % angesehen** with
 * "Diese Stellen fehlen noch: 0:09–0:10":
 *
 * > _"for completion of the video, check how long the video is, and if the user
 * > watches until 3 second less than the end of the video, consider it done!"_
 *
 * `BOUNDARY_TOLERANCE_SEC` was the previous answer to the same shape and it is
 * not enough. It assumes the only error is the sampling interval — the last
 * `timeupdate` landing a fraction before the end — and that is one of at least
 * three:
 *
 * 1. **The sampling interval.** `timeupdate` fires about every 250 ms, and the
 *    last one before `ended` can be a quarter-second short.
 * 2. **A stored length longer than the file.** `durationSec` is written by the
 *    console from the object's own header, and a container whose header
 *    rounds up — or a re-encode after the length was stored — leaves a tail
 *    nobody can ever watch. That is P87-07, still open.
 *  3. **The flush.** A segment is closed at the last observed position, not at
 *    `duration`, so a browser that stops firing events before the end reports
 *    a short interval however carefully the person watched.
 *
 * Half a second covers the first. Three seconds covers all three, and it is
 * what was asked for.
 *
 * ## What it does not weaken
 *
 * The union is still the union: the seconds before the tail must genuinely be
 * covered, so dragging the scrub bar still earns nothing (§4 invariant 5). What
 * changes is the **length being measured against** — the last three seconds of
 * a video are not part of the requirement, for the percentage, for the gate and
 * for the list of gaps alike.
 *
 * On MEDICE's accredited course this is three seconds of a twenty-five minute
 * module — 0.2 % — against a rule the Bescheid states as a proportion of the
 * material. On a ten-second test upload it is 30 %, which is the case that
 * produced the report and is not accredited content.
 *
 * A video shorter than the grace keeps its whole length: shrinking a two-second
 * clip to zero would mark it watched without anybody watching it, which is the
 * one outcome worse than the bug this fixes.
 */
export const TAIL_GRACE_SEC = 3;

/**
 * The length a learner is actually required to cover.
 *
 * Every rule that asks *what is still missing* measures against this rather
 * than the raw length — one place, so the list of gaps and the completion
 * verdict cannot disagree about where a video's requirement ends (§4
 * invariant 6, which P68-02 was about).
 *
 * Note what does **not** use it: the percentage. See `watchedSecondsWithin`.
 */
export function creditedDurationSec(durationSec: number): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return 0;
  return durationSec <= TAIL_GRACE_SEC ? durationSec : durationSec - TAIL_GRACE_SEC;
}

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

  /*
   * Nothing outstanding means the whole video is credited (P94-01).
   *
   * The tail grace used to shrink the **denominator** instead, and the client
   * caught what that costs on a short video: seven seconds of a ten-second
   * upload read "100 % angesehen", and the obvious reading is that the number
   * is not counting what it says it counts —
   *
   *   > "i just watched one second, and the percentage increased, so the
   *   >  percentage is just being added up, not checking exactly what second
   *   >  is being watched"
   *
   * The union *was* being checked; the denominator was the requirement rather
   * than the file, so the number was a fraction of something the learner
   * cannot see. Now it is a fraction of the video, always, and the grace lives
   * in this one branch: when there is nothing left for the learner to go and
   * watch, the video is fully watched — including its last three seconds.
   *
   * The property that falls out, and which is the point:
   *
   *     watchedPercent(…) === 100   ⟺   uncoveredSpans(…) is empty
   *
   * One statement, drawn two ways. P68-02 was two readings of one number that
   * stopped agreeing; this makes the disagreement unrepresentable.
   */
  if (uncoveredSpans(merged, durationSec).length === 0) return durationSec;

  const covered = merged.reduce((total, segment) => {
    const start = Math.max(0, Math.min(segment.startSec, durationSec));
    const end = Math.max(0, Math.min(segment.endSec, durationSec));
    return total + Math.max(0, end - start);
  }, 0);

  return Math.min(covered, durationSec);
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
 *
 * **Of the whole video** (P94-01). A learner who has seen seven seconds of ten
 * is shown 70, not 100 — the number means what its label says. It reaches 100
 * only when `uncoveredSpans` is empty, which is where the tail grace lives.
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
  toleranceSec = SEEK_CEILING_TOLERANCE_SEC,
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
      : options.elapsedWallClockSec * MAX_PLAYBACK_RATE + tolerance;

  let claimed = 0;

  /*
   * The furthest the record says this learner has reached, which is the
   * furthest a segment may begin (P168-01). Recomputed from stored state
   * rather than trusted from the request — the client is told the ceiling, it
   * does not get to declare it.
   *
   * It advances as segments in **this** report are accepted, and it has to: a
   * flush carries a run of consecutive intervals — `[100, 115]`, `[115.2, 130]`
   * — and against a ceiling fixed at the stored maximum every interval after
   * the first would be refused. That is not a hypothetical; it is what one
   * heartbeat of an ordinary player looks like.
   *
   * `undefined` means the caller holds no record to compare against, and then
   * the rule does not run at all.
   */
  let furthest =
    options.previousSegments === undefined
      ? undefined
      : maxWatchedPosition(options.previousSegments);

  for (const reported of segments) {
    const reason = rejectionReason(reported, options.durationSec);

    if (reason !== undefined) {
      rejected.push({ segment: reported, reason });
      continue;
    }

    if (
      furthest !== undefined &&
      reported.startSec > furthest + CEILING_ACCEPTANCE_TOLERANCE_SEC
    ) {
      rejected.push({ segment: reported, reason: "beyond_ceiling" });
      continue;
    }

    /*
     * A tail that runs past the stored duration is clamped, not discarded
     * (P158-01).
     *
     * Browsers do not stop `currentTime` exactly at `duration`: at `ended` it
     * can be a fraction beyond, and the stored length is an authored number
     * that need not match the file to the millisecond either. Rejecting the
     * whole segment for that overshoot threw away every second of the run-up
     * with it — a real session lost 6.369 s because its last sample was
     * 0.282667 s past the end, and `accepted` came back **0** after somebody
     * had watched the video to the finish.
     *
     * Every video's final segment meets this, which is why "I watched the whole
     * thing" and a percentage short of a hundred kept arriving together.
     *
     * Clamping credits only seconds that exist. A segment lying *entirely* past
     * the end is still refused by `rejectionReason` above — there is nothing in
     * it to keep.
     */
    const segment =
      reported.endSec > options.durationSec
        ? { startSec: reported.startSec, endSec: options.durationSec }
        : reported;

    const length = segment.endSec - segment.startSec;

    /*
     * The hole this segment leaves behind is charged to the budget as if it had
     * been watched (P168-01), because it will be: a gap this small is below
     * `fillSamplingGaps`' limit and is credited on every read path.
     *
     * Without this, the tolerance is a free hop. A client posting
     * `[t, t + 0.1]` at `t = furthest + 2.5` walks 2.6 s of video per 0.1 s of
     * budget — twenty-six times real time — and every hole it leaves is bridged
     * into full coverage. Charging the gap makes the hop cost exactly what
     * watching it would have cost, which is the property the wall-clock check
     * was always supposed to have.
     */
    const gap =
      furthest !== undefined && segment.startSec > furthest
        ? segment.startSec - furthest
        : 0;

    if (budget !== undefined && claimed + gap + length > budget) {
      rejected.push({ segment, reason: "faster_than_wallclock" });
      continue;
    }

    claimed += gap + length;
    accepted.push(segment);
    if (furthest !== undefined && segment.endSec > furthest) furthest = segment.endSec;
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
  /*
   * Past the end by more than jitter, or past it entirely (P158-01).
   *
   * A tail that overshoots by a fraction of a second is a browser reporting
   * `currentTime` at `ended`, and the caller clamps it. An overshoot of five
   * hundred seconds on a fifteen-hundred-second video is not jitter, it is a
   * claim, and the pre-existing test that pins it is right: `[0, 2000]` on a
   * 1500 s video stays refused.
   *
   * `TAIL_GRACE_SEC` is the boundary because it is already this file's answer
   * to "how close to the end counts as the end".
   */
  if (segment.startSec >= durationSec) return "beyond_duration";
  if (segment.endSec > durationSec + TAIL_GRACE_SEC) return "beyond_duration";
  return undefined;
}

/**
 * The parts of a video that have **not** been credited (P85-01).
 *
 * ## Why this exists
 *
 * Reported twice, at 95 % and then at 96 % after a re-watch:
 *
 * > _"i have watched the whole thing. this issue is very weird."_
 *
 * Both halves of that are informative. A percentage that *moves* on a second
 * viewing is not a wrong denominator — a stored length longer than the file
 * would pin it at one number for ever. It is a union with holes in it, and the
 * re-watch filled some of them.
 *
 * What the learner had, at that point, was a full progress bar, "noch 0:00",
 * and a number that refused to reach 100 with nothing on screen to act on.
 * That is CLAUDE.md §9.10 — correct and unusable. The gate is right to withhold
 * credit for seconds nobody watched; what was missing is *which seconds*.
 *
 * ## Why it belongs here and not in the player
 *
 * It is the complement of the same union `watchedPercent` divides by, so it has
 * to be derived from the same merged intervals by the same rules — the player
 * computing "what looks unwatched" from a coverage bar would be a second
 * opinion about a number that decides a CME point (§4 invariant 6).
 *
 * Segments are assumed merged and sorted, exactly as `watchedSecondsWithin`
 * assumes, because both are fed by `mergeWatchedSegments`.
 *
 * `toleranceSec` exists so this agrees with what the gate actually counts: a
 * sliver far below a playback sample is not something a person can go and
 * watch, and listing it would send somebody hunting for a gap they cannot
 * close. Default a quarter second — one `timeupdate`.
 *
 * ## The tolerance is a budget for the whole video, not per gap (P94-01)
 *
 * It used to be per gap, which was fine while this only *listed* things.
 * Since `watchedSecondsWithin` decides completion by asking whether this is
 * empty, a per-gap tolerance would be a way to skip content: a client
 * reporting `[0,0.24] [0.49,0.73] …` clears every gap individually and leaves
 * half the video unwatched. Summing first bounds what can be forgiven at a
 * quarter second of the whole file, whatever shape the holes are.
 *
 * The list is filtered to the gaps worth naming, and **never emptied by that
 * filter** — a learner told there is nothing missing while the gate withholds
 * completion is P85-01's report exactly, and is the one state this must not
 * produce.
 */
export function uncoveredSpans(
  segments: readonly WatchedSegment[],
  durationSec: number,
  toleranceSec = 0.25,
): readonly WatchedSegment[] {
  /*
   * Bounded by the credited length, not the raw one (P93-01).
   *
   * This is the list the player prints as "Diese Stellen fehlen noch", and it
   * has to name spans the gate is actually still waiting for. Listing the tail
   * — which no longer counts — sent the client to 0:09–0:10 of a ten-second
   * video to close a gap that had already stopped mattering.
   */
  const credited = creditedDurationSec(durationSec);
  if (credited <= 0) return [];

  const gaps: WatchedSegment[] = [];
  let cursor = 0;

  for (const segment of segments) {
    const start = Math.max(0, Math.min(segment.startSec, credited));
    const end = Math.max(0, Math.min(segment.endSec, credited));
    if (start > cursor) gaps.push({ startSec: cursor, endSec: start });
    cursor = Math.max(cursor, end);
  }

  if (credited > cursor) gaps.push({ startSec: cursor, endSec: credited });

  const outstanding = gaps.reduce((total, gap) => total + (gap.endSec - gap.startSec), 0);
  if (outstanding <= toleranceSec) return [];

  const worthNaming = gaps.filter((gap) => gap.endSec - gap.startSec > toleranceSec);
  return worthNaming.length === 0 ? gaps : worthNaming;
}
