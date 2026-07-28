import { describe, expect, it } from "vitest";
import { formatBerlinDate, formatBerlinDateTime, formatBerlinTime } from "./berlin.js";

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
