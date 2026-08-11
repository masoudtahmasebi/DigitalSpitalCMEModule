/**
 * Whether a course is being offered right now (P50-01).
 *
 * ## The rule
 *
 * A course may carry a validity period. Outside it the course **is not
 * offered**: it does not appear in the catalogue and nobody new can start it.
 * Both ends are optional, and the ordinary case is that neither is set — a
 * course with no dates is offered indefinitely.
 *
 * ## Why this is in `@ds/domain` and not a `WHERE` clause
 *
 * Because it is asked in four places — the catalogue list, the facet counts,
 * the course detail and the enrolment refusal — and a rule spelled out four
 * times is a rule that will disagree with itself. The catalogue's SQL *also*
 * filters, for the obvious reason that fetching every expired course to discard
 * it in JavaScript is wrong; that filter is defence in depth over this
 * function, exactly as `WHERE customer_id` is over RLS (ADR-0002).
 *
 * ## Why the answer is a state and not a boolean
 *
 * "Not offered" has two causes and they need different words on screen. A
 * course whose window has not opened is coming; one whose window has closed is
 * gone. Telling a physician "this Fortbildung is not available" when it starts
 * on Monday is the kind of correct-and-useless answer CLAUDE.md §9.10 is about.
 *
 * ## The boundaries, stated
 *
 * `validFrom` is **inclusive** and `validTo` is **inclusive of the whole
 * instant given**: a course valid to `2026-10-12T23:59:59Z` is offered at
 * `23:59:59Z` and not at `23:59:59.001Z`. Callers store the end as the last
 * moment of the day the accreditation covers, which is what
 * `12.10.2026` means on a Bescheid.
 *
 * Time is an argument. `@ds/domain` reads no clock (CLAUDE.md §4 invariant 4),
 * and this rule in particular has to be testable at its boundaries without
 * waiting for one.
 */

export type CourseAvailability =
  /** Being offered: in the catalogue, and open to new enrolments. */
  | "available"
  /** The window has not opened yet. */
  | "not_yet"
  /** The window has closed. The course is no longer offered. */
  | "ended";

export interface AvailabilityWindow {
  /** Inclusive. `null` means "offered from the beginning of time". */
  readonly validFrom: Date | null;
  /** Inclusive. `null` means "offered indefinitely". */
  readonly validTo: Date | null;
}

/**
 * Is this course being offered at `now`?
 *
 * `not_yet` wins over `ended` when a window is inverted (`validTo` before
 * `validFrom`), because such a course is offered on no day at all and saying
 * "not yet" of something that will never open is the less wrong of two wrong
 * answers — and `invalidWindow` below is what stops one being saved.
 */
export function courseAvailability(
  window: AvailabilityWindow,
  now: Date,
): CourseAvailability {
  const instant = now.getTime();

  if (window.validFrom !== null && instant < window.validFrom.getTime()) {
    return "not_yet";
  }
  if (window.validTo !== null && instant > window.validTo.getTime()) {
    return "ended";
  }
  return "available";
}

/** Convenience for the common question, so callers do not compare strings. */
export function isCourseOffered(window: AvailabilityWindow, now: Date): boolean {
  return courseAvailability(window, now) === "available";
}

/**
 * Why a window cannot be saved, or `undefined` when it can.
 *
 * Returned rather than thrown so the console can name the field — and written
 * at all because `invalidBrandingFields` was the P41-01 lesson: a validator
 * that exists and is called by nothing lets the save answer "Gespeichert" while
 * dropping the value. `authoring.service.ts` calls this, and
 * `scripts/unused-rules.mjs` will notice if that ever stops being true.
 */
export function invalidAvailabilityWindow(
  window: AvailabilityWindow,
): "validTo_before_validFrom" | undefined {
  if (window.validFrom === null || window.validTo === null) return undefined;
  return window.validTo.getTime() < window.validFrom.getTime()
    ? "validTo_before_validFrom"
    : undefined;
}
