/**
 * Course completion, and the certification that follows it (P4-05, P51-01).
 *
 * ## Two milestones, not one
 *
 * Finishing the Fortbildung and earning the CME point are **different events
 * separated by time**, and this module is where that separation is decided.
 *
 *   * **The course is complete** when the physician has watched the required
 *     share of the video content and passed the Lernerfolgskontrolle. That is
 *     what the course *is*. Nothing else is asked of them to get there.
 *   * **The completion is certifiable** when the Evaluationsbogen and — for an
 *     accredited course — the EFN are also on file. Only then can a certificate
 *     be issued and a Punktemeldung filed.
 *
 * Until P51-01 these were one condition set, so a physician who had watched
 * every minute and passed the quiz was told the course was *incomplete*
 * because they had not yet filled in an evaluation form. That is both untrue
 * and the point at which somebody abandons an hour of study (CLAUDE.md §9.4 —
 * say what the thing is, in the words of the person holding it).
 *
 * They may now supply the evaluation and the EFN whenever they like. The
 * course stays complete in the meantime and the certification stays visibly
 * outstanding.
 *
 * ## Why `complete` still means certifiable
 *
 * Every existing caller of `complete` gates something that must not happen
 * without an EFN and an evaluation: issuing the Teilnahmebescheinigung,
 * queueing the EIV submission, stamping `completed_at`. Redefining the field
 * they already read would have silently loosened all three at once. So
 * `complete` keeps its meaning exactly, and `courseComplete` is the new,
 * weaker one — the direction that cannot turn a missing EFN into a filed
 * Punktemeldung.
 *
 * ## Not every course awards points
 *
 * A course with no `cmePoints` is not accredited: there is no Punktemeldung to
 * file and no Ärztekammer to file it with. Asking such a learner for their
 * Fortbildungsnummer collects a piece of personal data the platform has no use
 * for — and then *refuses to certify* until they supply it, which is the part
 * that turns a data-minimisation slip into a dead end.
 *
 * So `efn` is conditional. The evaluation is not: it is asked of every learner,
 * accredited course or otherwise.
 */

export type CompletionCondition = "watch" | "quiz" | "evaluation" | "efn";

/**
 * The conditions that decide whether the **course** is finished.
 *
 * Module-private, and that is the point: it has exactly one reader,
 * `isCourseComplete` below, and callers get the answer as
 * `outstandingForCourse` rather than the list to compare against themselves.
 *
 * It was briefly exported, alongside a `CERTIFICATION_CONDITIONS` that existed
 * only for symmetry and was called by nothing — which is the P41-01 shape and
 * is what `scripts/unused-rules.mjs` is for.
 */
const COURSE_CONDITIONS: readonly CompletionCondition[] = ["watch", "quiz"];

export interface CompletionInput {
  /** From the enrolment snapshot, not the live course record. */
  readonly requiredWatchPercent: number;
  /** Server-computed union coverage across the course's video content. */
  readonly achievedWatchPercent: number;
  readonly quizPassed: boolean;
  readonly evaluationSubmitted: boolean;
  readonly efnPresent: boolean;
  /**
   * Whether this course awards CME points, and therefore whether an EFN is
   * needed at all.
   *
   * Taken from the enrolment's snapshot of `cme_points`, like
   * `requiredWatchPercent` — a course re-accredited after somebody enrolled
   * must not change what was asked of them mid-way.
   *
   * Optional, and defaults to `true`, so that a caller which has not been
   * updated asks for the EFN rather than quietly stopping: over-collecting is
   * a bug, under-reporting a Punktemeldung is a compliance incident.
   */
  readonly awardsCmePoints?: boolean | undefined;
}

export interface CompletionResult {
  /**
   * The Fortbildung itself is finished: watched and passed.
   *
   * This is what a physician means by "I have done the course", and what the
   * screen must agree with.
   */
  readonly courseComplete: boolean;
  /**
   * Everything needed to award the point exists: the course is complete *and*
   * the evaluation and (where points are attached) the EFN are on file.
   *
   * The gate on the certificate and the Punktemeldung.
   */
  readonly complete: boolean;
  /** Everything still missing, in the order the learner meets it. */
  readonly outstanding: readonly CompletionCondition[];
  /** The subset of `outstanding` that is holding the *course* back. */
  readonly outstandingForCourse: readonly CompletionCondition[];
}

export function isCourseComplete(input: CompletionInput): CompletionResult {
  const outstanding: CompletionCondition[] = [];

  if (input.achievedWatchPercent < input.requiredWatchPercent) outstanding.push("watch");
  if (!input.quizPassed) outstanding.push("quiz");
  if (!input.evaluationSubmitted) outstanding.push("evaluation");

  // The one conditional condition — see the module header.
  const needsEfn = input.awardsCmePoints ?? true;
  if (needsEfn && !input.efnPresent) outstanding.push("efn");

  const outstandingForCourse = outstanding.filter((condition) =>
    COURSE_CONDITIONS.includes(condition),
  );

  return {
    courseComplete: outstandingForCourse.length === 0,
    complete: outstanding.length === 0,
    outstanding,
    outstandingForCourse,
  };
}
