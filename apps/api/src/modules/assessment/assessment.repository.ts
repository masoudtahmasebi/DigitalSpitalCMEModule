/**
 * Assessment data access (P4). Infrastructure layer — ADR-0006.
 *
 * Two deliberately separate readers for the same tables:
 *
 * - `findQuestionsForLearner` selects id, ordinal, kind, prompt, label — and
 *   never `is_correct`.
 * - `findAnswerKey` selects the correct option ids, and is only ever called by
 *   the scoring path, which returns a score rather than the key.
 *
 * Keeping them apart means the learner-facing query physically cannot leak the
 * answer key, rather than relying on a caller to drop a column (P4-01).
 */

import { and, asc, count, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "../../db/tenant-db.js";
import {
  contentProgress,
  quizAnswers,
  quizAttempts,
  quizOptions,
  quizQuestions,
} from "../../db/schema.js";

export interface LearnerQuestionRow {
  id: string;
  ordinal: number;
  kind: "single" | "multi";
  prompt: string;
}

export interface LearnerOptionRow {
  id: string;
  questionId: string;
  ordinal: number;
  label: string;
}

/** Never returned by any controller; scoring input only. */
export interface AnswerKeyRow {
  questionId: string;
  kind: "single" | "multi";
  correctOptionIds: string[];
}

export interface AssessmentRepositoryPort {
  findQuestionsForLearner(contentId: string): Promise<{
    questions: LearnerQuestionRow[];
    options: LearnerOptionRow[];
  }>;
  findAnswerKey(contentId: string): Promise<AnswerKeyRow[]>;
  countAttempts(enrolmentId: string, contentId: string): Promise<number>;
  recordAttempt(input: {
    customerId: string;
    enrolmentId: string;
    contentId: string;
    attemptNumber: number;
    correctCount: number;
    totalCount: number;
    scorePercent: number;
    passed: boolean;
    answers: ReadonlyArray<{
      questionId: string;
      selectedOptionIds: readonly string[];
      isCorrect: boolean;
    }>;
  }): Promise<void>;
  bestScorePercent(enrolmentId: string, contentId: string): Promise<number | null>;
  upsertQuizProgress(input: {
    customerId: string;
    enrolmentId: string;
    contentId: string;
    scorePercent: number;
    passed: boolean;
  }): Promise<void>;
}

export class AssessmentRepository implements AssessmentRepositoryPort {
  constructor(private readonly db: Db) {}

  /**
   * The learner-facing read. `quizOptions.isCorrect` is not in the selection.
   *
   * Retired questions are excluded (P114-01). This is one of **two** places
   * that filter — `findAnswerKey` is the other — and they are separate queries
   * for separate purposes, so a change that fixes one and forgets the other
   * produces a quiz whose visible questions and whose scoring disagree. Both
   * have their own test naming that failure.
   */
  async findQuestionsForLearner(contentId: string) {
    const questions = await this.db
      .select({
        id: quizQuestions.id,
        ordinal: quizQuestions.ordinal,
        kind: quizQuestions.kind,
        prompt: quizQuestions.prompt,
      })
      .from(quizQuestions)
      .where(and(eq(quizQuestions.contentId, contentId), isNull(quizQuestions.retiredAt)))
      .orderBy(asc(quizQuestions.ordinal));

    const questionIds = questions.map((row) => row.id);
    if (questionIds.length === 0) {
      return { questions: questions as LearnerQuestionRow[], options: [] };
    }

    const options = await this.db
      .select({
        id: quizOptions.id,
        questionId: quizOptions.questionId,
        ordinal: quizOptions.ordinal,
        label: quizOptions.label,
      })
      .from(quizOptions)
      .where(inArray(quizOptions.questionId, questionIds))
      .orderBy(asc(quizOptions.ordinal));

    return {
      questions: questions as LearnerQuestionRow[],
      options: options as LearnerOptionRow[],
    };
  }

  /**
   * Scoring input. Its result never reaches a response body.
   *
   * Retired questions are excluded here too (P114-01), and the consequence of
   * forgetting is worse than in the projection above: a retired question left
   * in the key is counted in `totalCount`, so every learner's percentage is
   * measured against an exam they were never shown, and the pass threshold
   * silently becomes unreachable.
   *
   * A learner whose browser still holds the old form submits answers for
   * questions no longer in the key. `scoreQuiz` raises `UnknownQuestionError`
   * for those and the service turns it into a refusal telling them to reload —
   * which is the honest outcome. Scoring a stale exam would be worse.
   */
  async findAnswerKey(contentId: string): Promise<AnswerKeyRow[]> {
    const rows = await this.db
      .select({
        questionId: quizQuestions.id,
        kind: quizQuestions.kind,
        optionId: quizOptions.id,
        isCorrect: quizOptions.isCorrect,
      })
      .from(quizQuestions)
      .innerJoin(quizOptions, eq(quizOptions.questionId, quizQuestions.id))
      .where(and(eq(quizQuestions.contentId, contentId), isNull(quizQuestions.retiredAt)))
      .orderBy(asc(quizQuestions.ordinal));

    const byQuestion = new Map<string, AnswerKeyRow>();
    for (const row of rows) {
      let entry = byQuestion.get(row.questionId);
      if (entry === undefined) {
        entry = { questionId: row.questionId, kind: row.kind, correctOptionIds: [] };
        byQuestion.set(row.questionId, entry);
      }
      if (row.isCorrect) entry.correctOptionIds.push(row.optionId);
    }

    return [...byQuestion.values()];
  }

  async countAttempts(enrolmentId: string, contentId: string): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(quizAttempts)
      .where(
        and(
          eq(quizAttempts.enrolmentId, enrolmentId),
          eq(quizAttempts.contentId, contentId),
        ),
      );

    return row?.value ?? 0;
  }

  async recordAttempt(input: {
    customerId: string;
    enrolmentId: string;
    contentId: string;
    attemptNumber: number;
    correctCount: number;
    totalCount: number;
    scorePercent: number;
    passed: boolean;
    answers: ReadonlyArray<{
      questionId: string;
      selectedOptionIds: readonly string[];
      isCorrect: boolean;
    }>;
  }): Promise<void> {
    const [attempt] = await this.db
      .insert(quizAttempts)
      .values({
        customerId: input.customerId,
        enrolmentId: input.enrolmentId,
        contentId: input.contentId,
        attemptNumber: input.attemptNumber,
        correctCount: input.correctCount,
        totalCount: input.totalCount,
        scorePercent: input.scorePercent,
        passed: input.passed,
      })
      .returning({ id: quizAttempts.id });

    if (attempt === undefined) {
      throw new Error("recordAttempt: insert returned no row");
    }
    if (input.answers.length === 0) return;

    // The per-answer record is what makes an attempt auditable after the fact;
    // a score with no evidence behind it is not much of a compliance record.
    await this.db.insert(quizAnswers).values(
      input.answers.map((answer) => ({
        customerId: input.customerId,
        attemptId: attempt.id,
        questionId: answer.questionId,
        selectedOptionIds: [...answer.selectedOptionIds],
        isCorrect: answer.isCorrect,
      })),
    );
  }

  async bestScorePercent(enrolmentId: string, contentId: string): Promise<number | null> {
    const rows = await this.db
      .select({ scorePercent: quizAttempts.scorePercent })
      .from(quizAttempts)
      .where(
        and(
          eq(quizAttempts.enrolmentId, enrolmentId),
          eq(quizAttempts.contentId, contentId),
        ),
      );

    if (rows.length === 0) return null;
    return Math.max(...rows.map((row) => row.scorePercent));
  }

  /**
   * Mirror the best score onto `content_progress` so the one rollup path
   * (`CLAUDE.md` §4 invariant 6) sees quiz results without a second query
   * shape. Status is `completed` only on a pass: a failed attempt is progress,
   * not completion.
   */
  async upsertQuizProgress(input: {
    customerId: string;
    enrolmentId: string;
    contentId: string;
    scorePercent: number;
    passed: boolean;
  }): Promise<void> {
    const status = input.passed ? "completed" : "in_progress";

    await this.db
      .insert(contentProgress)
      .values({
        customerId: input.customerId,
        enrolmentId: input.enrolmentId,
        contentId: input.contentId,
        status,
        scorePercent: input.scorePercent,
      })
      .onConflictDoUpdate({
        target: [contentProgress.enrolmentId, contentProgress.contentId],
        set: { status, scorePercent: input.scorePercent, updatedAt: new Date() },
      });
  }
}
