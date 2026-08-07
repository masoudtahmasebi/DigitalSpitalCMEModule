/**
 * Retention, exhaustively — because deletion is the one operation that cannot
 * be undone, and the only place the rule is reachable by a test is here.
 */

import { describe, expect, it } from "vitest";
import {
  applyRetention,
  backupKey,
  backupTakenAt,
  DEFAULT_RETENTION,
  isFresh,
} from "./retention.js";

const NOW = new Date("2026-08-07T03:00:00.000Z");
const PREFIX = "backups/";

/** A key for a backup taken this many days before NOW, at 02:00 UTC. */
function daysAgo(days: number, hour = 2): string {
  const at = new Date(NOW.getTime() - days * 86_400_000);
  at.setUTCHours(hour, 0, 0, 0);
  return backupKey(PREFIX, "database", at);
}

describe("naming", () => {
  it("round-trips: a key this code writes is a key it can read", () => {
    const key = backupKey(PREFIX, "database", NOW);
    expect(backupTakenAt(key)?.toISOString()).toBe(NOW.toISOString());
  });

  it("sorts lexicographically in the order it was taken", () => {
    // Which is what makes a bucket listing readable without parsing anything,
    // and what makes "the last line" the newest copy.
    const keys = [
      backupKey(PREFIX, "database", new Date("2026-01-02T00:00:00Z")),
      backupKey(PREFIX, "database", new Date("2026-01-10T00:00:00Z")),
      backupKey(PREFIX, "database", new Date("2026-02-01T00:00:00Z")),
    ];
    expect([...keys].sort()).toEqual(keys);
  });

  it("uses no colon, because a key with one is a URL to escape", () => {
    expect(backupKey(PREFIX, "database", NOW)).not.toContain(":");
  });

  for (const [label, key] of [
    ["a name from another scheme", "backups/database/dump-2026-08-07.sql"],
    ["a date that does not exist", "backups/database/2026-02-31T02-00-00Z.dump.enc"],
    ["something entirely else", "backups/database/README"],
    ["an empty name", "backups/database/"],
  ] as const) {
    it(`refuses to read a date out of ${label}`, () => {
      expect(backupTakenAt(key)).toBeUndefined();
    });
  }
});

