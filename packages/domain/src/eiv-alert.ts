/**
 * When a Punktemeldung approaching its deadline should wake somebody up
 * (P10-06, CLAUDE.md §4 invariant 8).
 *
 * ## The failure this exists to prevent
 *
 * A submission that cannot be sent does not fail loudly. It stays queued, gets
 * retried, and looks healthy in every graph — while the Bescheid's 8-day
 * reporting window runs down. When the window closes the Meldung is refused
 * permanently, the physician's points are never credited, and the first person
 * to find out is the physician, months later, when their Fortbildungskonto is
 * short.
 *
 * The queue already refuses to fail silently: the admin console shows
 * `needs_attention` and the audit log explains how each row got there. But that
 * is a **pull** signal — somebody has to look. Over eight days, across a
 * holiday, nobody does. The Bescheid's paper fallback (an
 * Original-Anwesenheitsliste, submitted within the same 8 days) is only open
 * while the window has not passed, so an alert that arrives after it closes is
 * not an alert, it is a post-mortem.
 *
 * ## Two levels, and why not more
 *
 * `warning` at 48 h and `urgent` at 12 h remaining. Two, because each level is
 * a message a human has to triage and a third would mostly train people to
 * ignore the first. 48 h survives a weekend; 12 h is the last point at which
 * somebody can still do the paper fallback in a working day.
 *
 * A submission already past its deadline gets `overdue` — reported once, not
 * because anything can still be done about it, but because the alert is the
 * record that it happened.
 *
 * ## And one level that is not about the clock at all
 *
 * `blocked` fires the moment a submission stops retrying itself, whatever the
 * deadline says.
 *
 * The three levels above all assume the queue is still working on it: the row
 * is `queued` or `failed_retryable`, the worker will try again, and time is the
 * only thing that decides when a human needs to care. That assumption is wrong
 * for a row the worker has abandoned — `missing_vnr_password` because nobody
 * set the password on the course, a 406 because the VNR is unknown to the
 * Kammer, `live_submission_not_allowed` because the environment is
 * misconfigured. Those rows will sit at `failed_permanent` doing nothing.
 *
 * Under the clock-only rule such a row raises **nothing for six of its eight
 * days**, and then arrives as `warning` with 48 h left — as though it were a
 * retry running late rather than something that stopped on day one and needed a
 * person. Six days is the difference between fixing a password and invoking the
 * Bescheid's paper fallback.
 *
 * So `blocked` is raised immediately and once, and the clock levels still
 * follow if nobody acts: "this stopped" and "this stopped and there are twelve
 * hours left" are different messages and the second is not implied by the
 * first.
 *
 * ## Escalation, not repetition
 *
 * Each level fires **once** per submission. The caller records which levels
 * have already been sent and passes them in; this function only decides which
 * level a submission is currently *in*. An alerting path that re-sends every
 * sweep is one somebody mutes, and a muted alert is worse than none because it
 * is believed to be working.
 *
 * Pure: `now` is an argument, like every other clock read in this package.
 */

/**
 * `warning`, `urgent` and `overdue` are a ladder the caller climbs and never
 * descends. `blocked` is not on that ladder — it says the queue has stopped
 * working on this submission, and it can fire at any distance from the
 * deadline, including alongside one of the others.
 */
export type EivAlertLevel = "blocked" | "warning" | "urgent" | "overdue";

/** Hours before `reportDueAt` at which each level begins. */
const THRESHOLD_HOURS: Readonly<Record<"warning" | "urgent", number>> = {
  warning: 48,
  urgent: 12,
};

const HOUR_MS = 60 * 60 * 1000;

export interface EivAlertCandidate {
  readonly enrolmentId: string;
  readonly reportDueAt: Date;
  /** Levels already sent for this submission, in any order. */
  readonly alreadyAlerted: readonly EivAlertLevel[];
  /**
   * Whether the queue has stopped working on this submission.
   *
   * A boolean rather than the status itself, so this package stays free of the
   * database's vocabulary: `failed_permanent` and `window_closed` are names the
   * schema chose, and a second accreditation interface would choose others. The
   * rule here is about the fact, not the spelling.
   */
  readonly willNotRetry: boolean;
}

export interface EivAlert {
  readonly enrolmentId: string;
  readonly level: EivAlertLevel;
  /** Negative once the deadline has passed. Rounded toward zero. */
  readonly hoursRemaining: number;
}

/**
 * The level a submission is currently in, or `undefined` if it is not yet
 * close enough to its deadline to be worth anybody's attention.
 */
export function alertLevelFor(reportDueAt: Date, now: Date): EivAlertLevel | undefined {
  const remainingMs = reportDueAt.getTime() - now.getTime();

  if (remainingMs <= 0) return "overdue";
  if (remainingMs <= THRESHOLD_HOURS.urgent * HOUR_MS) return "urgent";
  if (remainingMs <= THRESHOLD_HOURS.warning * HOUR_MS) return "warning";
  return undefined;
}

/**
 * Which submissions need an alert raised right now.
 *
 * A submission whose current level has already been sent produces nothing —
 * but one that has crossed into a *higher* level since does, even if the lower
 * one was sent. That is the escalation: 48 h fires once, and if nobody acts,
 * 12 h fires again as something more urgent rather than as the same message
 * repeated.
 */
export function dueAlerts(
  candidates: readonly EivAlertCandidate[],
  now: Date,
): readonly EivAlert[] {
  const alerts: EivAlert[] = [];

  for (const candidate of candidates) {
    const hoursRemaining = Math.trunc(
      (candidate.reportDueAt.getTime() - now.getTime()) / HOUR_MS,
    );

    // `blocked` first, and independently of the clock: a submission the queue
    // has given up on needs a person now, and saying so before the time-based
    // level is the difference between "fix this" and "fix this, and hurry".
    const levels: EivAlertLevel[] = candidate.willNotRetry ? ["blocked"] : [];

    const onTheClock = alertLevelFor(candidate.reportDueAt, now);
    if (onTheClock !== undefined) levels.push(onTheClock);

    for (const level of levels) {
      if (candidate.alreadyAlerted.includes(level)) continue;
      alerts.push({ enrolmentId: candidate.enrolmentId, level, hoursRemaining });
    }
  }

  return alerts;
}
