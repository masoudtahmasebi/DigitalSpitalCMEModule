/**
 * Certificate delivery retry policy (P8-03).
 *
 * ## Why this is *not* shaped like `eiv-retry.ts`
 *
 * The two look like the same problem and are not, and the difference is the
 * whole design:
 *
 * **A Punktemeldung has a statutory deadline.** Retrying it burns a window that
 * cannot be reopened, so `planEivAttempt` retries hard and fast — three more
 * times at ten-minute intervals — and stops the moment the window shuts.
 *
 * **A certificate has no deadline at all.** A Teilnahmebescheinigung delivered
 * an hour late is delivered; one delivered a day late is still delivered. So
 * this policy backs *off* rather than hurrying, spreading a handful of attempts
 * over about a day, because the thing most likely to be wrong on the other end
 * — a mail server refusing, a mailbox over quota, a greylist — is fixed by
 * waiting rather than by asking again immediately.
 *
 * ## Delivery never gates anything
 *
 * The learner can download the certificate from the moment it is issued
 * (P8-04). This queue is a convenience on top of that, which is why nothing
 * here has an `alertAdmin` flag the way the EIV policy does: a certificate that
 * could not be emailed is visible in the participant list, and the physician
 * already has a working way to obtain it. Waking somebody at the weekend for it
 * would be crying wolf against the alerts that do matter.
 *
 * Time is always an argument. Nothing here reads a clock or sleeps.
 */

/** How the last delivery attempt failed. */
export type DeliveryFailure =
  /** Connection refused, timeout, greylisted, mailbox full. Worth retrying. */
  | "transient"
  /**
   * The address does not exist, or the server rejected the message itself.
   * Retrying cannot change the answer.
   */
  | "permanent";

/**
 * Six attempts across roughly a day.
 *
 * Chosen against the failure it is actually for: greylisting, which typically
 * clears in minutes, and a mail server restart or quota problem, which clears
 * in hours. Past a day the cause is something a person has to fix, and the
 * queue is better off saying so than continuing to knock.
 */
export const MAX_DELIVERY_ATTEMPTS = 6;

/**
 * Minutes to wait before attempt N+1, indexed by attempts already made.
 *
 * A table rather than `Math.pow`, because the numbers are a policy somebody
 * should be able to read and argue with: 1 min, 5 min, 25 min, 2 h, 6 h, then
 * stop. The first is short enough that an intermittent blip is invisible to the
 * learner; the last is long enough that a business-hours fix lands before the
 * queue gives up.
 *
 * Deliberately no jitter. Jitter needs randomness, and `packages/domain` reads
 * neither a clock nor a random source (CLAUDE.md §4 invariant 4) — that is what
 * makes every rule in here exhaustively testable. The thundering-herd problem
 * jitter solves does not arise at this volume: a few certificates an hour, not
 * a few thousand a second. If that ever changes, the jitter belongs in the
 * worker, which already has a clock.
 */
export const DELIVERY_BACKOFF_MINUTES: readonly number[] = [1, 5, 25, 120, 360];

export type DeliveryAction =
  /** Send it now. */
  | "send"
  /** Not yet — come back at `nextAttemptAt`. */
  | "wait"
  /** Stop. The certificate stays downloadable regardless. */
  | "abandon";

export type DeliveryAbandonReason =
  /** The address was rejected. Asking again cannot change that. */
  | "permanent_rejection"
  /** Backoff exhausted. Something on the far end needs a person. */
  | "attempts_exhausted"
  /**
   * There is no address to send to.
   *
   * Two ways to arrive here and both are correct outcomes rather than errors:
   * a learner whose Keycloak account carries no email, and a learner whose
   * personal data has been erased (ADR-0008 — erasure nulls the address, and a
   * certificate must not be posted to a person who asked to be forgotten).
   */
  | "no_recipient";

export interface DeliveryPlan {
  readonly action: DeliveryAction;
  /** Present when `action` is `wait`. */
  readonly nextAttemptAt?: Date;
  /** Present when `action` is `abandon`. */
  readonly reason?: DeliveryAbandonReason;
}

export interface DeliveryAttemptInput {
  readonly now: Date;
  /** How many attempts have already been made. 0 before the first. */
  readonly attemptCount: number;
  /** When the last attempt was made, if one has been. */
  readonly lastAttemptAt?: Date;
  readonly lastFailure?: DeliveryFailure;
  /**
   * Whether a deliverable address is known.
   *
   * A boolean rather than the address itself: this module decides *whether* to
   * try, and giving a pure policy function a physician's email address would
   * put personal data somewhere it has no reason to be.
   */
  readonly hasRecipient: boolean;
}

export function planDeliveryAttempt(input: DeliveryAttemptInput): DeliveryPlan {
  // Checked first: with nobody to send to, the attempt budget is irrelevant and
  // reporting "3 attempts remaining" would be misleading in the console.
  if (!input.hasRecipient) {
    return { action: "abandon", reason: "no_recipient" };
  }

  if (input.lastFailure === "permanent") {
    return { action: "abandon", reason: "permanent_rejection" };
  }

  if (input.attemptCount >= MAX_DELIVERY_ATTEMPTS) {
    return { action: "abandon", reason: "attempts_exhausted" };
  }

  // First attempt goes immediately: the certificate should arrive while the
  // learner is still on the completion screen, not on the next sweep.
  if (input.attemptCount === 0 || input.lastAttemptAt === undefined) {
    return { action: "send" };
  }

  const waitMinutes = backoffMinutes(input.attemptCount);
  const nextAttemptAt = new Date(input.lastAttemptAt.getTime() + waitMinutes * 60_000);

  if (input.now.getTime() < nextAttemptAt.getTime()) {
    return { action: "wait", nextAttemptAt };
  }

  return { action: "send" };
}

/**
 * How long to wait before the attempt after `attemptCount` failures.
 *
 * Past the end of the table the last interval repeats, which is unreachable
 * through `planDeliveryAttempt` — `MAX_DELIVERY_ATTEMPTS` abandons first — but
 * is defined anyway so the function is total. A backoff that returned
 * `undefined` and produced `NaN` minutes would schedule the next attempt at the
 * epoch and retry in a tight loop.
 */
export function backoffMinutes(attemptCount: number): number {
  const index = Math.max(0, attemptCount - 1);
  const last = DELIVERY_BACKOFF_MINUTES[DELIVERY_BACKOFF_MINUTES.length - 1] ?? 360;
  return DELIVERY_BACKOFF_MINUTES[index] ?? last;
}
