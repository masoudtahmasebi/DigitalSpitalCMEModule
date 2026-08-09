import { describe, expect, it } from "vitest";
import {
  addCalendarDays,
  berlinDateOf,
  endOfBerlinDay,
  formatBerlinDate,
  formatBerlinDateTime,
  formatBerlinIsoDate,
  formatBerlinTime,
  BerlinFormatError,
} from "./berlin.js";

describe("German presentation", () => {
  // 23:30 UTC on 27 July is already the 28th in Berlin (CEST, +02:00). Every
  // surface that shows this instant — certificate, CSV, admin list, widget —
  // has to agree on which day it was, because that is the day the Ärztekammer
  // was told about.
  const lateJuly = new Date("2026-07-27T23:30:00Z");

  it("renders the Berlin calendar day, not UTC's", () => {
    expect(formatBerlinDate(lateJuly)).toBe("28.07.2026");
  });

  it("renders the Berlin wall clock with its unit", () => {
    expect(formatBerlinTime(lateJuly)).toBe("01:30 Uhr");
  });

  it("renders both together for tables and exports", () => {
    expect(formatBerlinDateTime(lateJuly)).toBe("28.07.2026, 01:30");
  });

  it("follows the DST transition rather than a fixed offset", () => {
    // Winter is +01:00, summer +02:00. A hard-coded offset gets one of these
    // wrong, and gets it wrong on a date near a deadline.
    const january = new Date("2026-01-15T23:30:00Z");
    expect(formatBerlinDate(january)).toBe("16.01.2026");
    expect(formatBerlinTime(january)).toBe("00:30 Uhr");
  });
});

/**
 * The date arithmetic behind every deadline.
 *
 * These three functions were covered only *through* `eivDeadlines` before the
 * best-practices audit, which is the wrong altitude for them: they decide which
 * calendar day an 8-day statutory reporting window closes on, and the way to
 * get that wrong by a day is a DST transition or a month boundary — neither of
 * which a test written about deadlines naturally reaches for.
 *
 * A day late on a Punktemeldung cannot be taken back: past the window,
 * electronic submission is impossible and the only remaining route is the
 * paper Anwesenheitsliste in §2 of the Bescheid.
 */
describe("berlinDateOf", () => {
  it("reads the Berlin calendar day, not UTC's", () => {
    // 22:00 UTC on 27 July is already the 28th in Berlin (CEST, +02:00).
    expect(berlinDateOf(new Date("2026-07-27T22:00:00Z"))).toEqual({
      year: 2026,
      month: 7,
      day: 28,
    });
  });

  it("reads the previous day when Berlin is still on it", () => {
    // 00:30 UTC on 28 July is 02:30 on the 28th in Berlin — same day. But
    // 22:30 UTC on 27 December is 23:30 on the 27th (CET, +01:00), not the 28th.
    expect(berlinDateOf(new Date("2026-12-27T22:30:00Z"))).toEqual({
      year: 2026,
      month: 12,
      day: 27,
    });
  });

  it("handles midnight, which some ICU versions format as hour 24", () => {
    expect(berlinDateOf(new Date("2026-07-27T22:00:00Z"))).toEqual({
      year: 2026,
      month: 7,
      day: 28,
    });
  });
});

describe("addCalendarDays", () => {
  it("adds days within a month", () => {
    expect(addCalendarDays({ year: 2026, month: 7, day: 1 }, 8)).toEqual({
      year: 2026,
      month: 7,
      day: 9,
    });
  });

  it("rolls over a month boundary", () => {
    expect(addCalendarDays({ year: 2026, month: 7, day: 28 }, 8)).toEqual({
      year: 2026,
      month: 8,
      day: 5,
    });
  });

  it("rolls over a year boundary", () => {
    expect(addCalendarDays({ year: 2026, month: 12, day: 28 }, 8)).toEqual({
      year: 2027,
      month: 1,
      day: 5,
    });
  });

  it("handles February in a leap year", () => {
    expect(addCalendarDays({ year: 2028, month: 2, day: 26 }, 8)).toEqual({
      year: 2028,
      month: 3,
      day: 5,
    });
  });

  it("handles February in a non-leap year", () => {
    expect(addCalendarDays({ year: 2026, month: 2, day: 26 }, 8)).toEqual({
      year: 2026,
      month: 3,
      day: 6,
    });
  });

  it("crosses the spring DST transition without losing a day", () => {
    // 29 March 2026 is a 23-hour day in Berlin. Calendar arithmetic must not
    // notice: eight days after the 25th is the 2nd, DST or no DST.
    expect(addCalendarDays({ year: 2026, month: 3, day: 25 }, 8)).toEqual({
      year: 2026,
      month: 4,
      day: 2,
    });
  });
});

