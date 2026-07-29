/**
 * German duration copy.
 *
 * Here rather than in a locale file because two frontends need it — the widget
 * for a course card's metadata line, the portal for the same line on its own
 * catalogue — and a second copy would be a second set of pluralisation rules to
 * get right. It sits beside `berlin.ts`, which is here for the same reason:
 * pure, deterministic, German, and needed by more than one caller.
 *
 * Not a compliance function. Nothing here decides anything; it turns a number
 * of seconds the server computed into words. The number is the server's.
 */

const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_MINUTE = 60;

/**
 * "2 Stunden 30 Minuten" — the long form used on course cards.
 *
 * Whole minutes: the layout never shows seconds here, and rounding a partial
 * minute up would make a 2:00:30 course read as taking longer than it does.
 *
 * Anything under a minute is still a duration. Returning an empty string would
 * drop the part from the metadata line and misalign its separators, so it gets
 * "unter 1 Minute" instead.
 */
export function germanDuration(totalSec: number): string {
  const safe = Number.isFinite(totalSec) && totalSec > 0 ? Math.floor(totalSec) : 0;
  const hours = Math.floor(safe / SECONDS_PER_HOUR);
  const minutes = Math.floor((safe % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);

  const parts = [
    hours === 0 ? undefined : `${hours} ${hours === 1 ? "Stunde" : "Stunden"}`,
    minutes === 0 ? undefined : `${minutes} ${minutes === 1 ? "Minute" : "Minuten"}`,
  ].filter((part): part is string => part !== undefined);

  return parts.length === 0 ? "unter 1 Minute" : parts.join(" ");
}

/** "25:24 Min." — the short form a module list uses. */
export function germanMinutesAndSeconds(totalSec: number): string {
  const safe = Number.isFinite(totalSec) && totalSec > 0 ? Math.floor(totalSec) : 0;
  const minutes = Math.floor(safe / SECONDS_PER_MINUTE);
  const seconds = safe % SECONDS_PER_MINUTE;
  return `${minutes}:${String(seconds).padStart(2, "0")} Min.`;
}

/**
 * "14:35" — a media timeline position, as the player shows it (layout §4.3).
 *
 * Deliberately not `germanMinutesAndSeconds` without its suffix. That one is a
 * *length* and stays in minutes however long it gets, because "90:00 Min." is
 * how a module list states a duration. This one is a *clock reading* beside a
 * scrub bar, and rolls into hours at 3600 s — a player showing "90:00 / 95:00"
 * would be the only clock on the page not behaving like one.
 */
export function clockTime(totalSec: number): string {
  const safe = Number.isFinite(totalSec) && totalSec > 0 ? Math.floor(totalSec) : 0;
  const hours = Math.floor(safe / SECONDS_PER_HOUR);
  const minutes = Math.floor((safe % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const seconds = safe % SECONDS_PER_MINUTE;
  const mm = hours === 0 ? String(minutes) : String(minutes).padStart(2, "0");
  return `${hours === 0 ? "" : `${hours}:`}${mm}:${String(seconds).padStart(2, "0")}`;
}
