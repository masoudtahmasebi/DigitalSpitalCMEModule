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

export type CompletionCondition = "watch" | "quiz" | "reading" | "evaluation" | "efn";

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
const COURSE_CONDITIONS: readonly CompletionCondition[] = ["watch", "quiz", "reading"];

export interface CompletionInput {
  /** From the enrolment snapshot, not the live course record. */
  readonly requiredWatchPercent: number;
  /** Server-computed union coverage across the course's video content. */
  readonly achievedWatchPercent: number;
  readonly quizPassed: boolean;
  /**
   * Every text and details section acknowledged as read (P167-01).
   *
   * `courseWatchCoverage` counts videos, so before this a section of prose was
   * in the denominator of the percentage a physician reads and in neither side
   * of the gate: a course of two texts, one video and one exam completed with
   * both texts never opened, and a course of nothing but text completed on
   * enrolment.
   *
   * §S33 put the question to the client rather than guessing it, because it
   * decides whether CME points can be awarded to somebody who did not open a
   * section the Anerkennungsbescheid lists. Their answer was the rule *and* its
   * mechanism: a checkbox saying the text has been read, which enables the
   * button onward.
   */
  readonly readingAcknowledged: boolean;
  readonly evaluationSubmitted: boolean;
  readonly efnPresent: boolean;
  /**
   * This enrolment already has a completion recorded (P167-01).
   *
   * When it does, the course stays complete whatever the conditions now say.
   * A physician who finished under an earlier gate holds a
   * Teilnahmebescheinigung and may have a Punktemeldung filed against their
   * EFN; a condition added afterwards must not reopen that. It is the same
   * principle as the enrolment's snapshot columns, for a condition that has no
   * snapshot because it did not exist when they enrolled — and it covers the
   * ordinary case too, of an author adding a section to a published course
   * somebody has already finished.
   *
   * Deliberately only the *course* conditions: the evaluation and the EFN are
   * things the learner supplies at the end, and an enrolment that reached
   * `completedAt` supplied them already.
   */
  readonly alreadyCompleted?: boolean;
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
  if (!input.readingAcknowledged) outstanding.push("reading");
  if (!input.evaluationSubmitted) outstanding.push("evaluation");

  // The one conditional condition — see the module header.
  const needsEfn = input.awardsCmePoints ?? true;
  if (needsEfn && !input.efnPresent) outstanding.push("efn");

  const outstandingForCourse =
    input.alreadyCompleted === true
      ? []
      : outstanding.filter((condition) => COURSE_CONDITIONS.includes(condition));

  return {
    courseComplete: outstandingForCourse.length === 0,
    complete: outstanding.length === 0,
    outstanding,
    outstandingForCourse,
  };
}
