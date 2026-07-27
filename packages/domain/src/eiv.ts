/**
 * EIV-FOBI reporting deadlines (P7-03), implementing ADR-0005.
 *
 * Confirmed rules:
 *
 * 1. A participation must be reported **no later than 8 days after the end of
 *    the event**. Submissions past that are blocked, not merely flagged.
 * 2. After the first submission there is a **7-day correction window** in which
 *    corrections and additions can be made electronically.
 * 3. **Once the correction window expires, no further electronic submission for
 *    that VNR is possible at all.** This is the rule that makes the retry queue
 *    a compliance component rather than a reliability one: retrying past the
 *    close is not merely futile, it must stop and record a permanent failure so
 *    a human can pursue the paper route.
 *
 * Kept out of the transport layer deliberately. This is date arithmetic with
 * legal weight — it is the part that most needs exhaustive tests, and it is
 * only exhaustively testable while it has no HTTP client, no network and no
 * credentials attached to it.
 *
 * Time is always an argument. Nothing here reads a clock.
 */

import { addCalendarDays, berlinDateOf, endOfBerlinDay } from "./berlin.js";

export const REPORTING_WINDOW_DAYS = 8;
export const CORRECTION_WINDOW_DAYS = 7;

export type EivPhase =
  /** Not yet submitted, still inside the 8-day reporting window. */
  | "reporting_open"
  /** Not yet submitted and past the 8-day window — electronically blocked. */
  | "reporting_missed"
  /** Submitted, still inside the 7-day correction window. */
  | "correction_open"
  /** Correction window expired. Nothing further can be sent for this VNR. */
  | "closed";

export interface EivDeadlineInput {
  /** End of the event. For an on-demand course this is the completion time. */
  readonly eventEndAt: Date;
  /** Evaluated as of this instant. Always supplied by the caller. */
  readonly now: Date;
  /** When the first successful submission landed, if any. */
  readonly firstSubmittedAt?: Date;
  /** How long before a deadline to start alerting. Default 48 h. */
  readonly alertLeadHours?: number;
}

export interface EivDeadlines {
  /** End of the 8th Berlin day after the event ended. */
  readonly reportDueAt: Date;
  /** End of the 7th Berlin day after the first submission, once submitted. */
  readonly correctionWindowEndsAt?: Date;
  readonly phase: EivPhase;
  /** A first submission is still possible. */
  readonly canSubmit: boolean;
  /** A correction to an existing submission is still possible. */
  readonly canCorrect: boolean;
  /**
   * The retry queue must give up. True once nothing can be sent electronically
   * for this VNR — either the reporting window closed unsubmitted, or the
   * correction window expired.
   */
  readonly shouldStopRetrying: boolean;
  readonly isOverdue: boolean;
  /** Inside the alert lead time on whichever deadline is currently live. */
  readonly needsAlert: boolean;
  /** Milliseconds to the live deadline; negative once it has passed. */
  readonly msUntilDeadline: number;
}

const DEFAULT_ALERT_LEAD_HOURS = 48;
const MS_PER_HOUR = 3_600_000;

export function eivDeadlines(input: EivDeadlineInput): EivDeadlines {
  const reportDueAt = endOfBerlinDay(
    addCalendarDays(berlinDateOf(input.eventEndAt), REPORTING_WINDOW_DAYS),
  );

  const correctionWindowEndsAt =
    input.firstSubmittedAt === undefined
      ? undefined
      : endOfBerlinDay(
          addCalendarDays(berlinDateOf(input.firstSubmittedAt), CORRECTION_WINDOW_DAYS),
        );

  const now = input.now.getTime();
  const alertLeadMs = (input.alertLeadHours ?? DEFAULT_ALERT_LEAD_HOURS) * MS_PER_HOUR;

  const phase = resolvePhase(now, reportDueAt, correctionWindowEndsAt);

  // The live deadline is whichever one currently governs what can still be done.
  const liveDeadline = correctionWindowEndsAt ?? reportDueAt;
  const msUntilDeadline = liveDeadline.getTime() - now;

  const canSubmit = phase === "reporting_open";
  const canCorrect = phase === "correction_open";
  const shouldStopRetrying = phase === "reporting_missed" || phase === "closed";

  return {
    reportDueAt,
    ...(correctionWindowEndsAt === undefined ? {} : { correctionWindowEndsAt }),
    phase,
    canSubmit,
    canCorrect,
    shouldStopRetrying,
    isOverdue: phase === "reporting_missed",
    // Alerting only makes sense while something can still be done about it.
    needsAlert:
      (canSubmit || canCorrect) && msUntilDeadline <= alertLeadMs && msUntilDeadline > 0,
    msUntilDeadline,
  };
}

function resolvePhase(
  now: number,
  reportDueAt: Date,
  correctionWindowEndsAt: Date | undefined,
): EivPhase {
  if (correctionWindowEndsAt === undefined) {
    return now <= reportDueAt.getTime() ? "reporting_open" : "reporting_missed";
  }

  return now <= correctionWindowEndsAt.getTime() ? "correction_open" : "closed";
}

/**
 * EFN format check.
 *
 * The EFN is a 15-digit identifier, permanent per physician. Validated at
 * capture and again immediately before submission (P7-05) — the second check
 * matters because a submission can be retried days after capture, and a record
 * repaired by hand in between must not slip through.
 *
 * No checksum is applied: none is published for the EFN, and inventing one
 * would reject valid numbers. `CLAUDE.md` §7 — do not guess on compliance
 * semantics.
 */
export function isValidEfn(efn: string): boolean {
  return /^[0-9]{15}$/.test(efn);
}
