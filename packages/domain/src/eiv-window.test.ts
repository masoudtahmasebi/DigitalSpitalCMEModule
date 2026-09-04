import { describe, expect, it } from "vitest";

import { berlinDate, reportableOn } from "./eiv-window.js";

/** The client's own test event, from `./dsc eiv` on 04.09.2026. */
const BEGINN = new Date("2024-01-14T23:00:00.000Z");
const ENDE = new Date("2024-01-19T23:00:00.000Z");

const on = (iso: string) =>
  reportableOn({ completedAt: new Date(iso), beginn: BEGINN, ende: ENDE });

describe("berlinDate", () => {
  it("is Berlin's calendar day and not UTC's", () => {
    // 23:30Z in January is 00:30 the next day in Berlin (UTC+1). This one case
    // is the reason the function exists.
    expect(berlinDate(new Date("2024-01-19T23:30:00.000Z"))).toBe("2024-01-20");
    expect(berlinDate(new Date("2024-01-19T22:30:00.000Z"))).toBe("2024-01-19");
  });

  it("handles summer time, when the offset is two hours", () => {
    expect(berlinDate(new Date("2026-07-01T22:30:00.000Z"))).toBe("2026-07-02");
    expect(berlinDate(new Date("2026-07-01T21:30:00.000Z"))).toBe("2026-07-01");
  });
});

describe("reportableOn — the register's accredited period", () => {
  // `beginn` is 23:00Z on the 14th, which is the 15th in Berlin. So the first
  // reportable day is the 15th, and reading the instant as a UTC day would put
  // it a day early — a Meldung filed and refused.
  it("accepts a completion inside the period", () => {
    expect(on("2024-01-16T10:00:00.000Z")).toEqual({ ok: true });
  });

  it("accepts the first and last accredited days", () => {
    expect(on("2024-01-15T00:30:00.000Z")).toEqual({ ok: true });
    expect(on("2024-01-20T10:00:00.000Z")).toEqual({ ok: true });
  });

  it("refuses the day before the period opens", () => {
    expect(on("2024-01-14T10:00:00.000Z")).toEqual({
      ok: false,
      reason: "before_period",
    });
  });

  it("refuses the day after it closes", () => {
    expect(on("2024-01-21T10:00:00.000Z")).toEqual({
      ok: false,
      reason: "after_period",
    });
  });

  // The client's actual situation: a completion today against a period that
  // closed in January 2024. This is the case that produces one 406 per
  // physician, for ever, and the whole reason the check exists.
  it("refuses a completion two years after the period closed", () => {
    expect(on("2026-09-04T08:00:00.000Z")).toEqual({
      ok: false,
      reason: "after_period",
    });
  });

  // An unknown period must not read as an accepted one (§9.6).
  it("refuses rather than assuming when the register said nothing", () => {
    expect(
      reportableOn({
        completedAt: new Date("2026-09-04T08:00:00.000Z"),
        beginn: undefined,
        ende: ENDE,
      }),
    ).toEqual({ ok: false, reason: "period_unknown" });
    expect(
      reportableOn({
        completedAt: new Date("2026-09-04T08:00:00.000Z"),
        beginn: BEGINN,
        ende: undefined,
      }),
    ).toEqual({ ok: false, reason: "period_unknown" });
  });

  // A one-day event, which is what S11 records the live VNR as being.
  it("handles a single-day period", () => {
    const day = new Date("2026-03-10T00:00:00.000Z");
    const verdict = (iso: string) =>
      reportableOn({ completedAt: new Date(iso), beginn: day, ende: day });

    expect(verdict("2026-03-10T09:00:00.000Z")).toEqual({ ok: true });
    expect(verdict("2026-03-09T09:00:00.000Z")).toEqual({
      ok: false,
      reason: "before_period",
    });
    expect(verdict("2026-03-11T09:00:00.000Z")).toEqual({
      ok: false,
      reason: "after_period",
    });
  });
});
