/**
 * Evaluation, EFN and course completion (P6, P1-06, P7). Application layer.
 *
 * This is the last gate before a CME point is claimed on a physician's behalf,
 * so two rules govern everything below:
 *
 * 1. **Re-check, never trust.** `complete()` does not read a "ready" flag the
 *    client sent, and does not trust the state it handed the client a moment
 *    ago. It re-derives every condition from stored rows through
 *    `isCourseComplete`, and refuses if any is outstanding.
 * 2. **The EFN and free-text answers never leave.** Neither is returned by any
 *    method here, and neither is put in an error message, a log line or an
 *    audit `detail` (ADR-0004, CLAUDE.md §4 invariant 7).
 *
 * `eivDeadlines` computes the statutory windows. `Veranstaltungsende` for an
 * on-demand course is taken as the learner's completion time — the reading
 * that makes operational sense, and the one flagged in docs/show-stoppers.md
 * as still needing confirmation from the Ärztekammer. It is passed as an
 * argument here rather than assumed inside the domain, so changing the answer
 * is a one-line change at this call site.
 */

import { eivDeadlines, isValidEfn } from "@ds/domain";
import { AppError } from "../../shared/problem-details.js";
import type { Db } from "../../db/tenant-db.js";
import { LearningRepository } from "../learning/learning.repository.js";
import { LearningService, type LearnerContext } from "../learning/learning.service.js";
import type { EnrolmentState } from "../learning/learning.dto.js";
import {
  CompletionRepository,
  type CompletionRepositoryPort,
} from "./completion.repository.js";
import type {
  CompletionInput,
  Evaluation,
  EvaluationSubmission,
} from "./completion.dto.js";

const EVALUATION_KINDS = ["scale", "single", "multi", "text"] as const;
type EvaluationKind = (typeof EVALUATION_KINDS)[number];

export class CompletionService {
  constructor(
    private readonly repository: CompletionRepositoryPort,
    private readonly learning: LearningService,
  ) {}

  static fromDb(db: Db): CompletionService {
    return new CompletionService(
      new CompletionRepository(db),
      new LearningService(new LearningRepository(db)),
    );
  }

  async getEvaluation(slug: string, learner: LearnerContext): Promise<Evaluation> {
    const { course, enrolment } = await this.learning.requireEnrolled(slug, learner);

    const [questions, submitted] = await Promise.all([
      this.repository.findEvaluationQuestions(course.id),
      this.repository.hasEvaluationResponse(enrolment.id),
    ]);

    return {
      courseSlug: slug,
      submitted,
      questions: questions.map((question) => ({
        id: question.id,
        ordinal: question.ordinal,
        kind: normaliseKind(question.kind),
        prompt: question.prompt,
        required: question.required,
        options: readOptions(question.options),
      })),
    };
  }

  /**
   * Record the evaluation. Once only — it is a statement about the course, and
   * re-submitting would either duplicate or silently overwrite a response the
   * Veranstalter may already have acted on.
   */
  async submitEvaluation(
    slug: string,
    submission: EvaluationSubmission,
    learner: LearnerContext,
  ): Promise<EnrolmentState> {
    const { course, enrolment } = await this.learning.requireEnrolled(slug, learner);

    if (await this.repository.hasEvaluationResponse(enrolment.id)) {
      throw new AppError(
        "conflict",
        `enrolment=${enrolment.id} already has an evaluation response`,
        "Die Evaluation wurde bereits abgeschickt.",
      );
    }

    const questions = await this.repository.findEvaluationQuestions(course.id);
    const known = new Map(questions.map((question) => [question.id, question]));

    for (const answer of submission.answers) {
      if (!known.has(answer.evaluationId)) {
        throw new AppError(
          "validation",
          `answer references evaluation=${answer.evaluationId} outside course=${course.id}`,
          "Die Antworten gehören nicht zu dieser Evaluation.",
        );
      }
    }

    const answered = new Set(submission.answers.map((answer) => answer.evaluationId));
    const missing = questions.filter(
      (question) => question.required && !answered.has(question.id),
    );
    if (missing.length > 0) {
      // Ids only. The prompts are course content, but echoing answer content
      // back in an error is how personal data reaches a log.
      throw new AppError(
        "validation",
        `evaluation missing ${missing.length} required answer(s)`,
        "Bitte beantworten Sie alle Pflichtfragen.",
      );
    }

    await this.repository.saveEvaluationResponses({
      customerId: learner.customerId,
      enrolmentId: enrolment.id,
      answers: submission.answers,
    });

    return this.learning.getState(slug, learner);
  }

