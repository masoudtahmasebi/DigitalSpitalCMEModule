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

/**
 * Whether per-question correctness may be sent back to the learner (P56-01).
 *
 * ## Why this is a rule and not a setting
 *
 * `assessment.ts` has said since P4-02 that "no endpoint ever returns a
 * correctness marker for a CME-certified course", and until this function
 * existed that sentence was a comment. The API honoured
 * `courses.reveal_correct_answers` on its own — a boolean that no route can
 * set, but that a support script, a seed or a future admin field can — and a
 * course carrying a VNR would then hand a physician one boolean per question,
 * with unlimited retries. Four rounds of that is the answer key, and the
 * Lernerfolgskontrolle it voids is a condition of the Anerkennung.
 *
 * QA proved it by flipping the column on a course worth CME points and getting
 * `perQuestion` back (CLAUDE.md §9.3: a rule written is not a rule enforced).
 *
 * ## Why points and not "has a VNR"
 *
 * A course awards points or it does not, and that is the thing the
 * accreditation attaches to. The VNR can arrive weeks after the course is
 * authored (P7-07), so keying on it would leave a window in which the same
 * course legitimately revealed answers and then stopped.
 *
 * Educational material that awards nothing may still reveal: there is no
 * accredited assessment to protect, and immediate feedback is the point of it.
 */
export function mayRevealCorrectAnswers(course: {
  readonly revealCorrectAnswers: boolean;
  readonly cmePoints: number | null;
}): boolean {
  if (course.cmePoints !== null && course.cmePoints > 0) return false;
  return course.revealCorrectAnswers;
}

/**
 * How many questions must be right — "Mind. 8 von 11 richtig" (layout page 08).
 *
 * ## Why this is here and not in the widget
 *
 * It is the same rule as `scoreQuiz`, read backwards, and the layout puts it in
 * front of a physician *before* they start. Computing it beside the screen that
 * prints it would give this platform two accounts of what passing means, and the
 * one on the poster would be the one nobody tested. `scoreQuiz` floors; a screen
 * that used `Math.ceil(total * threshold / 100)` agrees with it on 8 of 11 and
 * disagrees on other shapes, which is precisely the kind of divergence CLAUDE.md
 * §4 invariant 6 exists to prevent.
 *
 * Searched rather than derived, for the same reason: the search asks
 * `scoreQuiz`'s own question — "does this many correct answers reach the
 * threshold?" — so it cannot round differently from it. Quizzes have single
 * digits of questions; the loop is not the cost anywhere.
 *
 * `null` when no number of correct answers can pass: a quiz with no questions
 * (an authoring state, which `scoreQuiz` also refuses to pass) or a threshold
 * above 100. The caller draws nothing rather than "Mind. 1 von 0 richtig".
 */
export function minimumCorrectAnswers(
  totalCount: number,
  passThresholdPercent: number,
): number | null {
  if (totalCount <= 0) return null;

  for (let correct = 0; correct <= totalCount; correct += 1) {
    if (Math.floor((correct / totalCount) * 100) >= passThresholdPercent) return correct;
  }
  return null;
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
