/**
 * Will the register accept this Punktemeldung's date? (P184-01)
 *
 * ## The case that earned it
 *
 * The client reached EIV's test system from the production host and the event
 * it described was this:
 *
 *     "beginn":"2024-01-14T23:00:00.000Z","ende":"2024-01-19T23:00:00.000Z"
 *
 * A five-day event, in the past. `eiv.service.ts` sends the learner's
 * completion instant as `teilnahmedatum`, and EIV refuses a date outside the
 * accredited period with **406** — so every Punktemeldung filed for that VNR
 * today is refused, whatever the EFN.
 *
 * Nothing was wrong with the code. What was missing is that the platform had
 * both numbers in its hands — the period from `GET veranstaltung`, the
 * completion from its own row — and never compared them, leaving an operator to
 * do it by eye across two date formats and a time zone. That is §9.2 with the
 * arithmetic left to a person.
 *
 * ## Why a date and not an instant
 *
 * `teilnahmedatum` is `YYYY-MM-DD`; the register compares days, not moments.
 * Comparing instants would refuse a completion at 23:30 Berlin time on the last
 * accredited day, because that is 21:30Z and the period's `ende` arrives as an
 * instant whose own time is an artefact of how the Kammer entered it.
 *
 * **The day is Berlin's, not UTC's**, and that is the whole subtlety: a
 * physician who finishes at 00:30 on the 20th has finished on the 20th, and
 * `2024-01-19T23:30:00Z` is already the 20th in Berlin. Getting this wrong
 * moves a boundary case by one day in the direction that files a report the
 * register refuses.
 */

/** `YYYY-MM-DD` in Europe/Berlin, which is the calendar EIV reports against. */
export function berlinDate(at: Date): string {
  // `en-CA` yields `YYYY-MM-DD`, which is the format EIV wants and the only
  // reason this is not `de-DE`.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

export type ReportableVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "before_period" | "after_period" }
  /**
   * The register did not say. Deliberately distinct from `ok`: an unknown
   * period must not read as an accepted one, which is §9.6's shape — a missing
   * answer indistinguishable from a real one.
   */
  | { readonly ok: false; readonly reason: "period_unknown" };

export function reportableOn(input: {
  /** The learner's completion instant, which becomes `teilnahmedatum`. */
  readonly completedAt: Date;
  /** `beginn` as the register returned it, or undefined when it did not. */
  readonly beginn: Date | undefined;
  /** `ende`, likewise. */
  readonly ende: Date | undefined;
}): ReportableVerdict {
  if (input.beginn === undefined || input.ende === undefined) {
    return { ok: false, reason: "period_unknown" };
  }

  const day = berlinDate(input.completedAt);
  // String comparison is correct and intentional for `YYYY-MM-DD`: it is
  // lexicographically ordered, which is why EIV uses it.
  if (day < berlinDate(input.beginn)) return { ok: false, reason: "before_period" };
  if (day > berlinDate(input.ende)) return { ok: false, reason: "after_period" };
  return { ok: true };
}
