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
  if (!input.efnPresent) outstanding.push("efn");

  return { complete: outstanding.length === 0, outstanding };
}
