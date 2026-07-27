/**
 * Quiz scoring (P4-02).
 *
 * MEDICE configuration, confirmed: 11 single-choice questions, pass at 70 %,
 * so at least 8 of 11 must be correct (8/11 = 72 %; 7/11 = 63 %). Retries are
 * unlimited until the threshold is reached.
 *
 * Scoring runs here and only here. `CLAUDE.md` §4 invariant 1: the client
 * submits selections, never a score, and no endpoint ever returns a
 * correctness marker for a CME-certified course.
 */

export type QuestionKind = "single" | "multi";

export interface Question {
  readonly id: string;
  readonly kind: QuestionKind;
  /** Never leaves the server for a CME-certified course. */
  readonly correctOptionIds: readonly string[];
}

export interface Answer {
  readonly questionId: string;
  readonly selectedOptionIds: readonly string[];
}

export interface QuizResult {
  readonly correctCount: number;
  readonly totalCount: number;
  /** Integer 0–100, floored. */
  readonly scorePercent: number;
  readonly passed: boolean;
  /** Per-question correctness, for the server-side attempts record only. */
  readonly perQuestion: Readonly<Record<string, boolean>>;
}

export class UnknownQuestionError extends Error {
  constructor(readonly questionId: string) {
    super(`Answer references a question that is not part of this quiz: ${questionId}`);
    this.name = "UnknownQuestionError";
  }
}

/**
 * Score an attempt.
 *
 * Multi-choice is an **exact set match** — no partial credit. A selection that
 * is a strict subset of the correct answers scores zero, and so does a superset.
 * This is a compliance decision rather than a UX preference: partial credit on
 * a medical knowledge check would let a physician earn accredited points while
 * holding a materially incomplete answer.
 *
 * The percentage floors, which is what produces the result copy the design
 * specifies — 6 of 11 renders as "54 %", not 55 %.
 *
 * @throws UnknownQuestionError if an answer names a question outside this quiz,
 *   which is how a submission crafted against another course is rejected.
 */
export function scoreQuiz(
  questions: readonly Question[],
  answers: readonly Answer[],
  passThresholdPercent: number,
): QuizResult {
  const byId = new Map(questions.map((question) => [question.id, question]));

  for (const answer of answers) {
    if (!byId.has(answer.questionId)) {
      throw new UnknownQuestionError(answer.questionId);
    }
  }

  const answersByQuestion = new Map(
    answers.map((answer) => [answer.questionId, answer.selectedOptionIds]),
  );

  const perQuestion: Record<string, boolean> = {};
  let correctCount = 0;

  for (const question of questions) {
    // An unanswered question is wrong, never skipped — otherwise a learner
    // could raise their percentage by answering only what they were sure of.
    const selected = answersByQuestion.get(question.id) ?? [];
    const correct = isExactSetMatch(selected, question.correctOptionIds);

    perQuestion[question.id] = correct;
    if (correct) correctCount += 1;
  }

  const totalCount = questions.length;

  // A quiz with no questions passes nobody; it is an authoring state, not a
  // trivially satisfied assessment.
  const scorePercent =
    totalCount === 0 ? 0 : Math.floor((correctCount / totalCount) * 100);

  return {
    correctCount,
    totalCount,
    scorePercent,
    passed: totalCount > 0 && scorePercent >= passThresholdPercent,
    perQuestion,
  };
}

function isExactSetMatch(
  selected: readonly string[],
  correct: readonly string[],
): boolean {
  const selectedSet = new Set(selected);
  const correctSet = new Set(correct);

  if (selectedSet.size !== correctSet.size) return false;

  for (const id of correctSet) {
    if (!selectedSet.has(id)) return false;
  }

  return true;
}
