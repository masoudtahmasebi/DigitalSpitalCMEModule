/**
 * The certificate delivery sweep (P8-03).
 *
 * ## What this is not allowed to do
 *
 * **It must never affect whether a learner can have their certificate.** The
 * download endpoint (P8-04) reads the same row and does not look at any of the
 * delivery columns. Every outcome here — delivered, retrying, given up — leaves
 * the certificate downloadable, and the `bounced` status describes the *email*,
 * not the entitlement. That separation is the whole reason the backlog put
 * download in its own task: email fails for reasons outside our control, and a
 * physician who has earned a Teilnahmebescheinigung must not lose it to a full
 * mailbox.
 *
 * ## Shape
 *
 * Deliberately the same as `EivService.sweep`, because they solve the same
 * problem and a reader who knows one should recognise the other: claim a
 * bounded batch across tenants with a lease, load each row inside its own
 * tenant transaction, ask `@ds/domain` what to do, do it, record the outcome.
 *
 * What differs is the policy — `planDeliveryAttempt` backs off over about a day
 * rather than retrying hard against a statutory deadline — and that no outcome
 * raises an alert. A certificate that could not be emailed is visible in the
 * participant list and the learner can already download it; paging somebody at
 * the weekend for it would be crying wolf against the EIV alerts that matter.
 *
 * ## Personal data
 *
 * The recipient's address is read live from `users` and is never logged, never
 * audited and never written to `delivery_error`. What goes into the log is a
 * certificate id and an outcome; what goes into the audit record is a count.
 */

import { planDeliveryAttempt } from "@ds/domain";
import type { DeliveryChannel, OutboundMessage } from "@ds/plugin-api";
import type { AuditServicePort } from "../../audit/audit.service.js";
import type {
  ClaimedDelivery,
  DeliveryRepositoryPort,
  DueDelivery,
} from "./delivery.repository.js";
import { certificateEmail } from "./delivery.copy.js";

export interface DeliverySweepResult {
  readonly considered: number;
  readonly delivered: number;
  readonly retrying: number;
  readonly abandoned: number;
  readonly waiting: number;
}

export interface DeliveryServiceOptions {
  /** Rows per sweep. Bounded so one sweep cannot run unboundedly long. */
  readonly batchSize: number;
  /**
   * How long a claimed row stays leased before another sweep may take it.
   * Must comfortably exceed one SMTP round trip; a crashed worker's rows become
   * available again when it expires.
   */
  readonly leaseSeconds: number;
  /** Where the download link points. Per deployment, not per project. */
  readonly portalBaseUrl: string;
}

export class CertificateDeliveryService {
  constructor(
    private readonly repository: DeliveryRepositoryPort,
    private readonly channel: DeliveryChannel,
    private readonly audit: AuditServicePort,
    private readonly options: DeliveryServiceOptions,
  ) {}

  async sweep(now: Date): Promise<DeliverySweepResult> {
    const claims = await this.repository.claimDue(
      this.options.batchSize,
      now,
      this.options.leaseSeconds,
    );

    const result = {
      considered: claims.length,
      delivered: 0,
      retrying: 0,
      abandoned: 0,
      waiting: 0,
    };

    for (const claim of claims) {
      // Loaded inside the claim's own tenant scope; a row that vanished between
      // claim and load is simply skipped.
      const row = await this.repository.load(claim);
      if (row === undefined) continue;

      const outcome = await this.processOne(claim, row, now);
      result[outcome] += 1;
    }

    return result;
  }

  private async processOne(
    claim: ClaimedDelivery,
    row: DueDelivery,
    now: Date,
  ): Promise<"delivered" | "retrying" | "abandoned" | "waiting"> {
    const hasRecipient = row.recipientEmail !== null && row.recipientEmail !== "";

    const plan = planDeliveryAttempt({
      now,
      attemptCount: row.attemptCount,
      hasRecipient,
      // The claim already filtered on `delivery_next_attempt_at <= now`, and
      // then overwrote it with the lease — so the stored value is no longer the
      // last attempt time. Passing the epoch makes the backoff check trivially
      // satisfied, exactly as the EIV sweep does for the same reason.
      ...(row.attemptCount === 0 ? {} : { lastAttemptAt: new Date(0) }),
      // Always transient, and that is not an assumption: a permanent failure
      // abandons immediately and sets `delivery_abandoned_reason`, which the
      // claim query excludes. So a row that comes back here failed in a way
      // worth retrying, by construction.
      ...(row.lastError === null ? {} : { lastFailure: "transient" as const }),
    });

    if (plan.action === "wait") return "waiting";

    if (plan.action === "abandon") {
      await this.abandon(claim, row, plan.reason ?? "attempts_exhausted");
      return "abandoned";
    }

    const attemptCount = row.attemptCount + 1;
    const firstAttemptAt = row.firstAttemptAt ?? now;
    const message = this.compose(row);

    const outcome = await this.channel.deliver(message);

    if (outcome.status === "delivered") {
      await this.repository.recordDelivered({
        claim,
        attemptCount,
        firstAttemptAt,
        at: now,
      });
      await this.audit.recordForCustomer(claim.customerId, {
        action: "certificate.delivered",
        subject: claim.certificateId,
        // A count and a channel id. Not the address — that is the physician.
        detail: { attemptCount, channel: this.channel.id },
      });
      return "delivered";
    }

    // Ask the policy again, now knowing how this attempt failed. A permanent
    // rejection stops here rather than waiting out a backoff it will fail after.
    const next = planDeliveryAttempt({
      now,
      attemptCount,
      hasRecipient,
      lastAttemptAt: now,
      lastFailure: outcome.status,
    });

    if (next.action === "abandon") {
      await this.abandon(claim, row, next.reason ?? "attempts_exhausted", {
        attemptCount,
        error: outcome.reason,
      });
      return "abandoned";
    }

    await this.repository.recordRetry({
      claim,
      attemptCount,
      firstAttemptAt,
      // `next.nextAttemptAt` is present whenever the action is `wait`; a `send`
      // this soon after a failure would be a tight loop, so the backoff is the
      // floor either way.
      nextAttemptAt: next.nextAttemptAt ?? new Date(now.getTime() + 60_000),
      error: outcome.reason,
    });
    return "retrying";
  }

