/**
 * Reading and writing the certificate delivery queue (P8-03).
 *
 * Structurally identical to `eiv.repository.ts`, and deliberately so — the two
 * workers solve the same "find work across tenants without weakening RLS"
 * problem and should be recognisable as the same shape:
 *
 *   1. `claimDue` calls `claim_due_certificate_deliveries` (migration 0012), a
 *      `SECURITY DEFINER` function returning **routing metadata only** — which
 *      certificate, which customer — and leasing what it hands out so two
 *      instances cannot claim the same row.
 *   2. Everything else runs inside `runInTenant` for that one customer, so the
 *      row read and every write are scoped by RLS exactly as a request would
 *      be. The cross-tenant bypass buys the list of tenants and nothing more.
 *
 * The SMTP password is decrypted here and nowhere else, and never returned
 * above the channel that needs it (CLAUDE.md §4 invariant 7).
 */

import type { Pool } from "pg";
import { eq, sql } from "drizzle-orm";
import { runInTenant } from "../../db/tenant-db.js";
import type { SecretCipher } from "../../shared/secret-cipher.js";
import { certificates, courses, enrolments, projects, users } from "../../db/schema.js";

/** What the claim function returns: enough to open the right tenant scope. */
export interface ClaimedDelivery {
  readonly certificateId: string;
  readonly customerId: string;
}

/** Everything one send needs, assembled inside the tenant's own transaction. */
export interface DueDelivery {
  readonly id: string;
  readonly enrolmentId: string;
  readonly courseTitle: string;
  readonly participantName: string;
  readonly downloadToken: string;
  readonly attemptCount: number;
  readonly firstAttemptAt: Date | null;
  readonly nextAttemptAt: Date | null;
  readonly lastError: string | null;
  /**
   * Read live from `users`, never copied onto the certificate row.
   *
   * That is what makes erasure stop delivery for free: ADR-0008 nulls the
   * address, this comes back `null`, and `planDeliveryAttempt` abandons with
   * `no_recipient` rather than posting a Teilnahmebescheinigung to somebody who
   * asked to be forgotten.
   */
  readonly recipientEmail: string | null;
  readonly fromAddress: string | null;
  readonly fromName: string | null;
  readonly smtpHost: string | null;
  readonly smtpPort: number | null;
  readonly smtpUsername: string | null;
  /** Decrypted. Goes straight to the channel and no further. */
  readonly smtpPassword: string | null;
}

export interface DeliveryRepositoryPort {
  claimDue(limit: number, now: Date, leaseSeconds: number): Promise<ClaimedDelivery[]>;
  load(claim: ClaimedDelivery): Promise<DueDelivery | undefined>;
  recordDelivered(input: {
    claim: ClaimedDelivery;
    attemptCount: number;
    firstAttemptAt: Date;
    at: Date;
  }): Promise<void>;
  recordRetry(input: {
    claim: ClaimedDelivery;
    attemptCount: number;
    firstAttemptAt: Date;
    nextAttemptAt: Date;
    error: string;
  }): Promise<void>;
  recordAbandoned(input: {
    claim: ClaimedDelivery;
    attemptCount: number;
    reason: string;
    error: string | null;
  }): Promise<void>;
}

export class DeliveryRepository implements DeliveryRepositoryPort {
  constructor(
    private readonly pool: Pool,
    private readonly cipher: SecretCipher,
  ) {}

  async claimDue(
    limit: number,
    now: Date,
    leaseSeconds: number,
  ): Promise<ClaimedDelivery[]> {
    const { rows } = await this.pool.query<{
      certificate_id: string;
      customer_id: string;
    }>("SELECT * FROM claim_due_certificate_deliveries($1, $2, $3)", [
      limit,
      now,
      leaseSeconds,
    ]);

    return rows.map((row) => ({
      certificateId: row.certificate_id,
      customerId: row.customer_id,
    }));
  }

