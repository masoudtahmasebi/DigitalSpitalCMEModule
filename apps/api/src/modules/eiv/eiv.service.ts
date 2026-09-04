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

import {
  EivError,
  EIV_PASSWORD_KEY,
  requiresLiveConsent,
  type EivFailureKind,
} from "@ds/eiv-client";
import type { AccreditationReporter } from "@ds/plugin-api";
import { eivDeadlines, planEivAttempt, type EivAttemptFailure } from "@ds/domain";
import { SYSTEM_ACTOR, type AuditServicePort } from "../../audit/audit.service.js";
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
 * The transport is an `AccreditationReporter` from `@ds/plugin-api` (ADR-0010).
 *
 * It was a locally-declared port until the extension registry existed. Nothing
 * about the sweep changed — the reporter still only *carries out* a decision
 * this service and `@ds/domain` already made — but the interface is now the one
 * a second Ärztekammer interface would implement, and the sweep can still be
 * unit-tested with a fake because that is what an interface is for.
 *
 * The live implementation is `EivAccreditationReporter` in `@ds/eiv-client`,
 * registered by `plugins.ts` at startup.
 */
export type EivSubmitterPort = AccreditationReporter;

/**
 * Where this sweep is allowed to file, decided **per sweep** (P180-01).
 *
 * `baseUrl` and `allowLive` used to be constructor options, read from the
 * environment once at boot. They now come from `platform_settings`, which an
 * operator edits in the console — so they are passed in on each `sweep` rather
 * than captured, and a switch takes effect on the next tick instead of on the
 * next deploy. That is the whole point of the move; capturing them here would
 * have kept the old behaviour behind a new screen.
 */
export interface EivSweepTarget {
  readonly baseUrl: string;
  /**
   * Refuses to talk to anything but a mock or EIV's test system unless
   * explicitly consented to. A mis-set endpoint that reaches the real
   * Ärztekammer with test data is not an error you can take back.
   */
  readonly allowLive: boolean;
}

export interface EivServiceOptions {
  /** Rows per sweep. Bounded so one sweep cannot run unboundedly long. */
  readonly batchSize: number;
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

  async sweep(now: Date, target: EivSweepTarget): Promise<EivSweepResult> {
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

      const outcome = await this.processOne(claim, row, now, target);
      result[outcome] += 1;
    }