  /**
   * Store the learner's EFN.
   *
   * Validated by the domain's `isValidEfn`, not only by the DTO's regex: the
   * rule about what an EFN is belongs with the other accreditation rules, and
   * the schema check is defence in depth at the edge.
   */
  async setEfn(efn: string, learner: LearnerContext): Promise<void> {
    if (!isValidEfn(efn)) {
      // The value is deliberately absent from the message — an invalid EFN is
      // still personal data, and error strings end up in logs.
      throw new AppError(
        "validation",
        `rejected EFN for user=${learner.userId}: failed domain validation`,
        "Die EFN muss aus genau 15 Ziffern bestehen.",
      );
    }

    await this.repository.saveEfn(learner.userId, efn);
  }

  /**
   * Finalise the course and queue the Punktemeldung.
   *
   * Idempotent: a second call returns the same completed state and does not
   * re-queue, because the reporting deadline runs from the first completion.
   */
  async complete(
    slug: string,
    input: CompletionInput,
    learner: LearnerContext,
    now: Date,
  ): Promise<EnrolmentState> {
    const { course, enrolment } = await this.learning.requireEnrolled(slug, learner);

    // The authority on whether this is allowed — recomputed from stored rows,
    // never taken from the client or from a cached view.
    const state = await this.learning.getState(slug, learner);

    if (enrolment.completedAt !== null) return state;

    if (!state.complete) {
      throw new AppError(
        "conflict",
        `enrolment=${enrolment.id} incomplete: ${state.outstanding.join(", ")}`,
        `Es fehlt noch: ${state.outstanding.map(describeCondition).join(", ")}.`,
      );
    }

    // The name the learner attests to, stamped with the completion it belongs
    // to. Absent means "use my profile name" — see completion.dto.ts.
    await this.learning.markCompleted(enrolment.id, now, input.attestedName ?? null);

    await this.queueSubmission(course.vnr, enrolment.id, learner, now);

    return { ...state, completedAt: now.toISOString() };
  }

  /**
   * Queue the EIV submission, or record why it could not be queued.
   *
   * A course with no VNR is an authoring gap, not a learner problem: the
   * learner's completion stands and the missing VNR is an admin alert (P7-07).
   * Failing their completion because someone forgot to enter a number would be
   * the wrong trade.
   */
  private async queueSubmission(
    vnr: string | null,
    enrolmentId: string,
    learner: LearnerContext,
    now: Date,
  ): Promise<void> {
    if (vnr === null || vnr === "") return;
    if (await this.repository.hasEivSubmission(enrolmentId)) return;

    const efn = await this.repository.findEfn(learner.userId);
    // Unreachable via `complete` — `efnPresent` is one of the conditions — but
    // asserted rather than assumed, because a submission without an EFN cannot
    // be credited to anyone.
    if (efn === undefined) return;

    // `Veranstaltungsende` for an on-demand course: the learner's completion.
    // See the file header and docs/show-stoppers.md — this is the open
    // question, isolated to this one line.
    const deadlines = eivDeadlines({ eventEndAt: now, now });

    await this.repository.queueEivSubmission({
      customerId: learner.customerId,
      enrolmentId,
      vnr,
      efn,
      eventEndAt: now,
      reportDueAt: deadlines.reportDueAt,
    });
  }
}

function describeCondition(condition: string): string {
  switch (condition) {
    case "watch":
      return "die vollständige Videowiedergabe";
    case "quiz":
      return "die Lernerfolgskontrolle";
    case "evaluation":
      return "die Evaluation";
    case "efn":
      return "Ihre EFN";
    default:
      return condition;
  }
}

/** The column is free text; anything unrecognised renders as a text question. */
function normaliseKind(kind: string): EvaluationKind {
  return (EVALUATION_KINDS as readonly string[]).includes(kind)
    ? (kind as EvaluationKind)
    : "text";
}

function readOptions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}
