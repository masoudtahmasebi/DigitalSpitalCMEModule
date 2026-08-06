/**
 * Course completion (P4-05).
 *
 * The single point at which the system decides a physician has earned their
 * CME points. Everything downstream — the EIV Punktemeldung and the
 * Teilnahmebescheinigung — keys off this result, so there is exactly one
 * implementation of it.
 *
 * Returning the outstanding conditions rather than a bare boolean is
 * deliberate: the completion screen has to tell the learner precisely what is
 * missing (P5-08). "Not yet complete" at the end of an hour of study is the
 * point where a learner gives up and the CME point is lost.
 *
 * ## Not every course awards points
 *
 * A course with no `cmePoints` is not accredited: there is no Punktemeldung to
 * file and no Ärztekammer to file it with. Asking such a learner for their
 * Fortbildungsnummer collects a piece of personal data the platform has no use
 * for — and then *refuses to complete the course* until they supply it, which
 * is the part that turns a data-minimisation slip into a dead end.
 *
 * So `efn` is conditional. It is the only condition that is: watching, the
 * Lernerfolgskontrolle and the evaluation are what the course is, and they
 * apply whether or not points are attached.
 */

export type CompletionCondition = "watch" | "quiz" | "evaluation" | "efn";

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
  readonly complete: boolean;
  readonly outstanding: readonly CompletionCondition[];
}

export function isCourseComplete(input: CompletionInput): CompletionResult {
  const outstanding: CompletionCondition[] = [];

  if (input.achievedWatchPercent < input.requiredWatchPercent) outstanding.push("watch");
  if (!input.quizPassed) outstanding.push("quiz");
  if (!input.evaluationSubmitted) outstanding.push("evaluation");

  // The one conditional condition — see the module header.
  const needsEfn = input.awardsCmePoints ?? true;
  if (needsEfn && !input.efnPresent) outstanding.push("efn");

  return { complete: outstanding.length === 0, outstanding };
}
