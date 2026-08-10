import { describe, expect, it } from "vitest";
import { alertLevelFor, dueAlerts, type EivAlertCandidate } from "./eiv-alert.js";

const NOW = new Date("2026-07-28T10:00:00Z");

/** `hours` from now. Negative is in the past. */
function due(hours: number): Date {
  return new Date(NOW.getTime() + hours * 60 * 60 * 1000);
}

function candidate(
  hours: number,
  alreadyAlerted: EivAlertCandidate["alreadyAlerted"] = [],
): EivAlertCandidate {
  return {
    enrolmentId: `e-${hours}`,
    reportDueAt: due(hours),
    alreadyAlerted,
    willNotRetry: false,
  };
}

/** The same, for a submission the worker has abandoned. */
function stopped(
  hours: number,
  alreadyAlerted: EivAlertCandidate["alreadyAlerted"] = [],
): EivAlertCandidate {
  return { ...candidate(hours, alreadyAlerted), willNotRetry: true };
}

describe("alertLevelFor", () => {
  it("says nothing about a submission with days to run", () => {
    // Most of the 8-day window is quiet on purpose. An alert on day one is an
    // alert about the queue working normally.
    expect(alertLevelFor(due(120), NOW)).toBeUndefined();
    expect(alertLevelFor(due(49), NOW)).toBeUndefined();
  });

  it("warns at 48 hours, which survives a weekend", () => {
    expect(alertLevelFor(due(48), NOW)).toBe("warning");
    expect(alertLevelFor(due(24), NOW)).toBe("warning");
    expect(alertLevelFor(due(13), NOW)).toBe("warning");
  });

  it("escalates at 12 hours, the last point the paper fallback fits a working day", () => {
    expect(alertLevelFor(due(12), NOW)).toBe("urgent");
    expect(alertLevelFor(due(1), NOW)).toBe("urgent");
  });

  it("reports a missed deadline rather than going quiet", () => {
    // Nothing can be done at this point. The alert is the record that it
    // happened — the failure mode this whole queue exists to prevent is the
    // one nobody hears about.
    expect(alertLevelFor(due(0), NOW)).toBe("overdue");
    expect(alertLevelFor(due(-1), NOW)).toBe("overdue");
    expect(alertLevelFor(due(-500), NOW)).toBe("overdue");
  });
});

describe("dueAlerts escalates rather than repeats", () => {
  it("raises each level exactly once", () => {
    const first = dueAlerts([candidate(24)], NOW);
    expect(first).toHaveLength(1);
    expect(first[0]?.level).toBe("warning");

    // Same submission, same level, next sweep: silence. An alert that repeats
    // every sweep is one somebody mutes, and a muted alert is worse than none
    // because it is believed to be working.
    expect(dueAlerts([candidate(24, ["warning"])], NOW)).toEqual([]);
  });

  it("fires again when the submission crosses into a higher level", () => {
    const alerts = dueAlerts([candidate(6, ["warning"])], NOW);

    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.level).toBe("urgent");
  });

  it("does not re-raise a level after a higher one has been sent", () => {
    expect(dueAlerts([candidate(6, ["warning", "urgent"])], NOW)).toEqual([]);
  });

  it("still reports overdue for a submission that was alerted all the way down", () => {
    const alerts = dueAlerts([candidate(-3, ["warning", "urgent"])], NOW);

    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.level).toBe("overdue");
    // Negative hours: the payload says how late, not how long is left.
    expect(alerts[0]?.hoursRemaining).toBe(-3);
  });

  it("reports the remaining hours, truncated toward zero", () => {
    // 23.5 hours left is "23 hours", never "24" — an alert must not round in
    // the direction that makes a deadline look further away than it is.
    const alerts = dueAlerts(
      [
        {
          enrolmentId: "e",
          reportDueAt: due(23.5),
          alreadyAlerted: [],
          willNotRetry: false,
        },
      ],
      NOW,
    );

    expect(alerts[0]?.hoursRemaining).toBe(23);
  });

  it("handles a batch, skipping the ones with time to spare", () => {
    const alerts = dueAlerts(
      [candidate(200), candidate(30), candidate(2), candidate(-8)],
      NOW,
    );

    expect(alerts.map((alert) => alert.level)).toEqual(["warning", "urgent", "overdue"]);
  });

  it("raises blocked on day one, six days before the clock would say anything", () => {
    // The whole point. A row abandoned `missing_vnr_password` with 190 hours
    // left is silent under the clock rule until 48 — and it was never going to
    // fix itself in between.
    const alerts = dueAlerts([stopped(190)], NOW);

    expect(alerts.map((alert) => alert.level)).toEqual(["blocked"]);
    expect(alerts[0]?.hoursRemaining).toBe(190);
  });

  it("raises blocked once, not on every sweep", () => {
    expect(dueAlerts([stopped(190, ["blocked"])], NOW)).toEqual([]);
  });

  it("still escalates on the clock after blocked, because nobody may have acted", () => {
    // "This stopped" and "this stopped and there are twelve hours left" are
    // different messages, and the second is not implied by the first.
    expect(dueAlerts([stopped(10, ["blocked"])], NOW).map((a) => a.level)).toEqual([
      "urgent",
    ]);
  });

  it("raises both at once when a submission is abandoned inside the window", () => {
    const alerts = dueAlerts([stopped(30)], NOW);

    // blocked first: it is the one that says what to do.
    expect(alerts.map((alert) => alert.level)).toEqual(["blocked", "warning"]);
  });

  it("leaves a retrying submission alone until the clock says otherwise", () => {
    // The distinction the level exists for. Same deadline, same everything —
    // one is still being worked on.
    expect(dueAlerts([candidate(190)], NOW)).toEqual([]);
  });

  it("carries no personal data — only the enrolment id", () => {
    // The payload goes to a webhook, which may be a chat room. ADR-0004: no
    // EFN, no name, and here not even a course title.
    const alerts = dueAlerts([candidate(1)], NOW);

    expect(Object.keys(alerts[0] ?? {}).sort()).toEqual([
      "enrolmentId",
      "hoursRemaining",
      "level",
    ]);
  });
});
