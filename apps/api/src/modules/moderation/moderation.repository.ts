/**
 * Learner-record and certificate moderation (P12-05). Infrastructure layer.
 *
 * Every query here is tenant-scoped by RLS — the `Db` handed in is already
 * inside a transaction with `app.customer_id` set — so none carries a
 * `customer_id` predicate. An operator naming another customer's enrolment id
 * does not get a row.
 *
 * ## Two exceptions, and why each is not one
 *
 * `pendingSubmissionsFor` and `eraseSubject` cross the tenant boundary, and
 * both do it because the *subject* does. One physician has one EFN and may hold
 * enrolments at several customers; a GDPR Art. 17 request is about the person,
 * not about the customer whose console it arrived through. `erase_subject`
 * (migration 0009) is the SECURITY DEFINER function that exists for exactly
 * that, owned by `ds_erasure`, and this file calls it rather than reimplementing
 * any part of it.
 *
 * ## What this file never returns
 *
 * A raw EFN. `efn_profiles.efn` is read only to be masked, and the masking is
 * `maskEfn` in `@ds/domain` rather than something written here — one
 * implementation, tested once, applied everywhere (CLAUDE.md §4 invariant 7,
 * ADR-0004).
 */

import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import { maskEfn, type CertificateStatus, type SubmissionStage } from "@ds/domain";
import type { Db } from "../../db/tenant-db.js";

export interface LearnerSummary {
  readonly userId: string;
  readonly enrolmentId: string;
  readonly courseSlug: string;
  readonly courseTitle: string;
  /** The name the physician attested for their certificate, if any. */
  readonly attestedName: string | null;
  /** Last four digits only. Never the whole value. */
  readonly maskedEfn: string | null;
  readonly watchedPercent: number;
  readonly quizBestPercent: number | null;
  readonly completedAt: string | null;
  readonly submissionStage: SubmissionStage;
  readonly certificateStatus: string | null;
}

export interface CertificateRow {
  readonly id: string;
  readonly enrolmentId: string;
  readonly participantName: string;
  readonly status: CertificateStatus;
  readonly issuedAt: string | null;
  readonly deliveredAt: string | null;
}

export interface ModerationRepositoryPort {
  listLearners(courseSlug: string | undefined): Promise<readonly LearnerSummary[]>;
  pendingSubmissionsFor(userId: string): Promise<number>;
  findEnrolment(
    enrolmentId: string,
  ): Promise<{ userId: string; stage: SubmissionStage } | undefined>;
  correctName(enrolmentId: string, name: string): Promise<boolean>;
  listCertificates(courseSlug: string | undefined): Promise<readonly CertificateRow[]>;
  findCertificate(id: string): Promise<CertificateRow | undefined>;
  markForRegeneration(id: string): Promise<boolean>;
  queueDelivery(id: string): Promise<boolean>;
  revoke(id: string): Promise<boolean>;
}

/**
 * Collapse `eiv_status` onto the domain's five stages.
 *
 * The enum has seven values and the rule cares about four distinctions: nothing
 * queued, queued but not accepted, accepted, and accepted-then-withdrawn.
 * `failed_permanent` and `window_closed` join `abandoned` — nothing was ever
 * reported, so a name may still be corrected because there is no record
 * anywhere for it to contradict. `withdrawn` does *not* join them: something
 * was reported, and a name edited afterwards would leave no trace that a
 * different one had reached the Kammer (P31-02).
 *
 * `::text` on the comparison rather than a bare literal. Postgres coerces the
 * literal to the enum, so comparing against a value that is not a member raises
 * `invalid input value for enum eiv_status` at parse time — which is how the
 * first draft of this, testing for a plausible but non-existent `abandoned`,
 * failed every query in this module instead of returning a wrong stage.
 */
