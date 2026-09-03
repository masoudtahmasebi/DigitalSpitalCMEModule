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

import {
  mayRevealCorrectAnswers,
  scoreQuiz,
  UnknownQuestionError,
  type Question,
} from "@ds/domain";
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

    // P51-02. An expired course accepts no further attempts — checked before
    // the attempt counter, so a refused course never consumes one.
    this.learning.requireCourseStillOffered(course, slug);

    /*
     * A certified enrolment sits no more exams (P169-01).
     *
     * The client: *"we shouldn't let the user fill the exam again, when he has
     * cleared the exam already and certificate is issued."*
     *
     * Until now `submit` looked at the course's dates and the attempt counter
     * and nothing else, so a physician holding a Teilnahmebescheinigung — with
     * a Punktemeldung already filed against their EFN — could sit the
     * Lernerfolgskontrolle again and have the attempt written to the record
     * that Bescheid rests on. The pass itself was safe (`bestScorePercent` is
     * best-of), which is exactly why nothing complained: the damage is to the
     * evidence, not to the outcome. An attempt dated after the certificate is
     * an assessment record that no longer matches the document issued from it.
     *
     * Kept as its own branch above the passing rule below, and only for the
     * message: a certified physician is told about their Bescheid rather than
     * about their score, which is the more useful of the two true sentences.
     *
     * Checked before the attempt counter for the same reason as the line above
     * — a refused attempt must not consume one of a course's allowance.
     */
    if (enrolment.completedAt !== null) {
      throw new AppError(
        "conflict",
        `enrolment=${enrolment.id} is certified; content=${contentId} accepts no further attempts`,
        "Diese Fortbildung ist bereits abgeschlossen und zertifiziert. Die Lernerfolgskontrolle kann nicht erneut abgelegt werden.",
      );
    }

    /*
     * A passed Lernerfolgskontrolle is finished, certificate or not (P170-01).
     *
     * The client widened P169-01 the day after it shipped: *"if someone has
     * passed a lernerfolgskontrolle, we shouldn't let that user fill the
     * lernerfolgskontrolle again, when he has cleared the exam already."*
     *
     * So the line is the **pass**, not the certificate. P169-01's reasoning
     * carried to its end: an attempt after the pass cannot change the outcome
     * (`bestScorePercent` is best-of) and can only add rows to the assessment
     * record behind a result that is already decided. Between passing and
     * certifying there is no question left for a further attempt to answer —
     * the score is not a grade a physician is marked on, it is a threshold they
     * are over.
     *
     * Read from the **stored attempts**, not from the progress row's `passed`
     * flag: `upsertQuizProgress` writes that flag from exactly this comparison,
     * so re-deriving it here keeps one rule rather than two that could drift
     * (§4 invariant 6). `passThresholdPercent` is the enrolment's snapshot, so
     * re-tightening a published course cannot retroactively reopen an exam
     * somebody has already passed.
     */
    const bestSoFar = await this.repository.bestScorePercent(enrolment.id, contentId);
    if (bestSoFar !== null && bestSoFar >= enrolment.passThresholdPercent) {
      throw new AppError(
        "conflict",
        `enrolment=${enrolment.id} already passed content=${contentId}`,
        "Sie haben diese Lernerfolgskontrolle bereits bestanden. Sie kann nicht erneut abgelegt werden.",
      );
    }

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
      /*
       * Withheld unless the course both asks for it *and* is allowed it
       * (P56-01). With unlimited retries, per-question feedback is the answer
       * key in slow motion — which is why a course awarding CME points may not
       * reveal it however its column is set. The rule is `mayRevealCorrectAnswers`
       * in `@ds/domain`, beside the scorer, because it is the same compliance
       * question read from the other end.
       */
      ...(mayRevealCorrectAnswers(course) ? { perQuestion: result.perQuestion } : {}),
    };
  }
}
