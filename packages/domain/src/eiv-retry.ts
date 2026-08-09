/**
 * EIV submission retry policy (P7-06), implementing ADR-0005.
 *
 * This decides whether a physician's CME points get reported at all, so it is
 * a compliance rule and lives here rather than in the worker
 * (`CLAUDE.md` §4 invariant 4). Time is always an argument; nothing here reads
 * a clock or sleeps.
 *
 * The agreed operational policy: submit as soon as the learner completes; on a
 * retryable failure try **3 more times at 10-minute intervals**; if it is still
 * failing after that, stop and raise an admin alert so a human can pursue it.
 *
 * Two rules override that schedule, and both exist because retrying is not
 * free — it burns the statutory window:
 *
 * 1. **A validation rejection is never retried.** An EFN the Ärztekammer does
 *    not recognise will still be unrecognised in ten minutes. Retrying it
 *    hides the problem until the window has closed, at which point the paper
 *    route (§2 of the Bescheid) is the only remaining option and nobody knows
 *    they need it.
 * 2. **Nothing is sent once the window is shut.** Past the 8-day reporting
 *    deadline with no submission, or past the 7-day correction window after
 *    one, electronic submission is impossible — so the queue must stop and
 *    say so rather than retrying into a closed door.
 *
 * Every terminal outcome carries `alertAdmin: true`. A submission that fails
 * silently is the worst case: the learner believes they have their points, and
 * nobody finds out until the physician's Punktekonto is audited.
 */

import { eivDeadlines, type EivDeadlines } from "./eiv.js";

/** How the last attempt failed. Mirrors the client's own classification. */
export type EivAttemptFailure =
  /** Network, DNS, timeout. Worth retrying. */
  | "transport"
  /** 5xx from EIV. Worth retrying. */
  | "server"
  /**
   * 429. Worth retrying — the interface asks for backoff by name, and the
   * existing 10-minute interval is one. Treating it as permanent would abandon
   * a Punktemeldung EIV was willing to accept, purely because we sent it during
   * a busy minute (P31-01).
   */
  | "rate_limited"
  /** Credentials rejected. Not worth retrying without human action. */
  | "auth"
  /**
   * 406 — the *event* is the problem, not the payload. An unknown or blocked
   * VNR, or a Teilnahmedatum outside the accredited period. Permanent, and the
   * remedy is an operator's or the Ärztekammer's, never a retry (P31-01).
   */
  | "business"
  /** 422 — the payload is malformed: a failed EFN check digit. Never retried. */
  | "validation"
  | "unknown";

export const MAX_ATTEMPTS = 4;
export const RETRY_INTERVAL_MINUTES = 10;

export type EivAction =
  /** Send it now. */
  | "submit"
  /** Not yet — come back at `nextAttemptAt`. */
  | "wait"
  /** Stop. Nothing further will be attempted electronically. */
  | "abandon";

export type EivAbandonReason =
  | "attempts_exhausted"
  | "permanent_rejection"
  | "reporting_window_missed"
  | "correction_window_closed";

export interface EivAttemptPlan {
  readonly action: EivAction;
  /** Present when `action` is `wait`. */
  readonly nextAttemptAt?: Date;
  /** Present when `action` is `abandon`. */
  readonly reason?: EivAbandonReason;
  /**
   * Whether this outcome needs a human. True for every abandonment — a
   * submission that stops without anyone noticing is the failure mode this
   * whole queue exists to prevent (P7-07).
   */
  readonly alertAdmin: boolean;
  /** The deadlines in force, so the caller can persist them without recomputing. */
  readonly deadlines: EivDeadlines;
}

export interface EivAttemptInput {
  /** End of the event. For on-demand, the learner's completion time. */
  readonly eventEndAt: Date;
  readonly now: Date;
  /** How many attempts have already been made. 0 before the first. */
  readonly attemptCount: number;
  /** When the last attempt failed, if one has. */
  readonly lastAttemptAt?: Date;
  readonly lastFailure?: EivAttemptFailure;
  /** When the first successful submission landed, if any. */
  readonly firstSubmittedAt?: Date;
}

export function planEivAttempt(input: EivAttemptInput): EivAttemptPlan {
  const deadlines = eivDeadlines({
    eventEndAt: input.eventEndAt,
    now: input.now,
    ...(input.firstSubmittedAt === undefined
      ? {}
      : { firstSubmittedAt: input.firstSubmittedAt }),
  });

  // Checked before anything else: a closed window makes the retry schedule
  // irrelevant, and reporting "3 attempts remaining" against a shut door would
  // be actively misleading in the admin console.
  if (input.firstSubmittedAt === undefined && !deadlines.canSubmit) {
    return {
      action: "abandon",
      reason: "reporting_window_missed",
      alertAdmin: true,
      deadlines,
    };
  }
  if (input.firstSubmittedAt !== undefined && !deadlines.canCorrect) {
    return {
      action: "abandon",
      reason: "correction_window_closed",
      alertAdmin: true,
      deadlines,
    };
  }

  /*
   * A rejection of the payload, of the event, or of our credentials is not a
   * transient condition. Retrying spends the window to no purpose.
   *
   * `business` joined this list with the real specification (P31-01): a 406
   * says the VNR is unknown or locked, or the Teilnahmedatum falls outside the
   * accredited period. None of those change because we asked again in ten
   * minutes, and all three need a human — which is what `alertAdmin` is for.
   */
  if (
    input.lastFailure === "validation" ||
    input.lastFailure === "auth" ||
    input.lastFailure === "business"
  ) {
    return {
      action: "abandon",
      reason: "permanent_rejection",
      alertAdmin: true,
      deadlines,
    };
  }

  if (input.attemptCount >= MAX_ATTEMPTS) {
    return {
      action: "abandon",
      reason: "attempts_exhausted",
      alertAdmin: true,
      deadlines,
    };
  }

  // First attempt: go immediately. The Punktemeldung should land while the
  // learner is still on the page, not on the next queue sweep.
  if (input.attemptCount === 0 || input.lastAttemptAt === undefined) {
    return { action: "submit", alertAdmin: false, deadlines };
  }

  const nextAttemptAt = new Date(
    input.lastAttemptAt.getTime() + RETRY_INTERVAL_MINUTES * 60_000,
  );

  if (input.now.getTime() < nextAttemptAt.getTime()) {
    return { action: "wait", nextAttemptAt, alertAdmin: false, deadlines };
  }

  return { action: "submit", alertAdmin: false, deadlines };
}