const STAGE_SQL = sql`CASE
  WHEN s.status IS NULL THEN 'none'
  WHEN s.status::text = 'submitted' THEN 'submitted'
  WHEN s.status::text = 'withdrawn' THEN 'withdrawn'
  WHEN s.status::text IN ('failed_permanent', 'window_closed') THEN 'abandoned'
  ELSE 'pending'
END`;

export class ModerationRepository implements ModerationRepositoryPort {
  constructor(private readonly db: Db) {}

  async listLearners(courseSlug: string | undefined): Promise<readonly LearnerSummary[]> {
    const result = await this.db.execute<{
      user_id: string;
      enrolment_id: string;
      course_slug: string;
      course_title: string;
      attested_name: string | null;
      efn: string | null;
      watched_percent: number;
      quiz_best_percent: number | null;
      completed_at: Date | string | null;
      stage: SubmissionStage;
      certificate_status: string | null;
    }>(sql`
      SELECT e.user_id,
             e.id                              AS enrolment_id,
             k.slug                            AS course_slug,
             k.title                           AS course_title,
             e.attested_name,
             p.efn,
             COALESCE((
               SELECT round(avg(cp.watched_percent))::int
                 FROM content_progress cp
                WHERE cp.enrolment_id = e.id
             ), 0)                             AS watched_percent,
             (
               SELECT max(qa.score_percent)::int
                 FROM quiz_attempts qa
                WHERE qa.enrolment_id = e.id
             )                                 AS quiz_best_percent,
             e.completed_at,
             ${STAGE_SQL}                      AS stage,
             c.status::text                    AS certificate_status
        FROM enrolments e
        JOIN courses k ON k.id = e.course_id
        LEFT JOIN efn_profiles   p ON p.user_id = e.user_id
        LEFT JOIN eiv_submissions s ON s.enrolment_id = e.id
        LEFT JOIN certificates    c ON c.enrolment_id = e.id
       WHERE (${courseSlug ?? null}::text IS NULL OR k.slug = ${courseSlug ?? null})
       ORDER BY e.created_at DESC
       LIMIT 500
    `);

    return result.rows.map((row) => ({
      userId: row.user_id,
      enrolmentId: row.enrolment_id,
      courseSlug: row.course_slug,
      courseTitle: row.course_title,
      attestedName: row.attested_name,
      // Masked here, at the boundary, so no caller can accidentally hold the
      // real value — it never leaves this method.
      maskedEfn: maskEfn(row.efn),
      watchedPercent: row.watched_percent,
      quizBestPercent: row.quiz_best_percent,
      completedAt: isoOrNull(row.completed_at),
      submissionStage: row.stage,
      certificateStatus: row.certificate_status,
    }));
  }

  async findEnrolment(
    enrolmentId: string,
  ): Promise<{ userId: string; stage: SubmissionStage } | undefined> {
    const result = await this.db.execute<{ user_id: string; stage: SubmissionStage }>(sql`
      SELECT e.user_id, ${STAGE_SQL} AS stage
        FROM enrolments e
        LEFT JOIN eiv_submissions s ON s.enrolment_id = e.id
       WHERE e.id = ${enrolmentId}
       LIMIT 1
    `);
    const row = result.rows[0];
    return row === undefined ? undefined : { userId: row.user_id, stage: row.stage };
  }

  /**
   * How many Punktemeldungen are still owed for this subject **in this tenant**.
   *
   * Tenant-scoped, and that is a real limitation rather than an oversight: a
   * physician may hold enrolments at several customers, and this cannot see the
   * others. `erase_subject` checks globally and is the authority; this exists so
   * the common case — the submission is in the customer whose console the
   * operator is using — produces a sentence instead of a database exception.
   *
   * The first version of this ran on the raw pool, outside any tenant context.
   * `eiv_submissions` has FORCE ROW LEVEL SECURITY, so with no `app.customer_id`
   * set the policy matched nothing and the count was **always zero** — a guard
   * that silently never fired, and whose absence was invisible because the
   * database's own refusal caught what it missed.
   */
  async pendingSubmissionsFor(userId: string): Promise<number> {
    const result = await this.db.execute<{ pending: string }>(sql`
      SELECT count(*) AS pending
        FROM eiv_submissions s
        JOIN enrolments e ON e.id = s.enrolment_id
       WHERE e.user_id = ${userId}
         AND s.status::text IN ('queued', 'held', 'failed_retryable')
    `);
    return Number(result.rows[0]?.pending ?? 0);
  }