    return result;
  }

  private async processOne(
    claim: ClaimedSubmission,
    row: DueSubmission,
    now: Date,
    target: EivSweepTarget,
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

    /*
     * A course whose VNR has been cleared has no registration to file against
     * (P186-01). Abandoned rather than falling back to the number queued at
     * completion: an operator who removed the VNR has said this event is not
     * the one they thought, and filing against it anyway is the mistake that
     * cannot be undone (ADR-0005).
     *
     * `auth` for the same reason `missing_vnr_password` is: nothing was sent,
     * and what has to be fixed is a course setting rather than anything the
     * physician did.
     */
    if (row.vnr === null || row.vnr === "") {
      await this.abandon(claim, row, "missing_vnr", row.attemptCount, "auth");
      return "abandoned";
    }

    // A course with no VNR password cannot authenticate. Held rather than
    // burned through the retry budget: it is an admin data problem, and the
    // window is better spent once someone fixes it.
    if (row.vnrPassword === null || row.vnrPassword === "") {
      // `auth` and not undefined: nothing was sent, but the reason it could not
      // be sent is a credential — which is the operator's to fix, and that is
      // the question `failure_kind` answers. Migration 0048 backfills the same
      // value onto historic rows for the same reason.
      await this.abandon(claim, row, "missing_vnr_password", row.attemptCount, "auth");
      return "abandoned";
    }

    if (!target.allowLive && requiresLiveConsent(target.baseUrl)) {
      // Refusing loudly beats submitting real data to the Ärztekammer from a
      // misconfigured environment.
      await this.abandon(claim, row, "live_submission_not_allowed");
      return "abandoned";
    }

    const attemptCount = row.attemptCount + 1;

    try {
      const push = await this.submitter.report({
        efn: row.efn,
        vnr: row.vnr,
        /*
         * `eventEndAt` is the learner's completion instant — `completion.service`
         * writes `now` into it — and it is what the reporting deadline runs
         * from. See `eivDeadlines`, and S11 for what "Veranstaltungsende" means
         * for an on-demand course.
         *
         * It also becomes EIV's `teilnahmedatum`, which the authority checks
         * against the accredited period and refuses with a 406 outside it
         * (P31-01). So for an on-demand Fortbildung whose accredited period has
         * a fixed end, a late completion is refused by EIV even though our own
         * 8-day clock is satisfied. `GET /fobi/veranstalter/veranstaltung` is
         * what makes that knowable in advance.
         */
        completedAt: row.eventEndAt,
        endpoint: target.baseUrl,
        // Decrypted by the repository for this one call and handed straight
        // on. It is never logged, never audited and never returned — the audit
        // record below carries the attempt count and the reference, nothing
        // that could authenticate anybody.
        credentials: { [EIV_PASSWORD_KEY]: row.vnrPassword },
        /*
         * Which credit this course claims (P31-02). A course setting rather
         * than a constant in the reporter, because only the Ärztekammer knows
         * what an event is accredited for and it differs per VNR — S25.
         */
        credit: {
          attendance: row.punkteBasis,
          assessment: row.punkteLernerfolg,
          // Every participant is a Teilnehmer; a Referent is reported by
          // whoever organised the event, not by this platform.
          speaker: 0,
        },
      });

      if (!push.accepted) {
        throw new EivError("unknown", "EIV did not accept the submission");
      }

      const firstSubmittedAt = row.firstSubmittedAt ?? now;

      /*
       * Recomputed, not taken from `plan` (P58-01).
       *
       * The correction window opens when the first Meldung lands, so on a
       * first attempt `plan.deadlines` — computed *before* this submission,
       * from a row with no `firstSubmittedAt` — has no correction window to
       * report. Storing that undefined left `correction_window_ends_at` NULL
       * on every successfully submitted row, permanently: a submitted row is
       * never swept again, so nothing came back to fill it in.
       *
       * The consequence was quiet. Nothing *decided* from the column, because
       * the domain recomputes; but the column is the record an operator reads,
       * an export carries and a support query answers from, and NULL there
       * reads as "no correction window" when in fact one closes in seven days.
       * That is the shape CLAUDE.md §9.6 names — an all-null answer that is
       * indistinguishable from "unset".
       */
      const deadlines = eivDeadlines({
        eventEndAt: row.eventEndAt,
        firstSubmittedAt,
        now,
      });

      await this.repository.recordSuccess({
        claim,
        // What authenticated, which is what the register attributed it to.
        vnr: row.vnr,
        reference: push.reference,
        attemptCount,
        firstSubmittedAt,
        correctionWindowEndsAt: deadlines.correctionWindowEndsAt,
      });

      await this.audit.recordForCustomer(row.customerId, {
        // The worker drained the queue; no human pressed anything for this
        // attempt. When P12-05 adds an operator-triggered resubmit, that path
        // passes a staff actor — the union makes forgetting a compile error.
        actor: SYSTEM_ACTOR,
        action: "eiv.submitted",
        subject: row.enrolmentId,
        /*
         * Attempt count, and the reference when the authority issued one. No
         * EFN, no VNR password, no payload.
         *
         * **EIV issues no reference and no status word** (P31-01): the fields
         * P30-03 carried here were read from a response shape the real
         * interface does not have, and the specification says the status code
         * is the only thing that means anything. They stay in the record
         * because the port is authority-agnostic and a second Ärztekammer may
         * well issue one — for EIV they are simply always null.
         */
        detail: {
          attemptCount,
          reference: push.reference ?? null,
          status: push.status ?? null,
        },
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
      await this.abandon(
        claim,
        row,
        next.reason ?? "attempts_exhausted",
        attemptCount,
        failure,
      );
      return "abandoned";
    }

    await this.repository.recordRetry({
      claim,
      attemptCount,
      nextAttemptAt: next.nextAttemptAt ?? new Date(now.getTime() + 10 * 60_000),
      failure,
    });

    await this.audit.recordForCustomer(row.customerId, {
      actor: SYSTEM_ACTOR,
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
    /**
     * What EIV said, where there was an EIV answer (P119-01).
     *
     * `reason` is the queue's word for why it stopped and collapses `auth`,
     * `business` and `validation` into `permanent_rejection` — fine for
     * deciding not to retry, useless for deciding *who can fix it*. A 422 means
     * the physician's EFN was refused; a 406 means the event was. Only one of
     * those is something a physician can act on, and telling them the wrong one
     * is §9.2 aimed at the person least able to do anything about it.
     *
     * Absent for the reasons reached without sending anything.
     */
    failureKind?: EivAttemptFailure,
  ): Promise<void> {
    const windowClosed =
      reason === "reporting_window_missed" || reason === "correction_window_closed";

    await this.repository.recordPermanentFailure({
      claim,
      attemptCount,
      reason,
      windowClosed,
      ...(failureKind === undefined ? {} : { failureKind }),
    });

    await this.audit.recordForCustomer(row.customerId, {
      actor: SYSTEM_ACTOR,
      action: "eiv.abandoned",
      subject: row.enrolmentId,
      detail: {
        reason,
        attemptCount,
        windowClosed,
        ...(failureKind ? { failureKind } : {}),
      },
    });
  }
}

/** The client's failure vocabulary and the domain's are deliberately the same. */
function toFailure(kind: EivFailureKind | string): EivAttemptFailure {
  switch (kind) {
    case "transport":
    case "server":
    case "rate_limited":
    case "auth":
    case "business":
    case "validation":
      return kind;
    default:
      return "unknown";
  }
}
