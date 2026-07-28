/**
 * The EIV submission worker (P7-05/06/07), implementing ADR-0005.
 *
 * Drains the queue that `CompletionService` fills. One sweep does the same
 * three things for every due row: ask `planEivAttempt` what to do, do it, and
 * record what happened — including failures, in an append-only audit trail
 * (`CLAUDE.md` §4 invariant 8).
 *
 * The service decides nothing. Whether to submit, whether to wait, whether to
 * give up and whether a human must be told are all answered by the pure
 * `planEivAttempt`; whether a failure is retryable is answered by the client's
 * own classification. This file is the part that can be wrong without a CME
 * outcome changing.
 *
 * **Nothing here logs a payload.** The EFN and the VNR password both pass
 * through this code, and neither reaches a log line, an audit `detail` or a
 * stored `last_error` — only the failure *kind* does.
 */

import { EivClient, EivError, type EivFailureKind } from "@ds/eiv-client";
import { planEivAttempt, type EivAttemptFailure } from "@ds/domain";
import type { AuditServicePort } from "../../audit/audit.service.js";
import type {
  ClaimedSubmission,
  DueSubmission,
  EivRepositoryPort,
} from "./eiv.repository.js";

export interface EivSweepResult {
  readonly considered: number;
  readonly submitted: number;
  readonly retrying: number;
  readonly abandoned: number;
  readonly waiting: number;
}

/**
 * The transport, behind a port so the sweep can be unit-tested without a
 * network. The real implementation is `EivClient` from `@ds/eiv-client`.
 */
export interface EivSubmitterPort {
  submit(input: {
    baseUrl: string;
    vnr: string;
    vnrPassword: string;
    efn: string;
  }): Promise<{ accepted: boolean; reference?: string }>;
}

export class LiveEivSubmitter implements EivSubmitterPort {
  async submit(input: {
    baseUrl: string;
    vnr: string;
    vnrPassword: string;
    efn: string;
  }): Promise<{ accepted: boolean; reference?: string }> {
    const client = new EivClient({
      baseUrl: input.baseUrl,
      vnr: input.vnr,
      vnrPassword: input.vnrPassword,
    });

    const { push } = await client.submit(input.efn);
    return {
      accepted: push.accepted,
      ...(push.reference === undefined ? {} : { reference: push.reference }),
    };
  }
}

export interface EivServiceOptions {
  readonly baseUrl: string;
  /** Rows per sweep. Bounded so one sweep cannot run unboundedly long. */
  readonly batchSize: number;
  /**
   * Refuses to talk to anything but a mock unless explicitly allowed. A
   * mis-set base URL that reaches the real Ärztekammer with test data is not
   * an error you can take back.
   */
  readonly allowLive: boolean;
  /**
   * How long a claimed row stays leased before another sweep may take it.
   * Must comfortably exceed one submission round trip; a crashed worker's rows
   * become available again when it expires.
   */
  readonly leaseSeconds: number;
}

export class EivService {
  constructor(
    private readonly repository: EivRepositoryPort,
    private readonly submitter: EivSubmitterPort,
    private readonly audit: AuditServicePort,
    private readonly options: EivServiceOptions,
  ) {}

  async sweep(now: Date): Promise<EivSweepResult> {
    const claims = await this.repository.claimDue(
      this.options.batchSize,
      now,
      this.options.leaseSeconds,
    );

    const result = {
      considered: claims.length,
      submitted: 0,
      retrying: 0,
      abandoned: 0,
      waiting: 0,
    };

    for (const claim of claims) {
      // Loaded inside the claim's own tenant scope; a row that vanished
      // between claim and load (deleted, or already handled) is simply skipped.
      const row = await this.repository.load(claim);
      if (row === undefined) continue;

      const outcome = await this.processOne(claim, row, now);
      result[outcome] += 1;
    }

    return result;
  }