  async correctName(enrolmentId: string, name: string): Promise<boolean> {
    const result = await this.db.execute(sql`
      UPDATE enrolments
         SET attested_name = ${name}, updated_at = now()
       WHERE id = ${enrolmentId}
    `);
    return (result.rowCount ?? 0) > 0;
  }

  async listCertificates(
    courseSlug: string | undefined,
  ): Promise<readonly CertificateRow[]> {
    const result = await this.db.execute<{
      id: string;
      enrolment_id: string;
      participant_name: string;
      status: CertificateRow["status"];
      issued_at: Date | string | null;
      delivered_at: Date | string | null;
    }>(sql`
      SELECT c.id, c.enrolment_id, c.participant_name, c.status::text AS status,
             c.issued_at, c.delivered_at
        FROM certificates c
        JOIN enrolments e ON e.id = c.enrolment_id
        JOIN courses    k ON k.id = e.course_id
       WHERE (${courseSlug ?? null}::text IS NULL OR k.slug = ${courseSlug ?? null})
       ORDER BY c.created_at DESC
       LIMIT 500
    `);
    return result.rows.map(toCertificate);
  }

  async findCertificate(id: string): Promise<CertificateRow | undefined> {
    const result = await this.db.execute<{
      id: string;
      enrolment_id: string;
      participant_name: string;
      status: CertificateRow["status"];
      issued_at: Date | string | null;
      delivered_at: Date | string | null;
    }>(sql`
      SELECT id, enrolment_id, participant_name, status::text AS status,
             issued_at, delivered_at
        FROM certificates WHERE id = ${id} LIMIT 1
    `);
    const row = result.rows[0];
    return row === undefined ? undefined : toCertificate(row);
  }

