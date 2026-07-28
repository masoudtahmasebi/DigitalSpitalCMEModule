import { describe, expect, it } from "vitest";
import { coalesce, WatchTracker } from "./watch-tracker.js";

describe("WatchTracker", () => {
  it("turns continuous playback into one interval", () => {
    const tracker = new WatchTracker();
    for (let t = 0; t <= 10; t += 0.25) tracker.observe(t, true);

    expect(tracker.drain()).toEqual([{ startSec: 0, endSec: 10 }]);
  });

  it("splits at a forward seek instead of claiming the skipped part", () => {
    // The whole point of interval union over max-position: dragging the scrub
    // bar must not credit the part that was dragged past.
    const tracker = new WatchTracker();
    for (let t = 0; t <= 5; t += 0.25) tracker.observe(t, true);
    tracker.observe(300, true); // scrubbed to 5:00
    for (let t = 300; t <= 305; t += 0.25) tracker.observe(t, true);

    expect(tracker.drain()).toEqual([
      { startSec: 0, endSec: 5 },
      { startSec: 300, endSec: 305 },
    ]);
  });

  it("splits at a backward seek", () => {
    const tracker = new WatchTracker();
    for (let t = 10; t <= 15; t += 0.25) tracker.observe(t, true);
    for (let t = 2; t <= 4; t += 0.25) tracker.observe(t, true);

    expect(tracker.drain()).toEqual([
      { startSec: 10, endSec: 15 },
      { startSec: 2, endSec: 4 },
    ]);
  });

  it("tolerates a stalled main thread without calling it a seek", () => {
    // timeupdate can be starved for over a second on a busy page. Treating
    // that as a seek would lose watch time the learner genuinely earned.
    const tracker = new WatchTracker();
    tracker.observe(0, true);
    tracker.observe(1.8, true);
    tracker.observe(2.0, true);

    expect(tracker.drain()).toEqual([{ startSec: 0, endSec: 2 }]);
  });

  it("records nothing while paused", () => {
    const tracker = new WatchTracker();
    tracker.observe(0, false);
    tracker.observe(10, false);
    tracker.observe(20, false);

    expect(tracker.drain()).toEqual([]);
  });

  it("closes the interval when playback pauses", () => {
    const tracker = new WatchTracker();
    for (let t = 0; t <= 3; t += 0.25) tracker.observe(t, true);
    tracker.observe(3, false);
    for (let t = 3; t <= 6; t += 0.25) tracker.observe(t, true);

    expect(tracker.drain()).toEqual([
      { startSec: 0, endSec: 3 },
      { startSec: 3, endSec: 6 },
    ]);
  });

  it("discards a blip too short to be viewing", () => {
    const tracker = new WatchTracker();
    tracker.observe(4, true);
    tracker.observe(4.05, true);

    expect(tracker.drain()).toEqual([]);
  });

  it("ignores a NaN or negative position rather than reporting one", () => {
    // The server would reject these as `not_finite` / `negative`, but sending
    // them at all makes a real client bug look like tampering in the logs.
    const tracker = new WatchTracker();
    tracker.observe(Number.NaN, true);
    tracker.observe(-5, true);
    tracker.observe(0, true);
    tracker.observe(2, true);

    expect(tracker.drain()).toEqual([{ startSec: 0, endSec: 2 }]);
  });

  it("keeps watching across a drain, without double-counting", () => {
    // A periodic flush must not end the learner's viewing session, and must
    // not re-send seconds already reported.
    const tracker = new WatchTracker();
    for (let t = 0; t <= 5; t += 0.25) tracker.observe(t, true);
    expect(tracker.drain()).toEqual([{ startSec: 0, endSec: 5 }]);

    for (let t = 5; t <= 8; t += 0.25) tracker.observe(t, true);
    expect(tracker.drain()).toEqual([{ startSec: 5, endSec: 8 }]);
  });

  it("drains empty when nothing was watched", () => {
    expect(new WatchTracker().drain()).toEqual([]);
    expect(new WatchTracker().hasPending).toBe(false);
  });

  it("reports having something to send once an interval is long enough", () => {
    const tracker = new WatchTracker();
    tracker.observe(0, true);
    expect(tracker.hasPending).toBe(false);

    tracker.observe(1, true);
    expect(tracker.hasPending).toBe(true);
  });
});

describe("coalesce", () => {
  it("merges intervals separated by less than the gap", () => {
    expect(
      coalesce([
        { startSec: 0, endSec: 5 },
        { startSec: 5.2, endSec: 10 },
      ]),
    ).toEqual([{ startSec: 0, endSec: 10 }]);
  });

  it("keeps a genuine hole", () => {
    // A skipped middle must survive to the server, which is what makes the
    // learner's watched percentage less than 100.
    expect(
      coalesce([
        { startSec: 0, endSec: 5 },
        { startSec: 300, endSec: 305 },
      ]),
    ).toEqual([
      { startSec: 0, endSec: 5 },
      { startSec: 300, endSec: 305 },
    ]);
  });

  it("merges out-of-order and overlapping intervals", () => {
    expect(
      coalesce([
        { startSec: 10, endSec: 20 },
        { startSec: 0, endSec: 12 },
      ]),
    ).toEqual([{ startSec: 0, endSec: 20 }]);
  });

  it("keeps a contained interval from extending the outer one", () => {
    expect(
      coalesce([
        { startSec: 0, endSec: 100 },
        { startSec: 10, endSec: 20 },
      ]),
    ).toEqual([{ startSec: 0, endSec: 100 }]);
  });

  it("returns nothing for nothing", () => {
    expect(coalesce([])).toEqual([]);
  });
});
