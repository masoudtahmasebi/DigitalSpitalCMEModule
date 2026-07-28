/**
 * The assessment use case (P4). Application layer — ADR-0006.
 *
 * Scoring itself is `scoreQuiz` in `@ds/domain`: a pure function with
 * exhaustive tests, because whether a physician passed is the single most
 * consequential boolean in the system. This service decides *when* it may be
 * called (gate, attempt limit) and what happens to the result (recorded,
 * mirrored onto progress) — never *what the result is*.
 *
 * The answer key is loaded here and dies here. It is passed to the scorer and
 * never placed on anything returned to a caller.
 */

import { scoreQuiz, UnknownQuestionError, type Question } from "@ds/domain";
import { AppError } from "../../shared/problem-details.js";
import type { Db } from "../../db/tenant-db.js";
import { LearningRepository } from "../learning/learning.repository.js";
import { LearningService, type LearnerContext } from "../learning/learning.service.js";
import {
  AssessmentRepository,
  type AssessmentRepositoryPort,
} from "./assessment.repository.js";
import type { Quiz, QuizAttemptResult, QuizSubmission } from "./assessment.dto.js";

export class AssessmentService {
  constructor(
    private readonly repository: AssessmentRepositoryPort,
    /**
     * Reused rather than reimplemented: course lookup, enrolment lookup and
     * the reachability gate are the same rules here as in the player, and two
     * implementations of a gate would eventually disagree.
     */
    private readonly learning: LearningService,
  ) {}

  static fromDb(db: Db): AssessmentService {
    return new AssessmentService(
      new AssessmentRepository(db),
      new LearningService(new LearningRepository(db)),
    );
  }

  async getQuiz(slug: string, contentId: string, learner: LearnerContext): Promise<Quiz> {
    const { enrolment } = await this.learning.requireReachableContent(
      slug,
      contentId,
      learner,
      ["quiz"],
    );

    const { questions, options } =
      await this.repository.findQuestionsForLearner(contentId);

    return {
      contentId,
      passThresholdPercent: enrolment.passThresholdPercent,
      attemptsUsed: await this.repository.countAttempts(enrolment.id, contentId),
      maxAttempts: enrolment.maxQuizAttempts,
      questions: questions.map((question) => ({
        id: question.id,
        ordinal: question.ordinal,
        kind: question.kind,
        prompt: question.prompt,
        options: options
          .filter((option) => option.questionId === question.id)
          .map((option) => ({
            id: option.id,
            ordinal: option.ordinal,
            label: option.label,
          })),
      })),
    };
  }

  async submit(
    slug: string,
    contentId: string,
    submission: QuizSubmission,
    learner: LearnerContext,
  ): Promise<QuizAttemptResult> {
    const { course, enrolment } = await this.learning.requireReachableContent(
      slug,
      contentId,
      learner,
      ["quiz"],
    );

    const attemptsUsed = await this.repository.countAttempts(enrolment.id, contentId);
    if (enrolment.maxQuizAttempts !== null && attemptsUsed >= enrolment.maxQuizAttempts) {
      throw AppError.forbidden(
        `enrolment=${enrolment.id} exhausted ${enrolment.maxQuizAttempts} attempts on content=${contentId}`,
      );
    }

    const key = await this.repository.findAnswerKey(contentId);
    if (key.length === 0) {
      throw new AppError(
        "internal",
        `content=${contentId} is a quiz with no questions configured`,
      );
    }

    const questions: Question[] = key.map((row) => ({
      id: row.questionId,
      kind: row.kind,
      correctOptionIds: row.correctOptionIds,
    }));

    let result;
    try {
      result = scoreQuiz(
        questions,
        submission.answers.map((answer) => ({
          questionId: answer.questionId,
          selectedOptionIds: answer.selectedOptionIds,
        })),
        enrolment.passThresholdPercent,
      );
    } catch (error) {
      if (error instanceof UnknownQuestionError) {
        // The question id is safe to name: the client sent it, so it discloses
        // nothing it did not already have.
        throw new AppError(
          "validation",
          `submission references question=${error.questionId} outside content=${contentId}`,
          "Die Antworten gehören nicht zu dieser Lernerfolgskontrolle.",
        );
      }
      throw error;
    }

    const attemptNumber = attemptsUsed + 1;

    await this.repository.recordAttempt({
      customerId: learner.customerId,
      enrolmentId: enrolment.id,
      contentId,
      attemptNumber,
      correctCount: result.correctCount,
      totalCount: result.totalCount,
      scorePercent: result.scorePercent,
      passed: result.passed,
      answers: submission.answers.map((answer) => ({
        questionId: answer.questionId,
        selectedOptionIds: answer.selectedOptionIds,
        isCorrect: result.perQuestion[answer.questionId] ?? false,
      })),
    });

    // Best-of, not latest: a learner who passes and retries out of curiosity
    // does not lose the pass they already earned.
    const best = await this.repository.bestScorePercent(enrolment.id, contentId);
    const bestScore = best ?? result.scorePercent;

    await this.repository.upsertQuizProgress({
      customerId: learner.customerId,
      enrolmentId: enrolment.id,
      contentId,
      scorePercent: bestScore,
      passed: bestScore >= enrolment.passThresholdPercent,
    });

    return {
      attemptNumber,
      correctCount: result.correctCount,
      totalCount: result.totalCount,
      scorePercent: result.scorePercent,
      passed: result.passed,
      passThresholdPercent: enrolment.passThresholdPercent,
      // Withheld unless the course explicitly reveals answers. With unlimited
      // retries, per-question feedback is the answer key in slow motion.
      ...(course.revealCorrectAnswers ? { perQuestion: result.perQuestion } : {}),
    };
  }
}
