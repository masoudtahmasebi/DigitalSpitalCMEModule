/**
 * The delivery retry policy.
 *
 * The assertions that matter are the three that stop the queue: a permanent
 * rejection is never retried, the attempt budget is finite, and a learner with
 * no address — including one who has been erased — is not pursued.
 */

import { describe, expect, it } from "vitest";
import {
  backoffMinutes,
  planDeliveryAttempt,
  DELIVERY_BACKOFF_MINUTES,
  MAX_DELIVERY_ATTEMPTS,
  type DeliveryAttemptInput,
} from "./delivery-retry.js";

const NOW = new Date("2026-09-10T10:00:00Z");

function input(over: Partial<DeliveryAttemptInput> = {}): DeliveryAttemptInput {
  return { now: NOW, attemptCount: 0, hasRecipient: true, ...over };
}

describe("planDeliveryAttempt", () => {
  it("sends immediately on the first attempt", () => {
    // The certificate should arrive while the learner is still on the
    // completion screen, not on the next sweep.
    expect(planDeliveryAttempt(input())).toEqual({ action: "send" });
  });

  it("waits out the backoff after a transient failure", () => {
    const plan = planDeliveryAttempt(
      input({
        attemptCount: 1,
        lastAttemptAt: new Date("2026-09-10T09:59:30Z"),
        lastFailure: "transient",
      }),
    );

    expect(plan.action).toBe("wait");
    // One minute after the last attempt, so still 30 seconds out.
    expect(plan.nextAttemptAt).toEqual(new Date("2026-09-10T10:00:30Z"));
  });

  it("sends once the backoff has elapsed", () => {
    expect(
      planDeliveryAttempt(
        input({
          attemptCount: 1,
          lastAttemptAt: new Date("2026-09-10T09:50:00Z"),
          lastFailure: "transient",
        }),
      ),
    ).toEqual({ action: "send" });
  });

  it("backs off further with each failure", () => {
    const waits = [1, 2, 3, 4, 5].map((attemptCount) => {
      const lastAttemptAt = new Date("2026-09-10T09:00:00Z");
      const plan = planDeliveryAttempt(
        input({
          attemptCount,
          lastAttemptAt,
          lastFailure: "transient",
          now: lastAttemptAt,
        }),
      );
      return (plan.nextAttemptAt?.getTime() ?? 0) - lastAttemptAt.getTime();
    });

    // Strictly increasing: 1 min, 5 min, 25 min, 2 h, 6 h.
    for (let i = 1; i < waits.length; i += 1) {
      expect(waits[i]).toBeGreaterThan(waits[i - 1] as number);
    }
  });

  it("never retries a permanent rejection", () => {
    // An address that does not exist will not exist in six hours either.
    // Retrying hides the problem from the participant list.
    expect(
      planDeliveryAttempt(input({ attemptCount: 1, lastFailure: "permanent" })),
    ).toEqual({ action: "abandon", reason: "permanent_rejection" });
  });

  it("gives up after the attempt budget", () => {
    expect(
      planDeliveryAttempt(
        input({
          attemptCount: MAX_DELIVERY_ATTEMPTS,
          lastAttemptAt: new Date("2026-09-01T00:00:00Z"),
          lastFailure: "transient",
        }),
      ),
    ).toEqual({ action: "abandon", reason: "attempts_exhausted" });
  });

  it("does not pursue a learner with no address", () => {
    // Two ways here, both correct outcomes: no email on the Keycloak account,
    // or a subject who has been erased (ADR-0008 nulls the address, and a
    // certificate must not be posted to someone who asked to be forgotten).
    expect(planDeliveryAttempt(input({ hasRecipient: false }))).toEqual({
      action: "abandon",
      reason: "no_recipient",
    });
  });

  it("checks for a recipient before the attempt budget", () => {
    // Otherwise an erased subject with attempts remaining would report
    // "attempts_exhausted", which sends whoever reads it looking for a mail
    // server problem that does not exist.
    expect(
      planDeliveryAttempt(
        input({ hasRecipient: false, attemptCount: 0, lastFailure: "permanent" }),
      ).reason,
    ).toBe("no_recipient");
  });
});

describe("backoffMinutes", () => {
  it("follows the published table", () => {
    expect(DELIVERY_BACKOFF_MINUTES.map((_, i) => backoffMinutes(i + 1))).toEqual([
      ...DELIVERY_BACKOFF_MINUTES,
    ]);
  });

  it("is total — past the table it repeats the last interval", () => {
    // Unreachable through `planDeliveryAttempt`, which abandons first. Defined
    // anyway: a backoff returning undefined would produce NaN minutes, schedule
    // the next attempt at the epoch, and retry in a tight loop.
    expect(backoffMinutes(99)).toBe(
      DELIVERY_BACKOFF_MINUTES[DELIVERY_BACKOFF_MINUTES.length - 1],
    );
    expect(backoffMinutes(0)).toBe(DELIVERY_BACKOFF_MINUTES[0]);
  });
});
