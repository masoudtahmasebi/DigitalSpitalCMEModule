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

import { and, count, desc, eq, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import type { Db } from "../../db/tenant-db.js";
import type { SecretCipher } from "../../shared/secret-cipher.js";
import { courses, efnProfiles, eivSubmissions, enrolments } from "../../db/schema.js";

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
  /** The EFN the queued row will send today, frozen at completion. */
  readonly efn: string;
  /**
   * The EFN the physician's profile holds **now** (P118).
   *
   * Two copies of one value, and before P118 only the certificate followed the
   * newer one — so an EFN correction printed on the paper and did not reach the
   * Meldung. `efnRefresh` decides which wins; this is the input it needs, and
   * it is null after a GDPR erasure, which deletes the profile and leaves the
   * submission owed.
   */
  readonly profileEfn: string | null;
  readonly status: string;
  readonly eventEndAt: Date;
  readonly firstSubmittedAt: Date | null;
  readonly vnrPassword: string | null;
  readonly punkteBasis: boolean;
  readonly punkteLernerfolg: boolean;
}

/** What the queue screen asks for. */
export interface SubmissionQuery {
  readonly status?: EivSubmissionStatus;
  readonly page: number;
  readonly perPage: number;
  /** Injected, never read from a clock here — the repository stays testable. */
  readonly now: Date;
}

/** One row, already free of the EFN (ADR-0004). */
export interface SubmissionRow {
  readonly enrolmentId: string;
  readonly efnMasked: string;
  readonly courseSlug: string;
  readonly courseTitle: string | null;
  readonly vnr: string;
  readonly status: EivSubmissionStatus;
  readonly attemptCount: number;
  readonly eventEndAt: Date;
  readonly reportDueAt: Date;
  readonly nextAttemptAt: Date | null;
  readonly firstSubmittedAt: Date | null;
  readonly externalReference: string | null;
  readonly lastError: string | null;
  /** What EIV said, as distinct from why we stopped — see migration 0048. */
  readonly failureKind: string | null;
  readonly dueNow: boolean;
}

export interface SubmissionPage {
  readonly items: readonly SubmissionRow[];
  readonly total: number;
  readonly dueNow: number;
}

/** The `eiv_status` enum, exactly. Spelled out so a value the database can
 * hold but this list forgets is a compile error rather than a row the screen
 * silently cannot filter to. */
export type EivSubmissionStatus =
  | "queued"
  | "held"
  | "submitted"
  | "failed_retryable"
  | "failed_permanent"
  | "window_closed"
  | "withdrawn";

export interface EivAdminRepositoryPort {
  accreditationForCourse(slug: string): Promise<CourseAccreditation | undefined>;
  recordedForCourse(slug: string): Promise<readonly RecordedSubmission[]>;
  loadForAction(enrolmentId: string): Promise<SubmissionForAction | undefined>;
  listSubmissions(query: SubmissionQuery): Promise<SubmissionPage>;
  requeue(submissionId: string, now: Date, efn?: string): Promise<void>;
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