describe("what is kept", () => {
  it("keeps every backup from the last week", () => {
    const keys = [0, 1, 2, 3, 4, 5, 6].map((days) => daysAgo(days));
    const decision = applyRetention(keys, NOW);

    expect(decision.remove).toEqual([]);
    expect(decision.keep).toHaveLength(7);
  });

  it("thins older ones to one per week", () => {
    // Two a day for five weeks. Everything inside the daily window survives;
    // beyond it, one per week.
    const keys: string[] = [];
    for (let day = 0; day < 35; day += 1) {
      keys.push(daysAgo(day, 2), daysAgo(day, 14));
    }

    const decision = applyRetention(keys, NOW);

    // 14 in the daily window, plus one for each week beyond it.
    expect(decision.keep.length).toBeGreaterThanOrEqual(14);
    expect(decision.keep.length).toBeLessThan(keys.length);
    expect(decision.remove.length).toBeGreaterThan(0);
    expect([...decision.keep, ...decision.remove].sort()).toEqual([...keys].sort());
  });

  it("keeps one per month once the weekly window has passed", () => {
    const keys = [40, 45, 70, 75, 100, 105].map((days) => daysAgo(days));
    const decision = applyRetention(keys, NOW);

    // Three months represented, one copy each.
    const months = new Set(
      decision.keep.map((key) => (backupTakenAt(key) ?? NOW).toISOString().slice(0, 7)),
    );
    expect(decision.keep.length).toBe(months.size);
  });

  it("drops what is older than every window", () => {
    const ancient = daysAgo(400);
    const recent = daysAgo(1);

    expect(applyRetention([ancient, recent], NOW).remove).toEqual([ancient]);
  });

  it("never returns an empty keep set, however old everything is", () => {
    // A policy that can say "delete everything" is one clock skew away from an
    // empty bucket. The newest copy is always kept.
    const decision = applyRetention([daysAgo(900), daysAgo(1000)], NOW);

    expect(decision.keep).toEqual([daysAgo(900)]);
    expect(decision.remove).toEqual([daysAgo(1000)]);
  });

  it("keeps the newest of a bucket, not the oldest", () => {
    // The newest is the copy closest to the boundary and the one most likely to
    // be complete.
    const older = daysAgo(20, 2);
    const newer = daysAgo(20, 22);
    const decision = applyRetention([older, newer], NOW);

    expect(decision.keep).toContain(newer);
    expect(decision.remove).toContain(older);
  });

  it("keeps a name it does not recognise rather than deleting it", () => {
    // Somebody put something here by hand, or the scheme changed. Both are
    // reasons to look, neither is a reason to delete.
    const decision = applyRetention(
      [daysAgo(1), "backups/database/notes.txt", "backups/database/dump.sql"],
      NOW,
    );

    expect(decision.remove).toEqual([]);
    expect(decision.unrecognised).toEqual([
      "backups/database/notes.txt",
      "backups/database/dump.sql",
    ]);
  });

  it("does nothing with an empty bucket", () => {
    expect(applyRetention([], NOW)).toEqual({ keep: [], remove: [], unrecognised: [] });
  });

  it("partitions the input — nothing is lost and nothing is invented", () => {
    const keys = [0, 3, 9, 20, 40, 200].map((days) => daysAgo(days));
    const { keep, remove, unrecognised } = applyRetention(keys, NOW);

    expect([...keep, ...remove, ...unrecognised].sort()).toEqual([...keys].sort());
    expect(new Set([...keep, ...remove]).size).toBe(keep.length + remove.length);
  });

  it("honours a policy other than the default", () => {
    const keys = [1, 3, 5].map((days) => daysAgo(days));
    const strict = applyRetention(keys, NOW, {
      ...DEFAULT_RETENTION,
      dailyDays: 2,
      weeklyWeeks: 0,
      monthlyMonths: 0,
    });

    expect(strict.keep).toEqual([daysAgo(1)]);
    expect(strict.remove).toEqual([daysAgo(3), daysAgo(5)]);
  });

  describe("across New Year, where the week label earns its complexity", () => {
    const newYear = new Date("2027-01-20T03:00:00.000Z");
    const key = (iso: string) => backupKey(PREFIX, "database", new Date(iso));

    it("treats a week that straddles the year as one week", () => {
      // 30 December 2026 is a Wednesday and 2 January 2027 a Saturday: ISO week
      // 2026-W53, both of them. A naive `${year}-${weekOfYear}` label would put
      // them in different buckets and keep a copy it did not need.
      const keys = [key("2026-12-30T02:00:00Z"), key("2027-01-02T02:00:00Z")];
      const decision = applyRetention(keys, newYear);

      expect(decision.keep).toEqual([key("2027-01-02T02:00:00Z")]);
      expect(decision.remove).toEqual([key("2026-12-30T02:00:00Z")]);
    });

    it("keeps one copy from each side of a real week boundary", () => {
      // 2026-W53 and 2027-W01, four days apart.
      const keys = [key("2026-12-30T02:00:00Z"), key("2027-01-05T02:00:00Z")];

      expect(applyRetention(keys, newYear).remove).toEqual([]);
    });
  });
});

describe("freshness — the check that makes it a backup and not a belief", () => {
  it("is satisfied by a recent copy", () => {
    expect(isFresh([daysAgo(0)], NOW, 26)).toBe(true);
  });

  it("fails when the newest copy is too old", () => {
    // What a cron that quietly stopped firing three weeks ago looks like, and
    // the only thing that distinguishes it from one that is working.
    expect(isFresh([daysAgo(21)], NOW, 26)).toBe(false);
  });

  it("fails on an empty bucket rather than reporting success vacuously", () => {
    expect(isFresh([], NOW, 26)).toBe(false);
  });

  it("ignores names it cannot read", () => {
    // A stray file must not be able to satisfy the check on behalf of a backup
    // that was never taken.
    expect(isFresh(["backups/database/notes.txt"], NOW, 26)).toBe(false);
  });

  it("takes the newest, not the first listed", () => {
    expect(isFresh([daysAgo(30), daysAgo(0), daysAgo(60)], NOW, 26)).toBe(true);
  });
});
