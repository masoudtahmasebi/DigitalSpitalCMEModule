import { describe, expect, it } from "vitest";
import {
  CORRECTION_WINDOW_DAYS,
  eivDeadlines,
  isValidEfn,
  REPORTING_WINDOW_DAYS,
} from "./eiv.js";
import { addCalendarDays, berlinDateOf, endOfBerlinDay } from "./berlin.js";

/** 2026-08-15T12:00:00Z — a summer (CEST, UTC+2) instant. */
const SUMMER_EVENT_END = new Date("2026-08-15T12:00:00Z");

describe("reporting window", () => {
  it("is 8 days, ending at the close of the 8th Berlin day", () => {
    const { reportDueAt } = eivDeadlines({
      eventEndAt: SUMMER_EVENT_END,
      now: SUMMER_EVENT_END,
    });

    // 15 Aug + 8 days = 23 Aug, end of day Berlin = 21:59:59.999Z in CEST.
    expect(reportDueAt.toISOString()).toBe("2026-08-23T21:59:59.999Z");
    expect(REPORTING_WINDOW_DAYS).toBe(8);
  });

  it("is open the instant before the deadline and missed the instant after", () => {
    const due = eivDeadlines({
      eventEndAt: SUMMER_EVENT_END,
      now: SUMMER_EVENT_END,
    }).reportDueAt;

    const justInside = eivDeadlines({
      eventEndAt: SUMMER_EVENT_END,
      now: new Date(due.getTime() - 1),
    });
    const justOutside = eivDeadlines({
      eventEndAt: SUMMER_EVENT_END,
      now: new Date(due.getTime() + 1),
    });

    expect(justInside.phase).toBe("reporting_open");
    expect(justInside.canSubmit).toBe(true);
    expect(justInside.isOverdue).toBe(false);

    expect(justOutside.phase).toBe("reporting_missed");
    expect(justOutside.canSubmit).toBe(false);
    expect(justOutside.isOverdue).toBe(true);
  });

  it("stops the retry queue once the reporting window closes unsubmitted", () => {
    const result = eivDeadlines({
      eventEndAt: SUMMER_EVENT_END,
      now: new Date("2026-09-01T00:00:00Z"),
    });

    // Retrying past this point is not merely futile: no electronic submission
    // for the VNR is possible, so the queue must give up and record it.
    expect(result.shouldStopRetrying).toBe(true);
  });
});

describe("correction window", () => {
  const submittedAt = new Date("2026-08-20T09:00:00Z");

  it("is 7 days from the first submission", () => {
    const { correctionWindowEndsAt } = eivDeadlines({
      eventEndAt: SUMMER_EVENT_END,
      now: submittedAt,
      firstSubmittedAt: submittedAt,
    });

    expect(correctionWindowEndsAt?.toISOString()).toBe("2026-08-27T21:59:59.999Z");
    expect(CORRECTION_WINDOW_DAYS).toBe(7);
  });

  it("permits corrections on the last valid day and refuses them one day later", () => {
    const onLastDay = eivDeadlines({
      eventEndAt: SUMMER_EVENT_END,
      now: new Date("2026-08-27T20:00:00Z"),
      firstSubmittedAt: submittedAt,
    });
    const oneDayLate = eivDeadlines({
      eventEndAt: SUMMER_EVENT_END,
      now: new Date("2026-08-28T20:00:00Z"),
      firstSubmittedAt: submittedAt,
    });

    expect(onLastDay.phase).toBe("correction_open");
    expect(onLastDay.canCorrect).toBe(true);
    expect(onLastDay.shouldStopRetrying).toBe(false);

    expect(oneDayLate.phase).toBe("closed");
    expect(oneDayLate.canCorrect).toBe(false);
    expect(oneDayLate.shouldStopRetrying).toBe(true);
  });

  it("takes precedence over the reporting deadline once submitted", () => {
    // Submitted on time, and now past the 8-day reporting deadline: the
    // correction window governs, so this is not overdue.
    const result = eivDeadlines({
      eventEndAt: SUMMER_EVENT_END,
      now: new Date("2026-08-25T09:00:00Z"),
      firstSubmittedAt: submittedAt,
    });

    expect(result.phase).toBe("correction_open");
    expect(result.isOverdue).toBe(false);
  });
});

