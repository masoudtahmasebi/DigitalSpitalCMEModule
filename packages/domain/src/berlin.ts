/**
 * Calendar arithmetic in Europe/Berlin.
 *
 * EIV deadlines are expressed in **calendar days** ("within 8 days of the event
 * end"), which is not the same as adding 8 × 24 h to an instant. Across a
 * German DST transition those two readings differ by an hour, and for an event
 * ending near midnight that hour moves the deadline onto a different calendar
 * day — turning a compliant submission into a late one, or the reverse.
 *
 * So days are added on the Berlin calendar and only then converted back to an
 * instant. `Intl` is used for the zone rules; it is deterministic given its
 * inputs and reads no clock, so the purity guarantee of this package holds.
 */

const BERLIN = "Europe/Berlin";

const PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: BERLIN,
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export interface BerlinDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/** The Berlin calendar date an instant falls on. */
export function berlinDateOf(instant: Date): BerlinDate {
  const parts = readParts(instant);
  return { year: parts.year, month: parts.month, day: parts.day };
}

/** Add whole calendar days, letting the Date constructor normalise overflow. */
export function addCalendarDays(date: BerlinDate, days: number): BerlinDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/**
 * The last instant of a Berlin calendar day, as UTC.
 *
 * Berlin's offset is itself a function of the instant, so this resolves by
 * applying the offset and re-checking — two passes settle every case including
 * the transition days themselves.
 */
export function endOfBerlinDay(date: BerlinDate): Date {
  const wallClock = Date.UTC(date.year, date.month - 1, date.day, 23, 59, 59, 999);

  let instant = new Date(wallClock - offsetMsAt(new Date(wallClock)));
  instant = new Date(wallClock - offsetMsAt(instant));

  return instant;
}

/** Berlin's UTC offset in milliseconds at a given instant. */
function offsetMsAt(instant: Date): number {
  const parts = readParts(instant);
  // Intl formats to second precision, so the instant's own milliseconds are
  // carried through — otherwise the offset absorbs them and every result lands
  // up to 999 ms late.
  const asIfUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    instant.getUTCMilliseconds(),
  );
  return asIfUtc - instant.getTime();
}

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function readParts(instant: Date): Parts {
  const parsed: Record<string, number> = {};

  for (const part of PARTS.formatToParts(instant)) {
    if (part.type !== "literal") {
      parsed[part.type] = Number(part.value);
    }
  }

  return {
    year: require_(parsed, "year"),
    month: require_(parsed, "month"),
    day: require_(parsed, "day"),
    // Under hour12: false, midnight formats as 24 in some ICU versions. The
    // normalisation applies to the hour alone — applying it to the date fields
    // would corrupt them.
    hour: require_(parsed, "hour") % 24,
    minute: require_(parsed, "minute"),
    second: require_(parsed, "second"),
  };
}

/**
 * Read a formatted part, or refuse.
 *
 * These used to be `?? 0` / `?? 1` defaults. That was the wrong shape for this
 * module: a missing part would have produced the 1st of January in the year 0
 * and carried it into an 8-day statutory deadline, silently. Nobody would have
 * seen a wrong date — they would have seen a rejected Punktemeldung weeks
 * later, with no way to reopen the window.
 *
 * Unreachable with the options `PARTS` is configured with; every `Intl`
 * implementation that supports the locale emits all six. It throws rather than
 * guessing because the alternative to a loud failure here is a quiet wrong
 * answer about a legal deadline.
 */
function require_(parsed: Record<string, number>, key: string): number {
  const value = parsed[key];
  if (value === undefined || !Number.isFinite(value)) {
    throw new BerlinFormatError(key);
  }
  return value;
}

/**
 * `Intl` did not produce a part this module needs.
 *
 * Its own class so a caller can tell "the platform's timezone data is broken"
 * from an ordinary validation failure — they need very different responses.
 */
export class BerlinFormatError extends Error {
  constructor(readonly part: string) {
    super(`Intl.DateTimeFormat produced no "${part}" part for Europe/Berlin`);
    this.name = "BerlinFormatError";
  }
}

// ---------------------------------------------------------------------------
// Presentation
//
// German local time is a presentation concern — everything is stored UTC
// (CLAUDE.md §5) — but *which* presentation is not a free choice. A
// Teilnahmebescheinigung, a CSV export, an admin list and the widget must all
// show the same day for the same instant, because that day is the one the
// Ärztekammer was told about. A physician reading their certificate from
// Vienna must see the German date, not their own rendering of the same moment.
//
// Four files had written this formatter independently, three of them with
// their own comment explaining the timezone. That is three chances for one of
// them to drift, on a value that appears on a legal document.
//
// `Intl` reads no clock — the instant is always an argument — so this belongs
// here for the same reason the calendar arithmetic above does.
// ---------------------------------------------------------------------------

const DATE = new Intl.DateTimeFormat("de-DE", {
  timeZone: BERLIN,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const TIME = new Intl.DateTimeFormat("de-DE", {
  timeZone: BERLIN,
  hour: "2-digit",
  minute: "2-digit",
});

const DATE_TIME = new Intl.DateTimeFormat("de-DE", {
  timeZone: BERLIN,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** `28.07.2026` */
export function formatBerlinDate(instant: Date): string {
  return DATE.format(instant);
}

/** `14:35 Uhr` — the unit included, because a bare `14:35` on a document is a duration. */
export function formatBerlinTime(instant: Date): string {
  return `${TIME.format(instant)} Uhr`;
}

/** `28.07.2026, 14:35` — for tables and exports, where the unit is the column. */
export function formatBerlinDateTime(instant: Date): string {
  return DATE_TIME.format(instant);
}

/**
 * `2026-07-28` — the ISO calendar date, resolved in **Berlin** (P31-01).
 *
 * EIV-FOBI's `teilnahmedatum` is a date without a time, and the authority
 * reading it is German. So the date has to be the one that was on a German
 * calendar at the moment the physician completed, not the one that was on a UTC
 * clock.
 *
 * The difference is a whole day for every completion between 22:00 and midnight
 * UTC in summer — 23:30 UTC on 9 August is already the 10th in Berlin. The API
 * refuses a `teilnahmedatum` outside the accredited event period with a 406, so
 * a completion on the last evening of the window would be rejected as "outside
 * the event" by a client that formatted it in UTC. It is one function precisely
 * so there is one answer.
 */
export function formatBerlinIsoDate(instant: Date): string {
  const { year, month, day } = berlinDateOf(instant);
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

function pad(value: number, width: number): string {
  return value.toString().padStart(width, "0");
}
