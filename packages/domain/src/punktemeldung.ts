/**
 * What to tell somebody about a Punktemeldung (P119-01).
 *
 * ## The failure this exists for
 *
 * A physician finishes the course, downloads a Teilnahmebescheinigung that says
 * four CME points, and believes they have four CME points. If the Ärztekammer
 * refused the Meldung — a mistyped EFN is the ordinary way — nothing tells
 * them. They find out at their next Fortbildungsnachweis, years later, with the
 * correction window long closed.
 *
 * ADR-0004 already calls this the worst available failure **because it looks
 * like success**. `eiv.service.ts` names it too, in the comment above
 * `abandon`: *"A silent stop is the outcome this whole queue exists to prevent
 * — the learner believes their points were reported."* The queue was built to
 * prevent it and then told nobody.
 *
 * ## Why one function and two audiences
 *
 * Because the split that matters is **who can act**, and getting it backwards
 * is worse than saying nothing:
 *
 * - a refused **EFN** is the physician's to fix, and only theirs — support
 *   cannot set another person's EFN and must not be able to (ADR-0004);
 * - a refused **VNR**, an expired accreditation, a missing credential are the
 *   operator's, and a physician can do nothing about any of them.
 *
 * Telling a physician to check their EFN when the event was the problem is
 * CLAUDE.md §9.2 aimed at the person least able to do anything: it looks like
 * an instruction, and following it changes nothing.
 *
 * So this returns one `kind` and each surface renders its own words for it —
 * the German lives in the widget's and the console's locale files (§5), never
 * here.
 *
 * ## What it deliberately does not read
 *
 * EIV's own rejection text. It can carry the EFN and the responding server, and
 * one of the two audiences here is a physician's browser (§9.5). Only the
 * classification the client already makes is used.
 *
 * Time is not an argument because nothing here reads a clock: the deadline
 * arithmetic is `eivDeadlines`, and `window_closed` arrives as a status.
 */

import type { EivAttemptFailure } from "./eiv-retry.js";

export type PunktemeldungKind =
  /** No Punktemeldung exists — a point-free course, or nothing claimed yet. */
  | "none"
  /** Queued, held or between retries. In flight; nobody needs to do anything. */
  | "pending"
  /** Accepted by EIV-FOBI. The points are on the physician's record. */
  | "reported"
  /** Reported and then taken back by an operator (P31-02). */
  | "withdrawn"
  /**
   * The EFN was refused (422). **The physician can fix this**, and is the only
   * one who can.
   */
  | "check_efn"
  /**
   * The event was refused (406) — an unknown or blocked VNR, a date outside the
   * accredited period. The operator's, or the Ärztekammer's.
   */
  | "event_problem"
  /**
   * The platform could not authenticate at all: no VNR password, or credentials
   * refused. Nothing reached the Kammer. The operator's.
   */
  | "not_configured"
  /**
   * The statutory window has shut. Nothing electronic is possible; §2 of the
   * Bescheid's paper route is what is left, and only an operator can walk it.
   */
  | "window_closed"
  /**
   * Given up on for a reason we cannot attribute — retries exhausted against a
   * far end that never gave a usable answer, or a row from before P119-01,
   * where the kind was discarded before it was stored.
   *
   * Distinct from every other kind on purpose. "We do not know" is a true thing
   * to say and an actionable one — it sends an operator to the audit trail —
   * whereas guessing `check_efn` would put "check your EFN" in front of a
   * physician whose EFN was never the problem.
   */
  | "failed_unknown";

/** Who, if anybody, is being asked to do something. */
export type PunktemeldungActor = "nobody" | "participant" | "operator";

export interface PunktemeldungOutcome {
  readonly kind: PunktemeldungKind;
  readonly actor: PunktemeldungActor;
  /**
   * Whether the physician should be shown this at all.
   *
   * `false` for the states where they have nothing to do and no cause for
   * alarm — and, importantly, for the operator-side failures too. A physician
   * told "the VNR is blocked" learns only that something is wrong with a system
   * they do not control; they are shown that the points have not yet been
   * reported and that it is being dealt with, which is both true and all they
   * can use.
   */
  readonly participantMayAct: boolean;
}

export interface PunktemeldungInput {
  /** `eiv_submissions.status`, or null when there is no submission at all. */
  readonly status: string | null | undefined;
  /** `eiv_submissions.last_error` — why the queue stopped. */
  readonly lastError?: string | null;
  /** `eiv_submissions.failure_kind` — what EIV said. Null before P119-01. */
  readonly failureKind?: EivAttemptFailure | string | null;
}

export function punktemeldungOutcome(input: PunktemeldungInput): PunktemeldungOutcome {
  const status = input.status ?? null;

  if (status === null) return { kind: "none", actor: "nobody", participantMayAct: false };
  if (status === "submitted")
    return { kind: "reported", actor: "nobody", participantMayAct: false };
  if (status === "withdrawn")
    return { kind: "withdrawn", actor: "nobody", participantMayAct: false };

  /*
   * `window_closed` before the failure kind, and that ordering is the rule
   * rather than an implementation detail: once the door has shut, *why* the
   * earlier attempts failed no longer changes what anybody should do. Telling a
   * physician to correct their EFN when no correction can be filed would be an
   * instruction that cannot succeed.
   */
  if (status === "window_closed")
    return { kind: "window_closed", actor: "operator", participantMayAct: false };

  if (status === "failed_permanent") {
    const kind = input.failureKind ?? null;

    if (kind === "validation")
      return { kind: "check_efn", actor: "participant", participantMayAct: true };
    if (kind === "business")
      return { kind: "event_problem", actor: "operator", participantMayAct: false };
    if (kind === "auth")
      return { kind: "not_configured", actor: "operator", participantMayAct: false };

    return { kind: "failed_unknown", actor: "operator", participantMayAct: false };
  }

  // queued, held, failed_retryable — in flight, whatever the last attempt said.
  return { kind: "pending", actor: "nobody", participantMayAct: false };
}