  async load(claim: ClaimedDelivery): Promise<DueDelivery | undefined> {
    return this.inTenant(claim, async (db) => {
      const [row] = await db
        .select({
          id: certificates.id,
          enrolmentId: certificates.enrolmentId,
          courseTitle: courses.title,
          participantName: certificates.participantName,
          downloadToken: certificates.downloadToken,
          attemptCount: certificates.deliveryAttemptCount,
          firstAttemptAt: certificates.deliveryFirstAttemptAt,
          nextAttemptAt: certificates.deliveryNextAttemptAt,
          lastError: certificates.deliveryError,
          recipientEmail: users.email,
          fromAddress: projects.smtpFromAddress,
          fromName: projects.smtpFromName,
          smtpHost: projects.smtpHost,
          smtpPort: projects.smtpPort,
          smtpUsername: projects.smtpUsername,
          smtpPasswordEnc: projects.smtpPasswordEnc,
        })
        .from(certificates)
        .innerJoin(enrolments, eq(enrolments.id, certificates.enrolmentId))
        .innerJoin(courses, eq(courses.id, enrolments.courseId))
        .innerJoin(projects, eq(projects.id, courses.projectId))
        .innerJoin(users, eq(users.id, enrolments.userId))
        .where(eq(certificates.id, claim.certificateId))
        .limit(1);

      if (row === undefined) return undefined;

      const { smtpPasswordEnc, ...rest } = row;
      return {
        ...rest,
        // The one place the SMTP password is decrypted.
        smtpPassword:
          smtpPasswordEnc === null ? null : this.cipher.decrypt(smtpPasswordEnc),
      };
    });
  }

  async recordDelivered(input: {
    claim: ClaimedDelivery;
    attemptCount: number;
    firstAttemptAt: Date;
    at: Date;
  }): Promise<void> {
    await this.inTenant(input.claim, async (db) => {
      await db
        .update(certificates)
        .set({
          status: "delivered",
          deliveredAt: input.at,
          deliveryAttemptCount: input.attemptCount,
          deliveryFirstAttemptAt: input.firstAttemptAt,
          // Clears the lease: nothing further is due for this row.
          deliveryNextAttemptAt: null,
          deliveryError: null,
          updatedAt: sql`now()`,
        })
        .where(eq(certificates.id, input.claim.certificateId));
    });
  }

  async recordRetry(input: {
    claim: ClaimedDelivery;
    attemptCount: number;
    firstAttemptAt: Date;
    nextAttemptAt: Date;
    error: string;
  }): Promise<void> {
    await this.inTenant(input.claim, async (db) => {
      await db
        .update(certificates)
        .set({
          deliveryAttemptCount: input.attemptCount,
          deliveryFirstAttemptAt: input.firstAttemptAt,
          // Replaces the lease with the real next attempt time.
          deliveryNextAttemptAt: input.nextAttemptAt,
          deliveryError: input.error,
          updatedAt: sql`now()`,
        })
        .where(eq(certificates.id, input.claim.certificateId));
    });
  }

  async recordAbandoned(input: {
    claim: ClaimedDelivery;
    attemptCount: number;
    reason: string;
    error: string | null;
  }): Promise<void> {
    await this.inTenant(input.claim, async (db) => {
      await db
        .update(certificates)
        .set({
          // `bounced` is the schema's word for "delivery will not happen". The
          // certificate stays downloadable — the status describes the email,
          // not the entitlement.
          status: "bounced",
          deliveryAttemptCount: input.attemptCount,
          deliveryAbandonedReason: input.reason,
          deliveryNextAttemptAt: null,
          ...(input.error === null ? {} : { deliveryError: input.error }),
          updatedAt: sql`now()`,
        })
        .where(eq(certificates.id, input.claim.certificateId));
    });
  }

  private inTenant<T>(
    claim: ClaimedDelivery,
    work: (db: Parameters<Parameters<typeof runInTenant>[2]>[0]) => Promise<T>,
  ): Promise<T> {
    return runInTenant(this.pool, { customerId: claim.customerId, role: "system" }, work);
  }
}