  private async abandon(
    claim: ClaimedDelivery,
    row: DueDelivery,
    reason: string,
    override?: { attemptCount: number; error: string },
  ): Promise<void> {
    const attemptCount = override?.attemptCount ?? row.attemptCount;
    await this.repository.recordAbandoned({
      claim,
      attemptCount,
      reason,
      error: override?.error ?? null,
    });
    await this.audit.recordForCustomer(claim.customerId, {
      action: "certificate.delivery_abandoned",
      subject: claim.certificateId,
      detail: { reason, attemptCount, channel: this.channel.id },
    });
  }

  /**
   * Build the message.
   *
   * The German copy lives in `delivery.copy.ts`, not inline (CLAUDE.md §5). The
   * body carries a name, a course title and a download link — and deliberately
   * **no EFN, no score and no attempt count**: an email is the least controlled
   * place a physician's data can end up, and every field in it has to earn its
   * way there (P8-03 acceptance criteria).
   */
  private compose(row: DueDelivery): OutboundMessage {
    const { subject, body } = certificateEmail({
      participantName: row.participantName,
      courseTitle: row.courseTitle,
      downloadUrl: this.downloadUrl(row.downloadToken),
    });

    return {
      // Every header-bound field is stripped of line breaks before it leaves
      // here. `subject` embeds the course title, which an author typed into the
      // console; `to` comes from Keycloak by way of `users`. Neither is ours,
      // and a `\r\n` in either splits one header into two.
      //
      // The **body** is deliberately not stripped: it is the message, not a
      // header, and newlines in it are the paragraphs.
      to: headerSafe(row.recipientEmail ?? ""),
      from: formatSender(row.fromAddress, row.fromName),
      subject: headerSafe(subject),
      body,
      transport: {
        host: row.smtpHost ?? "",
        port: String(row.smtpPort ?? ""),
        ...(row.smtpUsername === null ? {} : { username: row.smtpUsername }),
        ...(row.smtpPassword === null ? {} : { password: row.smtpPassword }),
      },
    };
  }

  /**
   * The link in the email.
   *
   * The download token, not the certificate id: an id in an email is an
   * enumerable identifier in somebody's inbox, and the token is 32 random bytes
   * with a unique constraint behind it (P8-04).
   */
  private downloadUrl(token: string): string {
    const base = this.options.portalBaseUrl.replace(/\/+$/, "");
    return `${base}/zertifikat/${encodeURIComponent(token)}`;
  }
}

/**
 * Anything that can end a header line.
 *
 * CR and LF are the injection: a value containing `\r\n` splits one header into
 * two, and the second one is attacker-controlled — a `Bcc:` on a message that
 * carries a physician's Teilnahmebescheinigung. NUL is here because it
 * terminates the string for anything that later touches it as C.
 *
 * Stripped rather than escaped, because there is no escape for them: a header
 * value simply cannot contain a line break, and a sender display name that
 * wanted one was not a display name.
 */
const HEADER_BREAKS = /[\r\n\0]/g;

/** A value safe to place in a header. See `HEADER_BREAKS`. */
function headerSafe(value: string): string {
  return value.replace(HEADER_BREAKS, "");
}

/**
 * `"Name" <address>`, or the bare address when the project set no name.
 *
 * Both halves come from the project row, which an admin edits — so both are
 * untrusted input to a header, and this is the last place before they become
 * one. Three defences, in order of what they stop:
 *
 * 1. **Line breaks stripped**, which is the header-injection defence proper.
 * 2. **Quotes and backslashes escaped**, so a name cannot terminate the quoted
 *    string early and have the rest read as address parts.
 * 3. **Angle brackets stripped from the address**, so a malformed value cannot
 *    close the `<…>` and append a second recipient.
 *
 * Nodemailer sanitises headers too, and has had CVEs for exactly this class
 * (GHSA-... CRLF in transport name, in `List-*` comments). Doing it here as
 * well is not distrust of the library so much as refusal to have the property
 * depend on a version range.
 */
function formatSender(address: string | null, name: string | null): string {
  const from = (address ?? "").replace(HEADER_BREAKS, "").replace(/[<>]/g, "");
  if (name === null || name.trim() === "") return from;

  const safe = name
    .replace(HEADER_BREAKS, "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');

  return `"${safe}" <${from}>`;
}
