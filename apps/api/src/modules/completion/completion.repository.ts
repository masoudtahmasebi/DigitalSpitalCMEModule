/**
 * Completion data access (P6, P1-06, P7). Infrastructure layer — ADR-0006.
 *
 * Handles the three tables the end of the journey touches: `evaluations` and
 * `evaluation_responses`, `efn_profiles`, and `eiv_submissions`.
 *
 * `efn_profiles` is not customer-scoped and so is not under RLS: one physician
 * holds one EFN regardless of which customer's course they are taking
 * (ADR-0004). Access is mediated by the service's own-record check — the user
 * id always comes from the validated token, never from the request.
 */

import { and, asc, eq, gt } from "drizzle-orm";
import type { Db } from "../../db/tenant-db.js";
import {
  courses,
  efnProfiles,
  eivSubmissions,
  enrolments,
  evaluationResponses,
  evaluations,
} from "../../db/schema.js";

export interface EvaluationQuestionRow {
  id: string;
  ordinal: number;
  kind: string;
  prompt: string;
  required: boolean;
  options: unknown;
}

export interface CompletionRepositoryPort {
  findEvaluationQuestions(courseId: string): Promise<EvaluationQuestionRow[]>;
  hasEvaluationResponse(enrolmentId: string): Promise<boolean>;
  saveEvaluationResponses(input: {
    customerId: string;
    enrolmentId: string;
    answers: ReadonlyArray<{ evaluationId: string; answer: unknown }>;
  }): Promise<void>;
  saveEfn(userId: string, efn: string): Promise<void>;
  findEfn(userId: string): Promise<string | undefined>;
  /** Whether any enrolment of this learner, in this tenant, awards CME points. */
  hasPointBearingEnrolment(userId: string): Promise<boolean>;
  hasEivSubmission(enrolmentId: string): Promise<boolean>;
  queueEivSubmission(input: {
    customerId: string;
    enrolmentId: string;
    vnr: string;
    efn: string;
    eventEndAt: Date;
    reportDueAt: Date;
  }): Promise<void>;
}

export class CompletionRepository implements CompletionRepositoryPort {
  constructor(private readonly db: Db) {}

  async findEvaluationQuestions(courseId: string): Promise<EvaluationQuestionRow[]> {
    const rows = await this.db
      .select({
        id: evaluations.id,
        ordinal: evaluations.ordinal,
        kind: evaluations.kind,
        prompt: evaluations.prompt,
        required: evaluations.required,
        options: evaluations.options,
      })
      .from(evaluations)
      .where(eq(evaluations.courseId, courseId))
      .orderBy(asc(evaluations.ordinal));

    return rows;
  }

  async hasEvaluationResponse(enrolmentId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: evaluationResponses.id })
      .from(evaluationResponses)
      .where(eq(evaluationResponses.enrolmentId, enrolmentId))
      .limit(1);

    return row !== undefined;
  }

  async saveEvaluationResponses(input: {
    customerId: string;
    enrolmentId: string;
    answers: ReadonlyArray<{ evaluationId: string; answer: unknown }>;
  }): Promise<void> {
    if (input.answers.length === 0) return;

    await this.db.insert(evaluationResponses).values(
      input.answers.map((answer) => ({
        customerId: input.customerId,
        enrolmentId: input.enrolmentId,
        evaluationId: answer.evaluationId,
        answer: answer.answer as never,
      })),
    );
  }

  /** One EFN per user; re-submitting replaces it rather than accumulating. */
  async saveEfn(userId: string, efn: string): Promise<void> {
    await this.db
      .insert(efnProfiles)
      .values({ userId, efn })
      .onConflictDoUpdate({
        target: efnProfiles.userId,
        set: { efn, updatedAt: new Date() },
      });
  }

  async findEfn(userId: string): Promise<string | undefined> {
    const [row] = await this.db
      .select({ efn: efnProfiles.efn })
      .from(efnProfiles)
      .where(eq(efnProfiles.userId, userId))
      .limit(1);

    return row?.efn;
  }

  /**
   * Does this learner have anything here that needs an EFN? (P57-01)
   *
   * Read through the tenant-scoped connection, so it answers for the customer
   * whose portal the request came through and no other. A physician enrolled
   * with two customers is asked the question twice and gets two honest
   * answers, rather than one answer assembled from data this request may not
   * see (ADR-0002).
   *
   * `cme_points` is read off the **course**, live (P171-01).
   *
   * It used to be the enrolment's snapshot, reasoned as *"re-pricing a course
   * later cannot retroactively change whether somebody was asked for their
   * EFN"*. That is the wrong way round on both sides. A course an operator
   * accredits after somebody enrolled would never ask them for an EFN, so no
   * Punktemeldung is filed and a physician who finished an accredited
   * Fortbildung is credited nothing — silently, because nothing on any screen
   * would say a question had been skipped. And a course whose accreditation
   * lapsed would go on collecting a Fortbildungsnummer with nothing left to
   * report it to, which is personal data with no purpose (`docs/gdpr.md` §2).
   */
  async hasPointBearingEnrolment(userId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: enrolments.id })
      .from(enrolments)
      .innerJoin(courses, eq(courses.id, enrolments.courseId))
      .where(and(eq(enrolments.userId, userId), gt(courses.cmePoints, 0)))
      .limit(1);

    return row !== undefined;
  }

  async hasEivSubmission(enrolmentId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: eivSubmissions.id })
      .from(eivSubmissions)
      .where(eq(eivSubmissions.enrolmentId, enrolmentId))
      .limit(1);

    return row !== undefined;
  }

  /**
   * Queue the Punktemeldung. Status starts `queued`; the retry worker (P7-06)
   * owns everything after that.
   *
   * `onConflictDoNothing` on the enrolment makes a double completion request
   * idempotent — the statutory deadlines are computed from the first
   * completion and must not be silently restarted by a second call.
   */
  async queueEivSubmission(input: {
    customerId: string;
    enrolmentId: string;
    vnr: string;
    efn: string;
    eventEndAt: Date;
    reportDueAt: Date;
  }): Promise<void> {
    await this.db
      .insert(eivSubmissions)
      .values({
        customerId: input.customerId,
        enrolmentId: input.enrolmentId,
        vnr: input.vnr,
        efn: input.efn,
        eventEndAt: input.eventEndAt,
        reportDueAt: input.reportDueAt,
      })
      .onConflictDoNothing({ target: eivSubmissions.enrolmentId });
  }
}