  /**
   * The queue, one page of it, and the figure that does not fit on a page.
   *
   * ## The EFN never leaves this method
   *
   * `efn` is selected because the mask is computed from it, and it is dropped
   * in the same expression that produces the mask — there is no shape between
   * here and the controller that carries the whole number (ADR-0004). Masking
   * in SQL rather than in TypeScript would read as tidier and would put the
   * full value in a query plan and a slow-query log for no gain.
   *
   * ## `dueNow` is counted over the queue, not the page
   *
   * It is the number an operator arming the worker needs — how many
   * Punktemeldungen the next sweep will file — and a figure that changed when
   * you turned the page would be worse than none. The predicate is the same one
   * `claim_due_eiv_submissions` uses; if the two ever disagree the screen is
   * lying about the thing it exists to report.
   *
   * RLS bounds every row to the caller's customer (§9.6), and this runs inside
   * `runInTenant` like every other repository read here — on the bare pool it
   * would match zero rows and read as an empty queue.
   */
  async listSubmissions(query: SubmissionQuery): Promise<SubmissionPage> {
    const scoped =
      query.status === undefined ? undefined : eq(eivSubmissions.status, query.status);

    // The sweep's own predicate, spelled once and used for both the flag and
    // the count.
    const due = and(
      or(
        eq(eivSubmissions.status, "queued"),
        eq(eivSubmissions.status, "failed_retryable"),
      ),
      or(
        isNull(eivSubmissions.nextAttemptAt),
        lte(eivSubmissions.nextAttemptAt, query.now),
      ),
    );

    const rows = await this.db
      .select({
        enrolmentId: eivSubmissions.enrolmentId,
        efn: eivSubmissions.efn,
        courseSlug: courses.slug,
        courseTitle: courses.title,
        vnr: eivSubmissions.vnr,
        status: eivSubmissions.status,
        attemptCount: eivSubmissions.attemptCount,
        eventEndAt: eivSubmissions.eventEndAt,
        reportDueAt: eivSubmissions.reportDueAt,
        nextAttemptAt: eivSubmissions.nextAttemptAt,
        firstSubmittedAt: eivSubmissions.firstSubmittedAt,
        externalReference: eivSubmissions.externalReference,
        lastError: eivSubmissions.lastError,
        failureKind: eivSubmissions.failureKind,
        dueNow: sql<boolean>`(${due})`,
      })
      .from(eivSubmissions)
      .innerJoin(enrolments, eq(enrolments.id, eivSubmissions.enrolmentId))
      .innerJoin(courses, eq(courses.id, enrolments.courseId))
      .where(scoped)
      // Soonest deadline first: the row closest to a statutory limit is the one
      // an operator has to see, and it is not the newest row.
      .orderBy(eivSubmissions.reportDueAt, desc(eivSubmissions.createdAt))
      .limit(query.perPage)
      .offset((query.page - 1) * query.perPage);

    const [totals] = await this.db
      .select({
        total: count(),
        dueNow: sql<number>`count(*) filter (where ${due})`,
      })
      .from(eivSubmissions)
      .where(scoped);

    return {
      items: rows.map(({ efn, ...rest }) => ({ ...rest, efnMasked: maskEfn(efn) })),
      total: Number(totals?.total ?? 0),
      dueNow: Number(totals?.dueNow ?? 0),
    };
  }

  async loadForAction(enrolmentId: string): Promise<SubmissionForAction | undefined> {
    const [row] = await this.db
      .select({
        submissionId: eivSubmissions.id,
        enrolmentId: eivSubmissions.enrolmentId,
        customerId: eivSubmissions.customerId,
        vnr: eivSubmissions.vnr,
        efn: eivSubmissions.efn,
        profileEfn: efnProfiles.efn,
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
      // LEFT: an erased subject has no profile row, and the submission it left
      // behind is still owed. A join that dropped the row would turn "no newer
      // EFN" into "no submission" — §9.6's shape, one table over.
      .leftJoin(efnProfiles, eq(efnProfiles.userId, enrolments.userId))
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
  async requeue(submissionId: string, now: Date, efn?: string): Promise<void> {
    await this.db
      .update(eivSubmissions)
      .set({
        status: "queued",
        attemptCount: 0,
        lastError: null,
        /*
         * The EFN moves only when the caller says so (P118).
         *
         * `efnRefresh` in `@ds/domain` decides that, not this method: adopting
         * the newest value unconditionally would silently re-file an accepted
         * Meldung under a different physician, which is S30 and is not a
         * decision a repository should be making on its own.
         */
        ...(efn === undefined ? {} : { efn }),
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

/**
 * Last four digits, the same shape `EivReconciliationRow` uses.
 *
 * Enough to recognise a row beside a person an operator is already looking at;
 * not a disclosure of a national identifier (ADR-0004). A value that is not the
 * expected 15 digits is masked to nothing rather than passed through — a
 * malformed EFN is a data fault, and printing it would be the one case where
 * this function leaked.
 */
function maskEfn(efn: string): string {
  return /^[0-9]{15}$/u.test(efn) ? `\u2026${efn.slice(-4)}` : "\u2026";
}
