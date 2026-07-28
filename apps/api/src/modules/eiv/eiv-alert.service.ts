/**
 * Raising an alarm about a Punktemeldung that is running out of time
 * (P10-06, CLAUDE.md §4 invariant 8). Application layer — ADR-0006.
 *
 * ## Why this exists as well as the admin console
 *
 * The console already shows `needs_attention`, and the audit trail already
 * explains how each row got there. That is a **pull** signal: it works exactly
 * as long as somebody opens the console. Over the Bescheid's 8-day reporting
 * window, across a weekend or a holiday, nobody does — and when the window
 * closes the Meldung is refused permanently, the physician's points are never
 * credited, and the first person to notice is the physician, months later.
 *
 * The paper fallback the Bescheid allows (an Original-Anwesenheitsliste with
 * EFNs, submitted within the same 8 days) is only open while the window has not
 * passed. An alert that arrives afterwards is not an alert, it is a post-mortem.
 *
 * ## What is sent, and what is deliberately not
 *
 * Enrolment id, urgency, hours remaining, and the customer. **No EFN, no name,
 * no course title.** The destination is a webhook, which in practice is a chat
 * room with an unknown membership — ADR-0004's rule about where an EFN may
 * appear does not stop being true because the channel is convenient.
 *
 * Two delivery paths, and both run:
 *
 * - **A log line at `error`.** Always. Whatever collects the platform's logs
 *   can alert on it, and it is the record that survives if the webhook is
 *   misconfigured.
 * - **A webhook POST**, when `ALERT_WEBHOOK_URL` is set. Generic JSON, so it
 *   works with Slack, Teams, PagerDuty or an internal endpoint without this
 *   file knowing which.
 *
 * A webhook failure is logged and swallowed. An alerting path that can take the
 * sweep down converts "one submission needs attention" into "no submissions are
 * being sent at all", which is the strictly worse outcome.
 *
 * ## Escalation is recorded in the audit log
 *
 * `dueAlerts` decides which level a submission is in; this decides whether that
 * level has already been sent, by reading the append-only audit trail. Storing
 * it there rather than in a column means the escalation history is visible in
 * the same place as everything else that happened to the submission, and cannot
 * be quietly reset by an UPDATE.
 */

import { dueAlerts, type EivAlert, type EivAlertLevel } from "@ds/domain";
import type { AuditServicePort } from "../../audit/audit.service.js";

/** The action recorded once per submission per level. */
export const EIV_ALERT_ACTION = "eiv.deadline_alert";

export interface PendingSubmission {
  readonly enrolmentId: string;
  readonly customerId: string;
  readonly reportDueAt: Date;
  readonly status: string;
  readonly attemptCount: number;
}

export interface EivAlertRepositoryPort {
  /** Submissions not yet reported, whatever their retry state. */
  findUnreported(now: Date): Promise<PendingSubmission[]>;
  /** Which levels have already been alerted, per enrolment id. */
  findAlertedLevels(
    enrolmentIds: readonly string[],
  ): Promise<Map<string, EivAlertLevel[]>>;
}

/** Somewhere for an alert to go. Implemented by a webhook, faked in tests. */
export interface AlertSink {
  send(alert: EivAlert & { customerId: string; status: string }): Promise<void>;
}

export interface AlertLogger {
  error(message: string): void;
  warn(message: string): void;
}

export class EivAlertService {
  constructor(
    private readonly repository: EivAlertRepositoryPort,
    private readonly audit: AuditServicePort,
    private readonly logger: AlertLogger,
    private readonly sink: AlertSink | undefined,
  ) {}

  /**
   * One pass. Returns what it raised, so the caller can log a count and a test
   * can assert on it without reaching into the sink.
   */
  async sweep(now: Date): Promise<readonly EivAlert[]> {
    const pending = await this.repository.findUnreported(now);
    if (pending.length === 0) return [];

    const alerted = await this.repository.findAlertedLevels(
      pending.map((row) => row.enrolmentId),
    );

    const byEnrolment = new Map(pending.map((row) => [row.enrolmentId, row]));

    const alerts = dueAlerts(
      pending.map((row) => ({
        enrolmentId: row.enrolmentId,
        reportDueAt: row.reportDueAt,
        alreadyAlerted: alerted.get(row.enrolmentId) ?? [],
      })),
      now,
    );

    for (const alert of alerts) {
      const submission = byEnrolment.get(alert.enrolmentId);
      if (submission === undefined) continue;

      // The audit row first. If the process dies between the two, a duplicate
      // alert is a nuisance; a *missing* audit row would let the same level
      // fire on every sweep for the rest of the window.
      await this.audit.recordForCustomer(submission.customerId, {
        action: EIV_ALERT_ACTION,
        subject: alert.enrolmentId,
        detail: {
          level: alert.level,
          hoursRemaining: alert.hoursRemaining,
          status: submission.status,
          attemptCount: submission.attemptCount,
        },
      });

      this.logger.error(
        `EIV deadline ${alert.level}: enrolment=${alert.enrolmentId} ` +
          `hoursRemaining=${alert.hoursRemaining} status=${submission.status} ` +
          `attempts=${submission.attemptCount}`,
      );

      if (this.sink !== undefined) {
        try {
          await this.sink.send({
            ...alert,
            customerId: submission.customerId,
            status: submission.status,
          });
        } catch (error) {
          // Swallowed on purpose — see the module header.
          this.logger.warn(
            `EIV alert webhook failed: ${error instanceof Error ? error.message : "unknown error"}`,
          );
        }
      }
    }

    return alerts;
  }
}

/**
 * Posts a small JSON document to a configured URL.
 *
 * Deliberately not shaped for any one provider. A Slack-specific payload would
 * make the destination a code change rather than an environment variable, and
 * whichever provider we picked would be the wrong one for the second customer.
 */
export class WebhookAlertSink implements AlertSink {
  constructor(
    private readonly url: string,
    private readonly timeoutMs = 5000,
  ) {}

  async send(alert: EivAlert & { customerId: string; status: string }): Promise<void> {
    // A hung webhook must not hold the sweep open until the next tick.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(this.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source: "ds-education",
          kind: "eiv_deadline",
          level: alert.level,
          text: alertText(alert),
          enrolmentId: alert.enrolmentId,
          customerId: alert.customerId,
          hoursRemaining: alert.hoursRemaining,
          status: alert.status,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`webhook returned ${response.status}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * A sentence somebody woken by this can act on, without any personal data.
 *
 * German, because the people who act on it work in German and the fallback they
 * would reach for is a form the Ärztekammer publishes in German.
 */
function alertText(alert: EivAlert & { status: string }): string {
  if (alert.level === "overdue") {
    return (
      `Punktemeldung überfällig: Meldefrist seit ${Math.abs(alert.hoursRemaining)} ` +
      `Stunden überschritten (Status ${alert.status}). Die Meldung ist über die ` +
      `Schnittstelle nicht mehr möglich.`
    );
  }

  return (
    `Punktemeldung offen: noch ${alert.hoursRemaining} Stunden bis zum Ablauf der ` +
    `Meldefrist (Status ${alert.status}). Ausnahmsweise nimmt die Ärztekammer eine ` +
    `Meldung per Original-Anwesenheitsliste entgegen — nur innerhalb der Frist.`
  );
}
