/**
 * Resuming, and the ceiling on seeking forward.
 *
 * The worked example from the requirement is the first test: leave at 14:35,
 * come back at 14:00.
 */

import { describe, expect, it } from "vitest";
import {
  clampSeek,
  clampSeekToLimit,
  playerSeekLimit,
  resumePosition,
  seekCeiling,
} from "./resume.js";

describe("resumePosition", () => {
  it("rewinds to the start of the containing minute", () => {
    // 14:35 → 14:00, the case the requirement names.
    expect(resumePosition({ lastPositionSec: 875 })).toBe(840);
    expect(resumePosition({ lastPositionSec: 60 })).toBe(60);
    expect(resumePosition({ lastPositionSec: 61 })).toBe(60);
    expect(resumePosition({ lastPositionSec: 119 })).toBe(60);
  });

  it("starts at zero for anything inside the first minute", () => {
    for (const position of [0, 1, 30, 59]) {
      expect(resumePosition({ lastPositionSec: position })).toBe(0);
    }
  });

  it("treats a missing or nonsensical position as the beginning", () => {
    expect(resumePosition({ lastPositionSec: -1 })).toBe(0);
    expect(resumePosition({ lastPositionSec: Number.NaN })).toBe(0);
    expect(resumePosition({ lastPositionSec: Number.POSITIVE_INFINITY })).toBe(0);
  });

  it("does not resume past the end when the duration was corrected downwards", () => {
    // A stored position beyond the duration means the video's length changed
    // after the fact. Resuming past the end presents as a player that will not
    // start, so it falls back to the last whole minute that exists.
    expect(resumePosition({ lastPositionSec: 900, durationSec: 620 })).toBe(600);
    expect(resumePosition({ lastPositionSec: 900, durationSec: 30 })).toBe(0);
  });

  it("resumes at the last whole minute of a video watched to the end", () => {
    // 25:45 long, watched to the end: 25:00 rather than 25:45, where there is
    // nothing left to play.
    expect(resumePosition({ lastPositionSec: 1545, durationSec: 1545 })).toBe(1500);
  });

  it("ignores a duration it cannot use", () => {
    expect(resumePosition({ lastPositionSec: 875, durationSec: null })).toBe(840);
    expect(resumePosition({ lastPositionSec: 875, durationSec: undefined })).toBe(840);
  });
});

describe("seeking forward", () => {
  const watched = [{ startSec: 0, endSec: 300 }];

  it("cannot pass the furthest point actually watched", () => {
    // Dragging to the end of a 25-minute video after watching five minutes
    // lands at five minutes, not at the end.
    expect(clampSeek(1545, watched)).toBe(305);
    expect(seekCeiling(watched)).toBe(305);
  });

  it("allows seeking backwards without restriction", () => {
    // Re-watching is legitimate and free: coverage is a union, so a second
    // viewing of the same seconds cannot inflate the percentage.
    expect(clampSeek(0, watched)).toBe(0);
    expect(clampSeek(120, watched)).toBe(120);
  });

  it("pins a learner who has watched nothing to the start", () => {
    expect(clampSeek(600, [])).toBe(5);
    expect(clampSeek(0, [])).toBe(0);
  });

  it("takes the end of the union, not the end of the last reported segment", () => {
    // Out of order and overlapping, which is what a real session produces.
    const messy = [
      { startSec: 120, endSec: 200 },
      { startSec: 0, endSec: 130 },
      { startSec: 190, endSec: 240 },
    ];
    expect(seekCeiling(messy, 0)).toBe(240);
  });

  it("refuses a target that is not a position", () => {
    expect(clampSeek(-10, watched)).toBe(0);
    expect(clampSeek(Number.NaN, watched)).toBe(0);
  });
});

describe("clampSeekToLimit", () => {
  it("stops at the limit and leaves anything below it alone", () => {
    expect(clampSeekToLimit(1545, 305)).toBe(305);
    expect(clampSeekToLimit(120, 305)).toBe(120);
    expect(clampSeekToLimit(305, 305)).toBe(305);
  });

  it("treats a non-finite limit as no limit", () => {
    // A missing ceiling leaves the controls working. The gate is the union of
    // reported intervals, computed on the server; locking the player because a
    // field went missing would cost every learner and buy no compliance.
    expect(clampSeekToLimit(1545, Number.POSITIVE_INFINITY)).toBe(1545);
    expect(clampSeekToLimit(1545, Number.NaN)).toBe(1545);
  });

  it("never lands before the start", () => {
    expect(clampSeekToLimit(-10, 305)).toBe(0);
    expect(clampSeekToLimit(Number.NaN, 305)).toBe(0);
    expect(clampSeekToLimit(100, -5)).toBe(0);
  });
});

describe("playerSeekLimit", () => {
  it("takes whichever is further, the server's ceiling or this session", () => {
    // Mid-flush: the server credited up to 5:00, the learner has played on to
    // 5:12. Enforcing the stale ceiling would drag a playing video backwards.
    expect(playerSeekLimit(305, 312)).toBe(312);
    expect(playerSeekLimit(305, 100)).toBe(305);
  });

  it("is unlimited when the server sent no ceiling", () => {
    expect(playerSeekLimit(null, 0)).toBe(Number.POSITIVE_INFINITY);
    expect(playerSeekLimit(undefined, 0)).toBe(Number.POSITIVE_INFINITY);
    expect(playerSeekLimit(Number.NaN, 0)).toBe(Number.POSITIVE_INFINITY);
  });

  it("ignores a reached position that is not a position", () => {
    expect(playerSeekLimit(305, Number.NaN)).toBe(305);
    expect(playerSeekLimit(305, -100)).toBe(305);
  });

  it("pins a learner who has watched nothing to the start of the video", () => {
    expect(playerSeekLimit(0, 0)).toBe(0);
  });
});
