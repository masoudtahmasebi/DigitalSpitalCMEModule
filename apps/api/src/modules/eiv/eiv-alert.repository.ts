/**
 * Reads for the deadline alarm (P10-06). Infrastructure layer — ADR-0006.
 *
 * ## Why these run on the raw pool, cross-tenant
 *
 * The alert sweep is a platform-operator concern, not a tenant's: it asks "is
 * *any* Punktemeldung anywhere about to miss its statutory deadline". There is
 * no tenant context in which that question is expressible, for the same reason
 * the erasure has none (ADR-0008).
 *
 * So both reads go through `SECURITY DEFINER` functions owned by
 * `ds_binding_resolver` (migration 0011), exactly as `claim_due_eiv_submissions`
 * does. Plain SELECTs on the app pool were the first attempt and they did not
 * merely return nothing — the RLS policy casts `app.customer_id` to uuid, and an
 * unset or empty value made the query throw. Returning nothing would have been
 * the worse outcome: an alarm that finds no submissions looks exactly like an
 * alarm with nothing to report.
 *
 * Both functions return **no tenant data** — an enrolment id, a customer id, a
 * timestamp, a status, a count and an alert level. No EFN, no VNR, no name.
 * That is what makes reading them without a tenant context defensible rather
 * than convenient.
 */

import type { Pool } from "pg";
import type { EivAlertLevel } from "@ds/domain";
import type { EivAlertRepositoryPort, PendingSubmission } from "./eiv-alert.service.js";

/**
 * Only look at submissions close enough to matter.
 *
 * The window is wider than the alert thresholds (48 h) on purpose: a row that
 * has just crossed its deadline still needs its `overdue` alert, and one that
 * missed the window weeks ago does not need looking at on every sweep forever.
 */
const LOOKBACK_DAYS = 30;

export class EivAlertRepository implements EivAlertRepositoryPort {
  constructor(private readonly pool: Pool) {}

  /**
   * Submissions that have not been reported and still could be — plus those
   * that recently could not.
   *
   * `submitted` is excluded because there is nothing to warn about. Everything
   * else is: `queued` looks healthy right up until the window closes, which is
   * exactly the failure this exists to catch.
   */
  async findUnreported(now: Date): Promise<PendingSubmission[]> {
    const { rows } = await this.pool.query<{
      enrolment_id: string;
      customer_id: string;
      event_end_at: Date;
      first_submitted_at: Date | null;
      status: string;
      attempt_count: number;
    }>("SELECT * FROM unreported_eiv_submissions($1, $2)", [now, LOOKBACK_DAYS]);

    /*
     * The deadline is **not** read from `report_due_at` (P58-02). The
     * submission sweep recomputes it from `event_end_at`, and a second answer
     * living in a column is how the alerter came to shout "overdue" about a
     * row the submitter was about to send perfectly legitimately. What comes
     * back here are the inputs; the service applies `eivDeadlines`.
     */
    return rows.map((row) => ({
      enrolmentId: row.enrolment_id,
      customerId: row.customer_id,
      eventEndAt: row.event_end_at,
      ...(row.first_submitted_at === null
        ? {}
        : { firstSubmittedAt: row.first_submitted_at }),
      status: row.status,
      attemptCount: row.attempt_count,
    }));
  }

  /**
   * The escalation history, from the append-only audit log.
   *
   * Not a column on the submission: the audit log cannot be UPDATEd (a database
   * rule refuses it), so an alert that was raised stays raised. A column could
   * be reset — deliberately or by a migration — and the next sweep would replay
   * every level at whoever is on call.
   */
  async findAlertedLevels(
    enrolmentIds: readonly string[],
  ): Promise<Map<string, EivAlertLevel[]>> {
    if (enrolmentIds.length === 0) return new Map();

    const { rows } = await this.pool.query<{ subject: string; level: string }>(
      "SELECT * FROM eiv_alerted_levels($1::text[])",
      [[...enrolmentIds]],
    );

    const levels = new Map<string, EivAlertLevel[]>();
    for (const row of rows) {
      const existing = levels.get(row.subject) ?? [];
      existing.push(row.level as EivAlertLevel);
      levels.set(row.subject, existing);
    }
    return levels;
  }
}
