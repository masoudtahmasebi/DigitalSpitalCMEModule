/**
 * Which backups to keep, and which to let go (P23-03). Pure.
 *
 * ## Why a policy and not "delete anything older than N days"
 *
 * The failures a backup protects against arrive on two very different clocks.
 * A dropped table, a bad migration, a bad deploy — you find those within hours,
 * and what you want is *yesterday's* copy, and the one before that. Silent
 * corruption, a subtly wrong EIV submission, a compliance question raised by a
 * Kammer — you find those months later, and a flat 30-day window has already
 * deleted the only copy that could answer them.
 *
 * So: everything from the last week, then one per week, then one per month.
 * The cost is a handful of extra objects; the alternative is discovering the
 * relevant copy expired at exactly the moment somebody asks for it.
 *
 * ## Why this is a pure function over key names
 *
 * The bucket is the only record of what exists. Reading a listing and deciding
 * from the names means the decision can be unit-tested exhaustively — including
 * the parts nobody exercises by hand, like a month boundary or a run that
 * happens twice in a day — and the code that actually deletes has no policy in
 * it at all. Deletion is the one operation where a wrong rule is not
 * recoverable, so the rule is where a test can reach it.
 *
 * Time is an argument, as everywhere in this codebase.
 */

/** `backups/database/2026-08-07T02-00-00Z.dump.enc` → the instant it was taken. */
export function backupTakenAt(key: string): Date | undefined {
  const name = key.split("/").at(-1) ?? "";
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})Z\./.exec(name);
  if (match === null) return undefined;

  const [, year, month, day, hour, minute, second] = match;
  const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return undefined;

  // The round-trip is not belt-and-braces. `new Date("2026-02-31T…")` does not
  // fail — it silently rolls forward to 3 March, so a name this code never
  // wrote would parse as a perfectly plausible date and be weighed against a
  // retention window it has nothing to do with. Comparing the parsed value back
  // against the text is the only way to tell.
  return at.toISOString() === iso ? at : undefined;
}

/** The name a backup taken now should have. Sorts lexicographically by time. */
export function backupKey(prefix: string, kind: string, now: Date): string {
  const stamp = now
    .toISOString()
    .replace(/:/g, "-")
    .replace(/\.\d{3}Z$/, "Z");
  return `${prefix}${kind}/${stamp}.dump.enc`;
}

export interface RetentionPolicy {
  /** Keep every backup taken within this many days. */
  readonly dailyDays: number;
  /** Then one per ISO week, for this many weeks. */
  readonly weeklyWeeks: number;
  /** Then one per calendar month, for this many months. */
  readonly monthlyMonths: number;
}

export const DEFAULT_RETENTION: RetentionPolicy = {
  dailyDays: 7,
  weeklyWeeks: 4,
  monthlyMonths: 6,
};

const DAY_MS = 86_400_000;

/** `2026-W32`, so two backups in the same week fall in the same bucket. */
function weekBucket(at: Date): string {
  // Thursday-of-week, the ISO rule: it is the only day guaranteed to be in the
  // same ISO year as the week itself, which is what makes the label unique
  // across a New Year.
  const thursday = new Date(at.getTime());
  thursday.setUTCDate(thursday.getUTCDate() + 3 - ((thursday.getUTCDay() + 6) % 7));
  const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      (thursday.getTime() - firstThursday.getTime()) / (7 * DAY_MS) -
        ((firstThursday.getUTCDay() + 6) % 7) / 7,
    );
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function monthBucket(at: Date): string {
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}`;
}

export interface RetentionDecision {
  readonly keep: readonly string[];
  readonly remove: readonly string[];
  /** Keys whose names this code did not write. Never removed — see below. */
  readonly unrecognised: readonly string[];
}

/**
 * Decide what stays.
 *
 * **An unrecognised key is kept, always.** A listing containing a name this
 * policy cannot parse means either somebody put something in the backup prefix
 * by hand or the naming scheme changed — and in both cases deleting it is the
 * one action that cannot be undone. Reporting it lets an operator look; a
 * deletion would just be a smaller listing next time.
 *
 * The newest backup is kept even when it falls outside every window, because a
 * retention policy that could return "delete everything" is a policy one clock
 * skew away from an empty bucket.
 */
export function applyRetention(
  keys: readonly string[],
  now: Date,
  policy: RetentionPolicy = DEFAULT_RETENTION,
): RetentionDecision {
  const dated: { key: string; at: Date }[] = [];
  const unrecognised: string[] = [];

  for (const key of keys) {
    const at = backupTakenAt(key);
    if (at === undefined) unrecognised.push(key);
    else dated.push({ key, at });
  }

  // Newest first, so "the first one in each bucket" is "the newest in it" —
  // the copy most likely to be complete and the one closest to the boundary.
  dated.sort((a, b) => b.at.getTime() - a.at.getTime());

  const keep = new Set<string>();
  const seenWeeks = new Set<string>();
  const seenMonths = new Set<string>();

  const dailyCutoff = now.getTime() - policy.dailyDays * DAY_MS;
  const weeklyCutoff = now.getTime() - policy.weeklyWeeks * 7 * DAY_MS;
  const monthlyCutoff = now.getTime() - policy.monthlyMonths * 31 * DAY_MS;

  // Always. See above.
  const newest = dated[0];
  if (newest !== undefined) keep.add(newest.key);

  for (const entry of dated) {
    const taken = entry.at.getTime();

    if (taken >= dailyCutoff) {
      keep.add(entry.key);
      // Also claim its week and month, so a daily copy satisfies the coarser
      // windows rather than an extra one being retained beside it.
      seenWeeks.add(weekBucket(entry.at));
      seenMonths.add(monthBucket(entry.at));
      continue;
    }

    if (taken >= weeklyCutoff) {
      const week = weekBucket(entry.at);
      if (!seenWeeks.has(week)) {
        seenWeeks.add(week);
        seenMonths.add(monthBucket(entry.at));
        keep.add(entry.key);
      }
      continue;
    }

    if (taken >= monthlyCutoff) {
      const month = monthBucket(entry.at);
      if (!seenMonths.has(month)) {
        seenMonths.add(month);
        keep.add(entry.key);
      }
    }
  }

  return {
    keep: dated.filter((entry) => keep.has(entry.key)).map((entry) => entry.key),
    remove: dated.filter((entry) => !keep.has(entry.key)).map((entry) => entry.key),
    unrecognised,
  };
}

/**
 * Is there a recent enough backup to believe the job is running?
 *
 * The check that makes the difference between a backup and a belief. A cron
 * that stopped firing three weeks ago looks exactly like one that is working,
 * right up until somebody needs a restore — so this is meant to be run *by
 * something else*, on its own schedule, and to page when it fails.
 */
export function isFresh(
  keys: readonly string[],
  now: Date,
  maxAgeHours: number,
): boolean {
  const newest = keys
    .map(backupTakenAt)
    .filter((at): at is Date => at !== undefined)
    .reduce<number>((latest, at) => Math.max(latest, at.getTime()), 0);

  if (newest === 0) return false;
  return now.getTime() - newest <= maxAgeHours * 3_600_000;
}
