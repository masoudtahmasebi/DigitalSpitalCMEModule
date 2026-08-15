/**
 * Whether a watch gate can be satisfied by the file it is configured against
 * (P76-03).
 *
 * ## Why this exists
 *
 * The watch gate is a percentage of the content's **authored** `durationSec`.
 * Nothing has ever checked that figure against the media it describes, and the
 * two are set by different acts: the length is typed or measured when the
 * content is created, the file is replaced whenever somebody uploads a new one.
 *
 * When the authored length is larger than the file, the gate stops being strict
 * and becomes **impossible**: the seconds it demands do not exist to be watched.
 * The learner sees a progress bar that cannot fill, a countdown that cannot
 * reach zero, and — this is the part that made it a report rather than a
 * grumble — no sentence anywhere explaining why. The instance was a 45-second
 * recording behind a 25:24 length inherited from a seed (P75): «0 % der
 * Fortbildung absolviert» after watching the whole video, and no way forward.
 *
 * P75-01 removed the way a *new* content acquires a wrong length. It could not
 * repair the ones already stored, and it deliberately left the escape hatch for
 * a length that cannot be measured — so this can still happen, and did.
 *
 * ## Why the answer is a report and never a decision
 *
 * This function does not adjust the gate, and no caller may. The percentage
 * that decides a CME point is computed by the API from the authored length
 * (CLAUDE.md §4 invariant 1); a learner's browser silently substituting the
 * file's own length would be the client deciding a compliance outcome, and two
 * physicians with different browsers could then get different answers.
 *
 * So the verdict exists to be **said out loud**: to the learner, who is stuck
 * and is owed an explanation rather than a bar that never moves, and to the
 * operator, who is the only one who can fix it. That is CLAUDE.md §9.10 — when
 * a refusal is correct and unhelpful, do not weaken the refusal; find the
 * audience entitled to the answer.
 */

/**
 * The endpoint tolerance the coverage rollup applies, mirrored here.
 *
 * `watchedSecondsWithin` snaps a union's far end up to the duration when it
 * lands within half a second of it, because a `<video>` cannot report its own
 * endpoints exactly. A file half a second shorter than its authored length is
 * therefore still completable, and calling that misconfigured would put a
 * warning on a course that works.
 *
 * It has to stay equal to `BOUNDARY_TOLERANCE_SEC` in `watch.ts`. The two
 * cannot be imported from one place without making that constant public, and it
 * is deliberately private — so the duplication is named here instead, which is
 * the smaller of the two evils.
 */
const BOUNDARY_TOLERANCE_SEC = 0.5;

export interface MediaLengthInput {
  /** The authored length the watch gate is computed against. */
  readonly configuredDurationSec: number | null | undefined;
  /** The file's own length, as the browser reported it. */
  readonly measuredDurationSec: number | null | undefined;
  /** The course's gate, an integer 0–100. */
  readonly requiredWatchPercent: number;
}

export type MediaLengthVerdict =
  /** The two agree closely enough, or there is not enough information to judge. */
  | { readonly kind: "ok" }
  /**
   * The file is shorter than the gate demands: the section cannot be completed
   * by watching it, however carefully.
   */
  | {
      readonly kind: "unreachable";
      /** Seconds the gate demands that the file does not contain. */
      readonly shortfallSec: number;
      /** The highest percentage the learner could reach, floored as the gate floors. */
      readonly attainablePercent: number;
    }
  /**
   * The file is materially **longer** than its authored length.
   *
   * The opposite mistake and a quieter one: nobody is blocked, so no learner
   * will ever report it. It still matters, because the gate credits a full
   * viewing after the authored number of seconds — so an accredited module can
   * be completed without watching the part that runs past it. That is an
   * accreditation problem for the operator, not a message for the learner.
   */
  | { readonly kind: "overrun"; readonly excessSec: number };

/**
 * How far past the authored length a file may run before it is worth saying so.
 *
 * A few seconds of trailing black or a container's rounding is not a finding.
 * Ten seconds is: at that point the authored figure describes a different cut
 * of the recording.
 */
const OVERRUN_REPORT_THRESHOLD_SEC = 10;

function usable(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Whether a stored length and a measured one describe the same file.
 *
 * A different question from `mediaLengthVerdict`, and deliberately a separate
 * function rather than a second reading of that one: the learner's question is
 * *"can I finish this?"*, which depends on the course's gate, and the operator's
 * is *"is this number right?"*, which does not. Answering the second with the
 * first would stay silent about a stored 600 beside a 590-second file on a
 * course whose gate is 80 % — correct for the learner today, and wrong the
 * moment somebody raises the gate.
 *
 * The same half-second tolerance, for the same reason: a container cannot
 * report its length exactly, and an operator shown a discrepancy of 0.2 s
 * learns only to ignore the message.
 */
export function lengthsAgree(
  storedSec: number | null | undefined,
  measuredSec: number | null | undefined,
): boolean {
  // Nothing to disagree with. An absent stored length is a content being
  // authored, not a content that is wrong.
  if (!usable(storedSec) || !usable(measuredSec)) return true;
  return Math.abs(storedSec - measuredSec) <= BOUNDARY_TOLERANCE_SEC;
}

/**
 * Compare an authored length with the file's own.
 *
 * Silent — `ok` — whenever it cannot be sure. An absent or unreadable measured
 * length is the ordinary case for a source behind a CDN that sends no CORS
 * headers, and warning there would put a permanent error on working courses,
 * which teaches everyone to ignore the warning (§9.2's cousin: a control that
 * cries wolf is worse than none).
 */
export function mediaLengthVerdict(input: MediaLengthInput): MediaLengthVerdict {
  const configured = input.configuredDurationSec;
  const measured = input.measuredDurationSec;

  if (!usable(configured) || !usable(measured)) return { kind: "ok" };

  const required = Number.isFinite(input.requiredWatchPercent)
    ? Math.max(0, Math.min(100, input.requiredWatchPercent))
    : 0;

  // What the learner could reach with a perfect viewing: every second of the
  // file, snapped to the authored end if it lands within the tolerance, and
  // never more than the authored length — exactly `watchedSecondsWithin`.
  const attainableSec = Math.min(measured + BOUNDARY_TOLERANCE_SEC, configured);
  const attainablePercent = Math.floor((attainableSec / configured) * 100);

  if (required > 0 && attainablePercent < required) {
    const demandedSec = (configured * required) / 100;
    return {
      kind: "unreachable",
      shortfallSec: Math.max(0, Math.ceil(demandedSec - measured)),
      attainablePercent,
    };
  }

  const excessSec = measured - configured;
  if (excessSec >= OVERRUN_REPORT_THRESHOLD_SEC) {
    return { kind: "overrun", excessSec: Math.floor(excessSec) };
  }

  return { kind: "ok" };
}