describe("endOfBerlinDay", () => {
  it("is 21:59:59.999 UTC in summer (CEST, +02:00)", () => {
    expect(endOfBerlinDay({ year: 2026, month: 7, day: 28 }).toISOString()).toBe(
      "2026-07-28T21:59:59.999Z",
    );
  });

  it("is 22:59:59.999 UTC in winter (CET, +01:00)", () => {
    expect(endOfBerlinDay({ year: 2026, month: 12, day: 28 }).toISOString()).toBe(
      "2026-12-28T22:59:59.999Z",
    );
  });

  it("resolves the spring-forward day, which has only 23 hours", () => {
    // 29 March 2026: clocks go 02:00 → 03:00. The day still *ends* at 23:59:59
    // wall clock, and by then Berlin is on CEST.
    expect(endOfBerlinDay({ year: 2026, month: 3, day: 29 }).toISOString()).toBe(
      "2026-03-29T21:59:59.999Z",
    );
  });

  it("resolves the autumn fall-back day, which has 25 hours", () => {
    // 25 October 2026: clocks go 03:00 → 02:00. By 23:59:59 Berlin is on CET.
    expect(endOfBerlinDay({ year: 2026, month: 10, day: 25 }).toISOString()).toBe(
      "2026-10-25T22:59:59.999Z",
    );
  });

  it("keeps the millisecond precision, so a deadline is not 999 ms early", () => {
    // `Intl` formats to whole seconds, so a naive offset calculation absorbs
    // the milliseconds and lands every deadline just inside the previous
    // second — which on the last day of a window is a rejected submission.
    const end = endOfBerlinDay({ year: 2026, month: 7, day: 28 });
    expect(end.getUTCMilliseconds()).toBe(999);
  });

  it("round-trips: the end of a day is still that day in Berlin", () => {
    for (const date of [
      { year: 2026, month: 3, day: 29 },
      { year: 2026, month: 10, day: 25 },
      { year: 2026, month: 12, day: 31 },
      { year: 2028, month: 2, day: 29 },
    ]) {
      expect(berlinDateOf(endOfBerlinDay(date))).toEqual(date);
    }
  });
});

describe("BerlinFormatError", () => {
  it("is a distinguishable error, not a silently wrong date", () => {
    // What this replaced was `?? 0` / `?? 1` defaults, which would have produced
    // the 1st of January in the year 0 and carried it into an 8-day statutory
    // deadline. Nobody would have seen a wrong date — they would have seen a
    // rejected Punktemeldung weeks later, past the window that cannot reopen.
    //
    // The throw itself is unreachable with the options `PARTS` is built with,
    // and provoking it would mean stubbing a global the module captured at
    // import time. What is worth pinning is the error's shape, because a caller
    // branching on it needs to tell "the platform's timezone data is broken"
    // from an ordinary validation failure.
    const error = new BerlinFormatError("month");

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("BerlinFormatError");
    expect(error.part).toBe("month");
    expect(error.message).toContain("Europe/Berlin");
  });
});

describe("formatBerlinIsoDate — EIV's teilnahmedatum (P31-01)", () => {
  it("pads to a fixed width, because the field is a string", () => {
    expect(formatBerlinIsoDate(new Date("2026-03-05T12:00:00Z"))).toBe("2026-03-05");
  });

  it("gives the Berlin date, not the UTC one, late in the evening", () => {
    /*
     * The case that matters. 22:30 UTC on 9 August is already 10 August in
     * Berlin (CEST, +02:00). EIV refuses a teilnahmedatum outside the
     * accredited event period with a 406, so a physician completing on the last
     * evening of the window would have been reported against the *next* day and
     * rejected — the points lost to a timezone.
     */
    expect(formatBerlinIsoDate(new Date("2026-08-09T22:30:00Z"))).toBe("2026-08-10");
  });

  it("gives the Berlin date late in the evening in winter too", () => {
    // CET, +01:00 — so the boundary sits an hour later than in summer, and
    // 22:30 UTC is still the same day.
    expect(formatBerlinIsoDate(new Date("2026-01-09T22:30:00Z"))).toBe("2026-01-09");
    expect(formatBerlinIsoDate(new Date("2026-01-09T23:30:00Z"))).toBe("2026-01-10");
  });

  it("agrees with berlinDateOf, which the deadline clock uses", () => {
    // Two readings of "which day is it in Berlin" that disagreed would put the
    // reported date and the 8-day deadline on different days.
    for (const iso of [
      "2026-03-29T00:30:00Z", // the spring-forward night
      "2026-10-25T00:30:00Z", // the autumn-back night
      "2026-12-31T23:00:00Z", // a year boundary
    ]) {
      const instant = new Date(iso);
      const { year, month, day } = berlinDateOf(instant);
      const expected = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      expect(formatBerlinIsoDate(instant)).toBe(expected);
    }
  });
});
