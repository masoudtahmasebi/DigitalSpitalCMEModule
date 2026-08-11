/**
 * The validity window, at its boundaries (P50-01).
 *
 * Boundary cases are the whole content of this file. "Offered until the 12th"
 * is a sentence about a day and the code compares instants, and every off-by-one
 * here is a physician either locked out of a course that is still running or
 * completing one whose accreditation has lapsed — the second of which the
 * Ärztekammer will refuse with a 406 long after the learner has finished.
 */

import { describe, expect, it } from "vitest";
import {
  courseAvailability,
  invalidAvailabilityWindow,
  isCourseOffered,
} from "./availability.js";

const FROM = new Date("2025-10-13T00:00:00.000Z");
const TO = new Date("2026-10-12T23:59:59.999Z");
const OPEN = { validFrom: FROM, validTo: TO };

describe("courseAvailability", () => {
  it("offers a course with no window at all — the ordinary case", () => {
    // Validity is optional. Most courses never set it, and they must not
    // silently vanish because a null compared badly.
    expect(
      courseAvailability({ validFrom: null, validTo: null }, new Date("2050-01-01Z")),
    ).toBe("available");
  });

  it("offers a course from the first instant of its window", () => {
    expect(courseAvailability(OPEN, FROM)).toBe("available");
  });

  it("does not offer it one millisecond before", () => {
    expect(courseAvailability(OPEN, new Date(FROM.getTime() - 1))).toBe("not_yet");
  });

  it("still offers it at the last instant of its window", () => {
    // 12.10.2026 on the Bescheid means the whole of that day.
    expect(courseAvailability(OPEN, TO)).toBe("available");
  });

  it("stops offering it one millisecond after", () => {
    expect(courseAvailability(OPEN, new Date(TO.getTime() + 1))).toBe("ended");
  });

  it("distinguishes not-yet from ended, because the words differ", () => {
    // "Available from 3 November" and "no longer available" are different
    // messages to a physician; a boolean cannot tell them apart (§9.10).
    expect(courseAvailability(OPEN, new Date("2024-01-01Z"))).toBe("not_yet");
    expect(courseAvailability(OPEN, new Date("2030-01-01Z"))).toBe("ended");
  });

  it("honours an open-ended start", () => {
    const w = { validFrom: null, validTo: TO };
    expect(courseAvailability(w, new Date("1999-01-01Z"))).toBe("available");
    expect(courseAvailability(w, new Date(TO.getTime() + 1))).toBe("ended");
  });

  it("honours an open-ended finish", () => {
    const w = { validFrom: FROM, validTo: null };
    expect(courseAvailability(w, new Date(FROM.getTime() - 1))).toBe("not_yet");
    expect(courseAvailability(w, new Date("2099-01-01Z"))).toBe("available");
  });

  it("calls an inverted window not_yet rather than pretending it is open", () => {
    // Cannot be saved through the console — `invalidAvailabilityWindow` refuses
    // it — but a row written before that check existed must not read as open.
    expect(courseAvailability({ validFrom: TO, validTo: FROM }, FROM)).toBe("not_yet");
  });
});

describe("isCourseOffered", () => {
  it("is true only for available", () => {
    expect(isCourseOffered(OPEN, FROM)).toBe(true);
    expect(isCourseOffered(OPEN, new Date(TO.getTime() + 1))).toBe(false);
    expect(isCourseOffered(OPEN, new Date(FROM.getTime() - 1))).toBe(false);
  });
});

describe("invalidAvailabilityWindow", () => {
  it("accepts a window that runs forwards", () => {
    expect(invalidAvailabilityWindow(OPEN)).toBeUndefined();
  });

  it("accepts a single-instant window", () => {
    expect(invalidAvailabilityWindow({ validFrom: FROM, validTo: FROM })).toBeUndefined();
  });

  it("accepts either end being absent", () => {
    expect(invalidAvailabilityWindow({ validFrom: FROM, validTo: null })).toBeUndefined();
    expect(invalidAvailabilityWindow({ validFrom: null, validTo: TO })).toBeUndefined();
    expect(invalidAvailabilityWindow({ validFrom: null, validTo: null })).toBeUndefined();
  });

  it("rejects a window that runs backwards, naming the field", () => {
    expect(invalidAvailabilityWindow({ validFrom: TO, validTo: FROM })).toBe(
      "validTo_before_validFrom",
    );
  });
});