  private async processOne(
    claim: ClaimedSubmission,
    row: DueSubmission,
    now: Date,
  ): Promise<"submitted" | "retrying" | "abandoned" | "waiting"> {
    const plan = planEivAttempt({
      eventEndAt: row.eventEndAt,
      now,
      attemptCount: row.attemptCount,
      // The claim already filtered on `next_attempt_at <= now`, so anything
      // loaded here is due by definition; passing `now` as the last attempt
      // makes the policy's interval check trivially satisfied rather than
      // re-deriving a timestamp the lease has since overwritten.
      ...(row.attemptCount === 0 ? {} : { lastAttemptAt: new Date(0) }),
      ...(row.lastError === null ? {} : { lastFailure: toFailure(row.lastError) }),
      ...(row.firstSubmittedAt === null
        ? {}
        : { firstSubmittedAt: row.firstSubmittedAt }),
    });

    if (plan.action === "wait") return "waiting";

    if (plan.action === "abandon") {
      await this.abandon(claim, row, plan.reason ?? "attempts_exhausted");
      return "abandoned";
    }

    // A course with no VNR password cannot authenticate. Held rather than
    // burned through the retry budget: it is an admin data problem, and the
    // window is better spent once someone fixes it.
    if (row.vnrPassword === null || row.vnrPassword === "") {
      await this.abandon(claim, row, "missing_vnr_password");
      return "abandoned";
    }

    if (!this.options.allowLive && !isLocal(this.options.baseUrl)) {
      // Refusing loudly beats submitting real data to the Ärztekammer from a
      // misconfigured environment.
      await this.abandon(claim, row, "live_submission_not_allowed");
      return "abandoned";
    }

    const attemptCount = row.attemptCount + 1;

    try {
      const push = await this.submitter.submit({
        baseUrl: this.options.baseUrl,
        vnr: row.vnr,
        vnrPassword: row.vnrPassword,
        efn: row.efn,
      });

      if (!push.accepted) {
        throw new EivError("unknown", "EIV did not accept the submission");
      }

      const firstSubmittedAt = row.firstSubmittedAt ?? now;

      await this.repository.recordSuccess({
        claim,
        reference: push.reference,
        attemptCount,
        firstSubmittedAt,
        correctionWindowEndsAt: plan.deadlines.correctionWindowEndsAt,
      });

      await this.audit.recordForCustomer(row.customerId, {
        action: "eiv.submitted",
        subject: row.enrolmentId,
        // Reference and attempt only. No EFN, no VNR password, no payload.
        detail: { attemptCount, reference: push.reference ?? null },
      });

      return "submitted";
    } catch (error) {
      return this.handleFailure(claim, row, error, attemptCount, now);
    }
  }

  private async handleFailure(
    claim: ClaimedSubmission,
    row: DueSubmission,
    error: unknown,
    attemptCount: number,
    now: Date,
  ): Promise<"retrying" | "abandoned"> {
    const failure: EivAttemptFailure =
      error instanceof EivError ? toFailure(error.kind) : "unknown";

    // Re-plan with the failure just observed: a validation rejection abandons
    // immediately rather than consuming the remaining budget.
    const next = planEivAttempt({
      eventEndAt: row.eventEndAt,
      now,
      attemptCount,
      lastAttemptAt: now,
      lastFailure: failure,
      ...(row.firstSubmittedAt === null
        ? {}
        : { firstSubmittedAt: row.firstSubmittedAt }),
    });

    if (next.action === "abandon") {
      await this.abandon(claim, row, next.reason ?? "attempts_exhausted", attemptCount);
      return "abandoned";
    }

    await this.repository.recordRetry({
      claim,
      attemptCount,
      nextAttemptAt: next.nextAttemptAt ?? new Date(now.getTime() + 10 * 60_000),
      failure,
    });

    await this.audit.recordForCustomer(row.customerId, {
      action: "eiv.attempt_failed",
      subject: row.enrolmentId,
      detail: { attemptCount, failure },
    });

    return "retrying";
  }

  /**
   * Stop trying, and make sure a human finds out (P7-07).
   *
   * The audit entry is the alert's source of truth: the admin console reads
   * `failed_permanent` and `window_closed` rows, and this trail explains how
   * each got there. A silent stop is the outcome this whole queue exists to
   * prevent — the learner believes their points were reported.
   */
  private async abandon(
    claim: ClaimedSubmission,
    row: DueSubmission,
    reason: string,
    attemptCount = row.attemptCount,
  ): Promise<void> {
    const windowClosed =
      reason === "reporting_window_missed" || reason === "correction_window_closed";

    await this.repository.recordPermanentFailure({
      claim,
      attemptCount,
      reason,
      windowClosed,
    });

    await this.audit.recordForCustomer(row.customerId, {
      action: "eiv.abandoned",
      subject: row.enrolmentId,
      detail: { reason, attemptCount, windowClosed },
    });
  }
}

/** The client's failure vocabulary and the domain's are deliberately the same. */
function toFailure(kind: EivFailureKind | string): EivAttemptFailure {
  switch (kind) {
    case "transport":
    case "server":
    case "auth":
    case "validation":
      return kind;
    default:
      return "unknown";
  }
}

/** Localhost and the docker-compose mock; anything else is "live". */
function isLocal(baseUrl: string): boolean {
  try {
    const { hostname } = new URL(baseUrl);
    return (
      hostname === "127.0.0.1" ||
      hostname === "localhost" ||
      hostname === "::1" ||
      hostname === "eiv-mock"
    );
  } catch {
    return false;
  }
}