describe("DST safety", () => {
  it("does not shift the deadline by a day across the autumn transition", () => {
    // Germany leaves CEST on 25 October 2026. An event ending on 20 October
    // has its deadline on 28 October — after the transition. Adding 8 x 24 h
    // to the instant would land at 22:59 local on the 27th; calendar
    // arithmetic correctly lands at end of the 28th.
    const eventEnd = new Date("2026-10-20T22:30:00Z");
    const { reportDueAt } = eivDeadlines({ eventEndAt: eventEnd, now: eventEnd });

    const berlinDue = berlinDateOf(reportDueAt);

    // 20 Oct 22:30Z is already 21 Oct in Berlin (CEST, UTC+2).
    expect(berlinDateOf(eventEnd)).toEqual({ year: 2026, month: 10, day: 21 });
    expect(berlinDue).toEqual({ year: 2026, month: 10, day: 29 });

    // Post-transition Berlin is UTC+1, so end of day is 22:59:59.999Z.
    expect(reportDueAt.toISOString()).toBe("2026-10-29T22:59:59.999Z");
  });

  it("does not shift the deadline across the spring transition", () => {
    // Germany enters CEST on 29 March 2026.
    const eventEnd = new Date("2026-03-25T10:00:00Z");
    const { reportDueAt } = eivDeadlines({ eventEndAt: eventEnd, now: eventEnd });

    expect(berlinDateOf(reportDueAt)).toEqual({ year: 2026, month: 4, day: 2 });
    expect(reportDueAt.toISOString()).toBe("2026-04-02T21:59:59.999Z");
  });

  it("rolls the calendar over month and year boundaries", () => {
    const eventEnd = new Date("2026-12-28T10:00:00Z");
    const { reportDueAt } = eivDeadlines({ eventEndAt: eventEnd, now: eventEnd });

    expect(berlinDateOf(reportDueAt)).toEqual({ year: 2027, month: 1, day: 5 });
  });

  it("handles a leap day", () => {
    const eventEnd = new Date("2028-02-25T10:00:00Z");
    const { reportDueAt } = eivDeadlines({ eventEndAt: eventEnd, now: eventEnd });

    expect(berlinDateOf(reportDueAt)).toEqual({ year: 2028, month: 3, day: 4 });
  });
});

describe("alerting", () => {
  it("fires inside the lead time while something can still be done", () => {
    const due = eivDeadlines({
      eventEndAt: SUMMER_EVENT_END,
      now: SUMMER_EVENT_END,
    }).reportDueAt;

    const result = eivDeadlines({
      eventEndAt: SUMMER_EVENT_END,
      now: new Date(due.getTime() - 24 * 3_600_000),
      alertLeadHours: 48,
    });

    expect(result.needsAlert).toBe(true);
  });

  it("does not fire while the deadline is still far away", () => {
    const result = eivDeadlines({
      eventEndAt: SUMMER_EVENT_END,
      now: SUMMER_EVENT_END,
      alertLeadHours: 48,
    });

    expect(result.needsAlert).toBe(false);
  });

  it("does not fire once nothing can be done about it", () => {
    // Alerting a human about a deadline they can no longer meet is noise. The
    // permanent-failure escalation in P7-07 covers this case instead.
    const result = eivDeadlines({
      eventEndAt: SUMMER_EVENT_END,
      now: new Date("2026-09-30T00:00:00Z"),
    });

    expect(result.needsAlert).toBe(false);
    expect(result.shouldStopRetrying).toBe(true);
  });
});

describe("purity", () => {
  it("returns the same result for the same arguments", () => {
    const args = {
      eventEndAt: SUMMER_EVENT_END,
      now: new Date("2026-08-20T09:00:00Z"),
      firstSubmittedAt: new Date("2026-08-18T09:00:00Z"),
    };

    expect(eivDeadlines(args)).toEqual(eivDeadlines(args));
  });
});

describe("isValidEfn", () => {
  it("accepts exactly 15 digits", () => {
    expect(isValidEfn("123456789012345")).toBe(true);
  });

  it("rejects wrong lengths", () => {
    expect(isValidEfn("12345678901234")).toBe(false);
    expect(isValidEfn("1234567890123456")).toBe(false);
    expect(isValidEfn("")).toBe(false);
  });

  it("rejects non-digits, including padding and separators", () => {
    expect(isValidEfn("12345678901234a")).toBe(false);
    expect(isValidEfn(" 123456789012345")).toBe(false);
    expect(isValidEfn("123456789012345 ")).toBe(false);
    expect(isValidEfn("12345-789012345")).toBe(false);
  });
});

describe("berlin calendar helpers", () => {
  it("adds days across a month boundary", () => {
    expect(addCalendarDays({ year: 2026, month: 1, day: 30 }, 3)).toEqual({
      year: 2026,
      month: 2,
      day: 2,
    });
  });

  it("produces the last millisecond of the Berlin day", () => {
    const endOfDay = endOfBerlinDay({ year: 2026, month: 6, day: 1 });
    expect(endOfDay.toISOString()).toBe("2026-06-01T21:59:59.999Z");
  });
});
