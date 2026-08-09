/**
 * Operator-facing EIV data access (P31-02). Infrastructure layer.
 *
 * Separate from `eiv.repository.ts` because the two have opposite tenancy
 * shapes and mixing them is how a bypass gets reused by accident. The worker's
 * repository begins with a **cross-tenant** claim — a SECURITY DEFINER function
 * that hands out routing metadata for every customer at once — and then narrows.
 * Everything here runs inside an ordinary request whose tenant is already
 * decided by the interceptor, so it needs no bypass at all and must not have
 * one.
 *
 * The VNR password is decrypted in exactly two places in this codebase: there,
 * for the worker, and here, for an operator's action. Both hand it straight to
 * the reporter and neither returns it upward (`CLAUDE.md` §4 invariant 7).
 */

import { and, eq, isNotNull } from "drizzle-orm";
import type { Db } from "../../db/tenant-db.js";
import type { SecretCipher } from "../../shared/secret-cipher.js";
import { courses, eivSubmissions, enrolments } from "../../db/schema.js";

/** A course's EIV credentials and the settings that shape its Meldung. */
export interface CourseAccreditation {
  readonly courseId: string;
  readonly vnr: string | null;
  /** Decrypted for this one call. Never returned beyond the reporter. */
  readonly vnrPassword: string | null;
  readonly punkteBasis: boolean;
  readonly punkteLernerfolg: boolean;
}

/** One submission this platform recorded, for reconciliation. */
export interface RecordedSubmission {
  readonly efn: string;
  readonly status: string;
  readonly eventEndAt: Date;
}

/** A single submission and everything needed to act on it. */
export interface SubmissionForAction {
  readonly submissionId: string;
  readonly enrolmentId: string;
  readonly customerId: string;
  readonly vnr: string;
  readonly efn: string;
  readonly status: string;
  readonly eventEndAt: Date;
  readonly firstSubmittedAt: Date | null;
  readonly vnrPassword: string | null;
  readonly punkteBasis: boolean;
  readonly punkteLernerfolg: boolean;
}

export interface EivAdminRepositoryPort {
  accreditationForCourse(slug: string): Promise<CourseAccreditation | undefined>;
  recordedForCourse(slug: string): Promise<readonly RecordedSubmission[]>;
  loadForAction(enrolmentId: string): Promise<SubmissionForAction | undefined>;
  requeue(submissionId: string, now: Date): Promise<void>;
  markWithdrawn(submissionId: string, now: Date): Promise<void>;
}

export class EivAdminRepository implements EivAdminRepositoryPort {
  constructor(
    private readonly db: Db,
    private readonly cipher: SecretCipher,
  ) {}

  async accreditationForCourse(slug: string): Promise<CourseAccreditation | undefined> {
    const [row] = await this.db
      .select({
        courseId: courses.id,
        vnr: courses.vnr,
        vnrPasswordEnc: courses.vnrPasswordEnc,
        punkteBasis: courses.eivPunkteBasis,
        punkteLernerfolg: courses.eivPunkteLernerfolg,
      })
      .from(courses)
      .where(eq(courses.slug, slug))
      .limit(1);

    if (row === undefined) return undefined;

    const { vnrPasswordEnc, ...rest } = row;
    return { ...rest, vnrPassword: this.cipher.decrypt(vnrPasswordEnc) };
  }

  /**
   * What this platform believes it reported, for a course.
   *
   * Only rows with an EFN: a submission whose subject has been erased carries
   * none, and it is not something the Ärztekammer could be asked about either.
   */
  async recordedForCourse(slug: string): Promise<readonly RecordedSubmission[]> {
    return this.db
      .select({
        efn: eivSubmissions.efn,
        status: eivSubmissions.status,
        eventEndAt: eivSubmissions.eventEndAt,
      })
      .from(eivSubmissions)
      .innerJoin(enrolments, eq(enrolments.id, eivSubmissions.enrolmentId))
      .innerJoin(courses, eq(courses.id, enrolments.courseId))
      .where(and(eq(courses.slug, slug), isNotNull(eivSubmissions.efn)));
  }

  async loadForAction(enrolmentId: string): Promise<SubmissionForAction | undefined> {
    const [row] = await this.db
      .select({
        submissionId: eivSubmissions.id,
        enrolmentId: eivSubmissions.enrolmentId,
        customerId: eivSubmissions.customerId,
        vnr: eivSubmissions.vnr,
        efn: eivSubmissions.efn,
        status: eivSubmissions.status,
        eventEndAt: eivSubmissions.eventEndAt,
        firstSubmittedAt: eivSubmissions.firstSubmittedAt,
        vnrPasswordEnc: courses.vnrPasswordEnc,
        punkteBasis: courses.eivPunkteBasis,
        punkteLernerfolg: courses.eivPunkteLernerfolg,
      })
      .from(eivSubmissions)
      .innerJoin(enrolments, eq(enrolments.id, eivSubmissions.enrolmentId))
      .innerJoin(courses, eq(courses.id, enrolments.courseId))
      .where(eq(eivSubmissions.enrolmentId, enrolmentId))
      .limit(1);

    if (row === undefined) return undefined;

    const { vnrPasswordEnc, ...rest } = row;
    return { ...rest, vnrPassword: this.cipher.decrypt(vnrPasswordEnc) };
  }

  /**
   * Hand an abandoned row back to the worker.
   *
   * The attempt counter resets, because the operator is asserting that whatever
   * caused the previous failures has been dealt with — a VNR entered, a
   * password corrected, a lock lifted. `last_error` is cleared for the same
   * reason: leaving it would make `planEivAttempt` abandon the row again on the
   * first pass, since a `business` or `validation` failure is permanent.
   */
  async requeue(submissionId: string, now: Date): Promise<void> {
    await this.db
      .update(eivSubmissions)
      .set({
        status: "queued",
        attemptCount: 0,
        lastError: null,
        // Also clears the worker's lease: the lease *is* `next_attempt_at`
        // pushed forward (migration 0005), so setting it to now both schedules
        // the row and releases it.
        nextAttemptAt: now,
      })
      .where(eq(eivSubmissions.id, submissionId));
  }

  /**
   * Record that the Punktemeldung was withdrawn at the authority.
   *
   * A distinct status rather than deleting the row or reverting it to pending:
   * the physician's record has to show that points were reported and then taken
   * back, which is a different history from never having been reported.
   */
  async markWithdrawn(submissionId: string, now: Date): Promise<void> {
    await this.db
      .update(eivSubmissions)
      .set({ status: "withdrawn", lastError: null, updatedAt: now })
      .where(eq(eivSubmissions.id, submissionId));
  }
}
