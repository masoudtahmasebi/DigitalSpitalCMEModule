/**
 * P119-01. The property under test is not "does it return the right string" —
 * it is **who is asked to act**, and the case that matters is the one where
 * getting it wrong is worse than saying nothing at all.
 */

import { describe, expect, it } from "vitest";
import { punktemeldungOutcome, type PunktemeldungKind } from "./punktemeldung.js";

const outcome = (
  status: string | null,
  failureKind?: string | null,
  lastError?: string | null,
) =>
  punktemeldungOutcome({
    status,
    ...(failureKind === undefined ? {} : { failureKind }),
    ...(lastError === undefined ? {} : { lastError }),
  });

describe("nothing is wrong", () => {
  it("says nothing when there is no submission", () => {
    expect(outcome(null)).toEqual({
      kind: "none",
      actor: "nobody",
      participantMayAct: false,
    });
  });

  it("treats every in-flight status as pending, whatever the last attempt said", () => {
    // A transient failure between retries is not something to alarm anybody
    // with: the queue is still working, and a physician told "failed" would
    // act on a state that resolves itself.
    for (const status of ["queued", "held", "failed_retryable"]) {
      expect(outcome(status, "transport").kind).toBe("pending");
      expect(outcome(status, "server").actor).toBe("nobody");
    }
  });

  it("reports and withdraws without asking anybody for anything", () => {
    expect(outcome("submitted").kind).toBe("reported");
    expect(outcome("withdrawn").kind).toBe("withdrawn");
    expect(outcome("submitted").participantMayAct).toBe(false);
  });
});

describe("who can fix a permanent failure", () => {
  /*
   * The whole ticket, in one assertion. 422 means the EFN was refused, and the
   * physician is the only person who can correct it — support cannot set
   * another person's EFN and must not be able to (ADR-0004).
   */
  it("asks the physician, and only for a refused EFN", () => {
    expect(outcome("failed_permanent", "validation")).toEqual({
      kind: "check_efn",
      actor: "participant",
      participantMayAct: true,
    });
  });

  /*
   * The other direction, which is the one that does harm. A physician told to
   * check their EFN when the VNR was blocked follows an instruction that cannot
   * succeed — §9.2 aimed at the person least able to act.
   */
  it("never asks the physician about the event, the credentials or the window", () => {
    const notTheirs: ReadonlyArray<[string, string | null, PunktemeldungKind]> = [
      ["failed_permanent", "business", "event_problem"],
      ["failed_permanent", "auth", "not_configured"],
      ["failed_permanent", null, "failed_unknown"],
      ["window_closed", "validation", "window_closed"],
    ];

    for (const [status, kind, expected] of notTheirs) {
      const result = outcome(status, kind);
      expect(result.kind).toBe(expected);
      expect(result.actor).toBe("operator");
      expect(result.participantMayAct).toBe(false);
    }
  });

  /*
   * A closed window outranks the reason the attempts failed. Once nothing
   * electronic is possible, "correct your EFN" is an instruction that cannot
   * succeed however true its premise — the paper route is the operator's.
   */
  it("puts the closed window ahead of a refused EFN", () => {
    expect(outcome("window_closed", "validation").kind).toBe("window_closed");
    expect(outcome("failed_permanent", "validation").kind).toBe("check_efn");
  });

  /*
   * Rows written before P119-01 have no kind, because `recordPermanentFailure`
   * stored the queue's word and discarded EIV's. "We do not know" is true and
   * actionable — it sends an operator to the audit trail — and guessing would
   * put "check your EFN" in front of somebody whose EFN was never the problem.
   */
  it("says it does not know rather than guessing, for a row from before this existed", () => {
    for (const absent of [null, undefined, ""]) {
      expect(outcome("failed_permanent", absent as string | null).kind).toBe(
        "failed_unknown",
      );
    }
  });

  it("does not treat an unrecognised kind as an EFN problem", () => {
    // `unknown` is what `toFailure` lands on for a status EIV has not shown us
    // before. It must not drift into the one branch that speaks to a physician.
    for (const kind of ["unknown", "transport", "server", "rate_limited"]) {
      expect(outcome("failed_permanent", kind).participantMayAct).toBe(false);
    }
  });
});

describe("purity", () => {
  it("reads no clock — the same input answers the same twice", () => {
    const args = { status: "failed_permanent", failureKind: "validation" } as const;
    expect(punktemeldungOutcome(args)).toEqual(punktemeldungOutcome(args));
  });
});
