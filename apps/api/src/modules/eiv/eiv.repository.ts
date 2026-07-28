/**
 * EIV submission queue data access (P7-05/06). Infrastructure layer.
 *
 * The one thing to understand here is **why this is two-phase**, because the
 * obvious single-query version is silently broken:
 *
 * `eiv_submissions` is under RLS. A worker reading it on the raw pool as
 * `ds_app` with no `app.customer_id` set sees zero rows — not an error, just
 * an empty queue that never drains. So:
 *
 *   1. `claimDue` calls `claim_due_eiv_submissions` (migration 0005), a
 *      SECURITY DEFINER function returning **routing metadata only** — which
 *      submission, which customer — and leasing what it hands out so two
 *      instances cannot claim the same row.
 *   2. Everything else runs inside `runInTenant` for that one customer, so the
 *      row read and every write are scoped by RLS exactly as a request would
 *      be. The cross-tenant bypass buys the list of tenants and nothing more.
 *
 * The VNR password is read here and nowhere else, and never returned upward
 * beyond the submitter that needs it (`CLAUDE.md` §4 invariant 7).
 */

import type { Pool } from "pg";
import { and, eq, sql } from "drizzle-orm";
import type { EivAttemptFailure } from "@ds/domain";
import { runInTenant } from "../../db/tenant-db.js";
import type { SecretCipher } from "../../shared/secret-cipher.js";
import { courses, eivSubmissions, enrolments } from "../../db/schema.js";

/** What the claim function returns: enough to open the right tenant scope. */
export interface ClaimedSubmission {
  readonly submissionId: string;
  readonly customerId: string;
}

export interface DueSubmission {
  id: string;
  customerId: string;
  enrolmentId: string;
  vnr: string;
  efn: string;
  status: string;
  attemptCount: number;
  eventEndAt: Date;
  firstSubmittedAt: Date | null;
  nextAttemptAt: Date | null;
  lastError: string | null;
  /** Decrypted from the course's ciphertext. Never leaves this process. */
  vnrPassword: string | null;
}

export interface EivRepositoryPort {
  claimDue(limit: number, now: Date, leaseSeconds: number): Promise<ClaimedSubmission[]>;
  load(claim: ClaimedSubmission): Promise<DueSubmission | undefined>;
  recordSuccess(input: {
    claim: ClaimedSubmission;
    reference: string | undefined;
    attemptCount: number;
    firstSubmittedAt: Date;
    correctionWindowEndsAt: Date | undefined;
  }): Promise<void>;
  recordRetry(input: {
    claim: ClaimedSubmission;
    attemptCount: number;
    nextAttemptAt: Date;
    failure: EivAttemptFailure;
  }): Promise<void>;
  recordPermanentFailure(input: {
    claim: ClaimedSubmission;
    attemptCount: number;
    reason: string;
    windowClosed: boolean;
  }): Promise<void>;
}

export class EivRepository implements EivRepositoryPort {
  constructor(
    private readonly pool: Pool,
    private readonly cipher: SecretCipher,
  ) {}

  async claimDue(
    limit: number,
    now: Date,
    leaseSeconds: number,
  ): Promise<ClaimedSubmission[]> {
    const { rows } = await this.pool.query<{
      submission_id: string;
      customer_id: string;
    }>("SELECT * FROM claim_due_eiv_submissions($1, $2, $3)", [limit, now, leaseSeconds]);

    return rows.map((row) => ({
      submissionId: row.submission_id,
      customerId: row.customer_id,
    }));
  }

