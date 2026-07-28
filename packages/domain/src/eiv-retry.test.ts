import { describe, expect, it } from "vitest";
import {
  MAX_ATTEMPTS,
  planEivAttempt,
  RETRY_INTERVAL_MINUTES,
  type EivAttemptInput,
} from "./eiv-retry.js";

/** Completion at midday, well inside the 8-day reporting window. */
const EVENT_END = new Date("2026-07-01T12:00:00Z");

function plan(over: Partial<EivAttemptInput> = {}) {
  return planEivAttempt({
    eventEndAt: EVENT_END,
    now: new Date("2026-07-01T12:00:05Z"),
    attemptCount: 0,
    ...over,
  });
}

describe("the first attempt goes immediately", () => {
  it("submits as soon as the learner completes", () => {
    const decision = plan();

    expect(decision.action).toBe("submit");
    expect(decision.alertAdmin).toBe(false);
  });

  it("carries the computed deadlines so the caller need not recompute them", () => {
    const decision = plan();

    expect(decision.deadlines.reportDueAt.getTime()).toBeGreaterThan(EVENT_END.getTime());
    expect(decision.deadlines.phase).toBe("reporting_open");
  });
});

describe("retries are spaced 10 minutes apart", () => {
  const lastAttemptAt = new Date("2026-07-01T12:00:10Z");

  it("waits when the interval has not yet elapsed", () => {
    const decision = plan({
      attemptCount: 1,
      lastAttemptAt,
      lastFailure: "transport",
      now: new Date("2026-07-01T12:05:00Z"),
    });

    expect(decision.action).toBe("wait");
    expect(decision.nextAttemptAt).toEqual(
      new Date(lastAttemptAt.getTime() + RETRY_INTERVAL_MINUTES * 60_000),
    );
  });

  it("submits once the interval has elapsed", () => {
    const decision = plan({
      attemptCount: 1,
      lastAttemptAt,
      lastFailure: "transport",
      now: new Date("2026-07-01T12:10:10Z"),
    });

    expect(decision.action).toBe("submit");
  });

  it("submits exactly at the boundary, not one tick after", () => {
    const decision = plan({
      attemptCount: 2,
      lastAttemptAt,
      lastFailure: "server",
      now: new Date(lastAttemptAt.getTime() + RETRY_INTERVAL_MINUTES * 60_000),
    });

    expect(decision.action).toBe("submit");
  });

  it("retries a 5xx from EIV, which is transient", () => {
    const decision = plan({
      attemptCount: 3,
      lastAttemptAt,
      lastFailure: "server",
      now: new Date("2026-07-01T13:00:00Z"),
    });

    expect(decision.action).toBe("submit");
  });
});

describe("the attempt budget is 1 initial + 3 retries", () => {
  it("still submits on the fourth attempt", () => {
    const decision = plan({
      attemptCount: MAX_ATTEMPTS - 1,
      lastAttemptAt: new Date("2026-07-01T12:00:10Z"),
      lastFailure: "transport",
      now: new Date("2026-07-01T13:00:00Z"),
    });

    expect(decision.action).toBe("submit");
  });

  it("abandons and alerts once the budget is spent", () => {
    const decision = plan({
      attemptCount: MAX_ATTEMPTS,
      lastAttemptAt: new Date("2026-07-01T12:30:00Z"),
      lastFailure: "transport",
      now: new Date("2026-07-01T13:00:00Z"),
    });

    expect(decision.action).toBe("abandon");
    expect(decision.reason).toBe("attempts_exhausted");
    // A human has to pursue it; nothing else will.
    expect(decision.alertAdmin).toBe(true);
  });
});

describe("permanent rejections are never retried", () => {
  it("abandons a validation rejection on the first failure", () => {
    // An EFN the Ärztekammer does not recognise will still be unrecognised in
    // ten minutes; retrying spends the window and hides the problem.
    const decision = plan({
      attemptCount: 1,
      lastAttemptAt: new Date("2026-07-01T12:00:10Z"),
      lastFailure: "validation",
      now: new Date("2026-07-01T13:00:00Z"),
    });

    expect(decision.action).toBe("abandon");
    expect(decision.reason).toBe("permanent_rejection");
    expect(decision.alertAdmin).toBe(true);
  });

  it("abandons an auth rejection — the credentials need a human", () => {
    const decision = plan({
      attemptCount: 1,
      lastAttemptAt: new Date("2026-07-01T12:00:10Z"),
      lastFailure: "auth",
      now: new Date("2026-07-01T13:00:00Z"),
    });

    expect(decision.action).toBe("abandon");
    expect(decision.reason).toBe("permanent_rejection");
  });

  it("does retry an unknown failure — unclassified is not the same as permanent", () => {
    const decision = plan({
      attemptCount: 1,
      lastAttemptAt: new Date("2026-07-01T12:00:10Z"),
      lastFailure: "unknown",
      now: new Date("2026-07-01T13:00:00Z"),
    });

    expect(decision.action).toBe("submit");
  });
});

describe("the statutory windows override the retry schedule", () => {
  it("abandons when the 8-day reporting window has closed unsubmitted", () => {
    const decision = plan({
      attemptCount: 1,
      lastAttemptAt: new Date("2026-07-01T12:00:10Z"),
      lastFailure: "transport",
      now: new Date("2026-07-20T12:00:00Z"),
    });

    expect(decision.action).toBe("abandon");
    expect(decision.reason).toBe("reporting_window_missed");
    expect(decision.alertAdmin).toBe(true);
  });

  it("abandons when the 7-day correction window has closed after submitting", () => {
    const decision = plan({
      attemptCount: 1,
      firstSubmittedAt: new Date("2026-07-02T12:00:00Z"),
      lastAttemptAt: new Date("2026-07-02T12:00:00Z"),
      lastFailure: "transport",
      now: new Date("2026-07-20T12:00:00Z"),
    });

    expect(decision.action).toBe("abandon");
    expect(decision.reason).toBe("correction_window_closed");
  });

  it("reports the closed window rather than an exhausted budget", () => {
    // Both conditions hold; the window is the more actionable explanation,
    // because it tells the admin the paper route is now the only option.
    const decision = plan({
      attemptCount: MAX_ATTEMPTS,
      lastAttemptAt: new Date("2026-07-01T12:30:00Z"),
      lastFailure: "transport",
      now: new Date("2026-07-20T12:00:00Z"),
    });

    expect(decision.reason).toBe("reporting_window_missed");
  });

  it("still allows a correction inside the correction window", () => {
    const decision = plan({
      attemptCount: 1,
      firstSubmittedAt: new Date("2026-07-02T12:00:00Z"),
      lastAttemptAt: new Date("2026-07-02T12:00:00Z"),
      lastFailure: "transport",
      now: new Date("2026-07-04T12:00:00Z"),
    });

    expect(decision.action).toBe("submit");
  });
});

describe("purity", () => {
  it("returns the same plan for the same input", () => {
    const input: EivAttemptInput = {
      eventEndAt: EVENT_END,
      now: new Date("2026-07-01T12:20:00Z"),
      attemptCount: 2,
      lastAttemptAt: new Date("2026-07-01T12:00:00Z"),
      lastFailure: "transport",
    };

    expect(planEivAttempt(input)).toEqual(planEivAttempt(input));
  });

  it("does not mutate the dates it is given", () => {
    const now = new Date("2026-07-01T12:20:00Z");
    const snapshot = now.getTime();

    planEivAttempt({ eventEndAt: EVENT_END, now, attemptCount: 0 });

    expect(now.getTime()).toBe(snapshot);
  });
});