  /**
   * Send a certificate back to `pending` so the renderer picks it up again.
   *
   * The participant name is re-read from the enrolment at render time, which is
   * what makes "correct the name, then regenerate" work. Nothing here touches
   * `eiv_submissions`: the two pipelines share no code, so a regeneration
   * cannot re-report anything (P12-05).
   */
  async markForRegeneration(id: string): Promise<boolean> {
    const result = await this.db.execute(sql`
      UPDATE certificates
         SET status = 'pending',
             issued_at = NULL,
             delivered_at = NULL,
             delivery_error = NULL,
             delivery_attempt_count = 0,
             delivery_next_attempt_at = NULL,
             delivery_first_attempt_at = NULL,
             delivery_abandoned_reason = NULL,
             participant_name = COALESCE(
               (SELECT e.attested_name FROM enrolments e WHERE e.id = certificates.enrolment_id),
               participant_name
             ),
             updated_at = now()
       WHERE id = ${id}
    `);
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Put an already-issued certificate back in the delivery queue.
   *
   * `delivered_at` is cleared and the backoff reset, which is what the worker
   * looks at. The document itself is untouched — this is a resend, not a
   * reissue, and the physician receives the same PDF they were sent before.
   */
  async queueDelivery(id: string): Promise<boolean> {
    const result = await this.db.execute(sql`
      UPDATE certificates
         SET delivered_at = NULL,
             delivery_error = NULL,
             delivery_attempt_count = 0,
             delivery_next_attempt_at = now(),
             delivery_abandoned_reason = NULL,
             updated_at = now()
       WHERE id = ${id} AND status <> 'revoked'
    `);
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Withdraw the document, keeping the record.
   *
   * The enrolment, the progress and any Punktemeldung stay exactly as they
   * were. What was earned was earned; revocation says the *document* is
   * withdrawn, usually because it carries a wrong name or date.
   */
  async revoke(id: string): Promise<boolean> {
    const result = await this.db.execute(sql`
      UPDATE certificates
         SET status = 'revoked', updated_at = now()
       WHERE id = ${id} AND status <> 'revoked'
    `);
    return (result.rowCount ?? 0) > 0;
  }
}

/** `erase_subject` refused because a Punktemeldung is still open. */
export class SubmissionStillOpenError extends Error {
  constructor() {
    super("erase_subject refused: a Punktemeldung is still open for this subject");
    this.name = "SubmissionStillOpenError";
  }
}

function isPendingSubmissionRefusal(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return (
    code === "P0001" && typeof message === "string" && message.includes("Punktemeldung")
  );
}

/**
 * The erasure path, which runs on the raw pool rather than a tenant `Db`.
 *
 * A subject spans customers — one physician, one EFN, possibly several
 * customers' courses — so an erasure cannot be performed inside one tenant's
 * transaction. `erase_subject` is the SECURITY DEFINER function that exists for
 * this (migration 0009); it enforces the pending-submission rule itself and
 * writes its own audit row, so nothing here duplicates either.
 */
export class SubjectErasureRepository {
  constructor(private readonly pool: Pool) {}

  /**
   * Call `erase_subject`, translating its refusal.
   *
   * The function raises when a Punktemeldung is still open, and that raise is
   * the authoritative check — it sees across tenants, which nothing on a
   * tenant-scoped connection can. Letting it surface as an unhandled error
   * would report "Internal server error" for a refusal the operator can act on,
   * so it is caught and re-thrown as `SubmissionStillOpenError` for the service
   * to turn into a 409.
   *
   * Matched on `P0001` — plpgsql's code for a bare `RAISE EXCEPTION` — plus the
   * marker word the function's own message carries. Neither alone is enough:
   * the code is shared with "no such user", and matching only on text would
   * break the day somebody reworded it. Both together fail closed: an
   * unrecognised raise stays a 500, which is the right answer for a refusal
   * nobody has decided how to explain.
   */
  async erase(
    userId: string,
    reason: string,
  ): Promise<{ enrolments: number; responses: number; submissions: number }> {
    const { rows } = await this.pool
      .query<{
        enrolments_pseudonymised: number;
        responses_redacted: number;
        submissions_redacted: number;
      }>("SELECT * FROM erase_subject($1, $2)", [userId, reason])
      .catch((error: unknown) => {
        if (isPendingSubmissionRefusal(error)) throw new SubmissionStillOpenError();
        throw error;
      });

    const row = rows[0];
    if (row === undefined) throw new Error("erase_subject returned no row");
    return {
      enrolments: row.enrolments_pseudonymised,
      responses: row.responses_redacted,
      submissions: row.submissions_redacted,
    };
  }
}

function toCertificate(row: {
  id: string;
  enrolment_id: string;
  participant_name: string;
  status: CertificateRow["status"];
  issued_at: Date | string | null;
  delivered_at: Date | string | null;
}): CertificateRow {
  return {
    id: row.id,
    enrolmentId: row.enrolment_id,
    participantName: row.participant_name,
    status: row.status,
    issuedAt: isoOrNull(row.issued_at),
    deliveredAt: isoOrNull(row.delivered_at),
  };
}

/**
 * A timestamp as an ISO string, whatever `db.execute` handed back.
 *
 * Drizzle's typed query builder gives a `Date`; raw `execute` gives whatever
 * node-postgres's parser produced for the column, which for a `timestamptz`
 * selected through a raw statement is a string. Assuming one of the two is how
 * this module first failed with `toISOString is not a function` on every
 * request — a runtime error that the declared row type happily allowed,
 * because the type was a claim about the driver rather than a check on it.
 */
function isoOrNull(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