  async load(claim: ClaimedSubmission): Promise<DueSubmission | undefined> {
    return this.inTenant(claim, async (db) => {
      const [row] = await db
        .select({
          id: eivSubmissions.id,
          customerId: eivSubmissions.customerId,
          enrolmentId: eivSubmissions.enrolmentId,
          vnr: eivSubmissions.vnr,
          efn: eivSubmissions.efn,
          status: eivSubmissions.status,
          attemptCount: eivSubmissions.attemptCount,
          eventEndAt: eivSubmissions.eventEndAt,
          firstSubmittedAt: eivSubmissions.firstSubmittedAt,
          nextAttemptAt: eivSubmissions.nextAttemptAt,
          lastError: eivSubmissions.lastError,
          vnrPassword: courses.vnrPasswordEnc,
        })
        .from(eivSubmissions)
        .innerJoin(enrolments, eq(enrolments.id, eivSubmissions.enrolmentId))
        .innerJoin(courses, eq(courses.id, enrolments.courseId))
        .where(eq(eivSubmissions.id, claim.submissionId))
        .limit(1);

      if (row === undefined) return undefined;

      // The one place the VNR password is decrypted. It goes straight to the
      // submitter and is never returned above the service.
      return { ...row, vnrPassword: this.cipher.decrypt(row.vnrPassword) };
    });
  }

  async recordSuccess(input: {
    claim: ClaimedSubmission;
    reference: string | undefined;
    attemptCount: number;
    firstSubmittedAt: Date;
    correctionWindowEndsAt: Date | undefined;
  }): Promise<void> {
    await this.inTenant(input.claim, async (db) => {
      await db
        .update(eivSubmissions)
        .set({
          status: "submitted",
          // COALESCE: a correction keeps the reference from the first
          // submission if EIV does not return a new one.
          externalReference: sql`COALESCE(${input.reference ?? null}, ${eivSubmissions.externalReference})`,
          attemptCount: input.attemptCount,
          firstSubmittedAt: sql`COALESCE(${eivSubmissions.firstSubmittedAt}, ${input.firstSubmittedAt})`,
          correctionWindowEndsAt: input.correctionWindowEndsAt ?? null,
          // Clearing the lease is what marks the row genuinely finished.
          nextAttemptAt: null,
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(eivSubmissions.id, input.claim.submissionId));
    });
  }

  /**
   * `lastError` stores the failure *kind* and nothing else. The exchange body
   * holds an EFN and possibly the VNR password, and this column is read back
   * by the admin console (ADR-0004).
   */
  async recordRetry(input: {
    claim: ClaimedSubmission;
    attemptCount: number;
    nextAttemptAt: Date;
    failure: EivAttemptFailure;
  }): Promise<void> {
    await this.inTenant(input.claim, async (db) => {
      await db
        .update(eivSubmissions)
        .set({
          status: "failed_retryable",
          attemptCount: input.attemptCount,
          nextAttemptAt: input.nextAttemptAt,
          lastError: input.failure,
          updatedAt: new Date(),
        })
        .where(eq(eivSubmissions.id, input.claim.submissionId));
    });
  }

  /**
   * `window_closed` is deliberately distinct from `failed_permanent`: the
   * first means the statutory door has shut and the paper route (§2 of the
   * Bescheid) is the only option left; the second means something about this
   * submission is wrong and a human can still fix it and resend. An admin
   * triaging the queue needs to tell those apart at a glance.
   */
  async recordPermanentFailure(input: {
    claim: ClaimedSubmission;
    attemptCount: number;
    reason: string;
    windowClosed: boolean;
  }): Promise<void> {
    await this.inTenant(input.claim, async (db) => {
      await db
        .update(eivSubmissions)
        .set({
          status: input.windowClosed ? "window_closed" : "failed_permanent",
          attemptCount: input.attemptCount,
          nextAttemptAt: null,
          lastError: input.reason,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(eivSubmissions.id, input.claim.submissionId),
            eq(eivSubmissions.customerId, input.claim.customerId),
          ),
        );
    });
  }

  /**
   * Every read and write above goes through here, so the worker is scoped to
   * exactly one customer at a time — the same isolation a request gets, with
   * `system` naming the actor so the audit trail can tell the queue apart from
   * a human super admin.
   */
  private inTenant<T>(
    claim: ClaimedSubmission,
    work: (db: Parameters<Parameters<typeof runInTenant>[2]>[0]) => Promise<T>,
  ): Promise<T> {
    return runInTenant(this.pool, { customerId: claim.customerId, role: "system" }, work);
  }
}
