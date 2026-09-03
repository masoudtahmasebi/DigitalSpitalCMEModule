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

/**
 * The defect that made a 100 % watch gate unreachable (P29-01).
 *
 * Found by playing a real 25 s video end to end in a real browser: the server
 * credited 97 %. Three sub-second losses compounded — the head before the first
 * `timeupdate`, the tail after the last one, and a quarter of a second at every
 * flush — and the course required 100 %.
 *
 * These cases are written in the units the bug actually occurred in: a
 * `timeupdate` roughly every 0.26 s, which is what Chromium does.
 */
describe("continuity across a close", () => {
  /** One `timeupdate` step, as Chromium emits them. */
  const STEP = 0.26;

  function play(tracker: WatchTracker, from: number, to: number): number {
    let at = from;
    while (at < to) {
      at = Math.min(at + STEP, to);
      tracker.observe(at, true);
    }
    return at;
  }

  it("resumes from where the last interval ended, not from the next sample", () => {
    const tracker = new WatchTracker();
    tracker.observe(0, true); // the `play` event, at the true start
    play(tracker, 0, 12);
    const first = tracker.drain();
    expect(first).toEqual([{ startSec: 0, endSec: 12 }]);

    // Playback continued; the next sample lands one step later.
    play(tracker, 12, 25);
    tracker.closeOpen();
    const second = tracker.drain();

    // Contiguous with the first, so the union is the whole video. Before the
    // fix this began at 12.26 and the gap was permanent.
    expect(second).toEqual([{ startSec: 12, endSec: 25 }]);
  });

  it("gives a whole-video watch the whole video, across flushes", () => {
    const tracker = new WatchTracker();
    const all: { startSec: number; endSec: number }[] = [];

    tracker.observe(0, true); // the `play` event, at the true start
    let at = 0;
    // Flushes at 8 s and 16 s, then a last one 0.1 s before the end — the
    // window that used to delete the tail as noise.
    for (const mark of [8, 16, 24.9]) {
      at = play(tracker, at, mark);
      all.push(...tracker.drain());
    }
    at = play(tracker, at, 24.96);
    tracker.observe(25, true); // the `pause`/`ended` observation
    tracker.closeOpen();
    all.push(...tracker.drain());

    const covered = coalesce(all).reduce((sum, s) => sum + (s.endSec - s.startSec), 0);
    // Every second of it. Not 24.4, which is what four dropped boundaries and
    // a discarded tail came to — and which floors to 97 %.
    expect(covered).toBeCloseTo(25, 5);
  });

  it("does not bridge a seek", () => {
    const tracker = new WatchTracker();
    tracker.observe(0, true);
    play(tracker, 0, 5);
    tracker.closeOpen();
    tracker.drain();

    // Jumped forward 60 s. Continuity must not manufacture the gap.
    tracker.observe(65, true);
    play(tracker, 65, 70);
    tracker.closeOpen();

    expect(tracker.drain()).toEqual([{ startSec: 65, endSec: 70 }]);
  });

  it("does not bridge a rewind", () => {
    const tracker = new WatchTracker();
    tracker.observe(10, true);
    play(tracker, 10, 15);
    tracker.closeOpen();
    tracker.drain();

    // Back to 14 — inside the tolerance in magnitude, but backwards. Starting
    // the new interval at 15 would end it before it began.
    tracker.observe(14, true);
    play(tracker, 14, 20);
    tracker.closeOpen();

    expect(tracker.drain()).toEqual([{ startSec: 14, endSec: 20 }]);
  });

  it("does not bridge a pause longer than one playback step", () => {
    // A learner who pauses at 5 and drags to 5.5 before resuming has not
    // watched 5 → 5.5. The tolerance is a sampling allowance, not a gift.
    const tracker = new WatchTracker();
    tracker.observe(0, true);
    play(tracker, 0, 5);
    tracker.observe(5, false);
    tracker.drain();

    tracker.observe(8, true);
    play(tracker, 8, 10);
    tracker.closeOpen();

    expect(tracker.drain()).toEqual([{ startSec: 8, endSec: 10 }]);
  });

  it("continues across a pause the learner resumed from the same second", () => {
    const tracker = new WatchTracker();
    tracker.observe(0, true);
    play(tracker, 0, 5);
    tracker.observe(5, false); // pause
    tracker.drain();

    tracker.observe(5, true); // resume, same position
    play(tracker, 5, 10);
    tracker.closeOpen();

    expect(tracker.drain()).toEqual([{ startSec: 5, endSec: 10 }]);
  });
});

describe("a stalled sample at the rates the player offers (P153-02)", () => {
  /*
   * `timeupdate` is throttled by every browser — a background tab, a GC pause,
   * a slow frame. When two samples land more than the continuity bound apart,
   * the tracker reads a seek and the media between them is never recorded.
   *
   * The bound is in media seconds, so playback rate decides how much real time
   * it is worth: two seconds at 1×, one second at 2×. A physician watching
   * faster loses more, which is the opposite of what the speed control
   * promises.
   */
  it("keeps a span across a 3-second advance at 2×, where the stall was 1.5 s", () => {
    const tracker = new WatchTracker();
    tracker.observe(100, true, 2);
    tracker.observe(101, true, 2);
    tracker.observe(104, true, 2); // one throttled tick: 3 media s, 1.5 real s
    tracker.observe(105, true, 2);
    tracker.closeOpen();

    expect(
      tracker.drain(),
      "the span across a throttled sample was discarded — the learner watched it",
    ).toEqual([{ startSec: 100, endSec: 105 }]);
  });

  it("still reads a real forward seek as a seek, at every rate", () => {
    const tracker = new WatchTracker();
    tracker.observe(100, true, 2);
    tracker.observe(101, true, 2);
    tracker.observe(400, true, 2); // dragging the scrub bar
    tracker.observe(401, true, 2);
    tracker.closeOpen();

    expect(tracker.drain()).toEqual([
      { startSec: 100, endSec: 101 },
      { startSec: 400, endSec: 401 },
    ]);
  });

  it("does not let a tampered rate widen the bound past the server's cap", () => {
    const tracker = new WatchTracker();
    tracker.observe(100, true, 1000);
    tracker.observe(110, true, 1000); // 10 media s is a seek at any real rate
    tracker.closeOpen();

    // Both intervals are zero-length and dropped as noise, which is the point:
    // the jump was read as a seek even though the client claimed 1000×.
    expect(tracker.drain()).toEqual([]);
  });
});

describe("intervals survive a failed request (P154-02)", () => {
  /*
   * `drain()` empties the buffer unconditionally, so before `restore` a failed
   * POST discarded exactly the seconds a physician watched during the outage —
   * silently, under "Ihr Fortschritt wird automatisch gespeichert".
   */
  it("hands drained intervals back when the request that carried them failed", () => {
    const tracker = new WatchTracker();
    // Continuous samples: a jump wider than the continuity bound is a seek.
    for (const at of [0, 2, 4, 6, 8, 10]) tracker.observe(at, true);
    tracker.closeOpen();

    const carried = tracker.drain();
    expect(carried).toEqual([{ startSec: 0, endSec: 10 }]);
    expect(tracker.hasPending, "drain left something behind").toBe(false);

    tracker.restore(carried); // the POST threw

    expect(tracker.hasPending).toBe(true);
    expect(
      tracker.drain(),
      "the intervals the failed request carried were not offered again",
    ).toEqual([{ startSec: 0, endSec: 10 }]);
  });

  it("keeps restored intervals ahead of what was watched since", () => {
    const tracker = new WatchTracker();
    for (const at of [0, 2, 4, 6, 8, 10]) tracker.observe(at, true);
    tracker.closeOpen();
    const carried = tracker.drain();

    // watching continued while the request was failing
    for (const at of [10, 12, 14, 16, 18, 20]) tracker.observe(at, true);
    tracker.closeOpen();

    tracker.restore(carried);

    expect(tracker.drain()).toEqual([
      { startSec: 0, endSec: 10 },
      { startSec: 10, endSec: 20 },
    ]);
  });

  it("is a no-op for an empty restore", () => {
    const tracker = new WatchTracker();
    tracker.restore([]);
    expect(tracker.hasPending).toBe(false);
  });
});

/*
 * P166-01. A backgrounded tab is not a seek.
 *
 * The client, for the fourth time in this project: *"i also let the video be
 * played and i did my own stuff, and then i get this again: Diese Stellen
 * fehlen noch: 6:20–7:50."* Ninety seconds, in the middle of a video that had
 * played from end to end.
 *
 * `timeupdate` fires about four times a second while the tab is in front.
 * Backgrounded, Chrome throttles the timer hard while the media element keeps
 * playing — audio does not stop — so the next sample can arrive tens of seconds
 * later at a position tens of seconds further on. The delta rule read that as a
 * seek, banked the interval, and opened a new one after the hole.
 *
 * `fillSamplingGaps` then could not close it: its limit was
 * `min(60, duration × 0.1)`, and this hole was ninety seconds. P169-00 removed
 * that limit — but this rule still carries its own weight, and more of it than
 * before: since P168-01 the server refuses a segment that begins past the
 * furthest point the record reaches, so a client that lets the hole form does
 * not get a hole, it gets every later report rejected.
 *
 * The delta rule is **redundant for a real seek**: `VideoPlayer` fires
 * `onStop("seek")` from the element's own `seeking` event, which calls
 * `closeOpen()` before any large-delta tick can arrive. So a forward jump on an
 * interval that is still open is not a seek — it is the browser not having
 * scheduled us, across material that genuinely played.
 *
 * Crediting it is sound rather than generous: a media element cannot advance
 * `currentTime` faster than wall-clock × rate, so a jump of N media seconds
 * took at least N/rate seconds of real playback. The server's
 * `faster_than_wallclock` budget bounds the total independently (P153-01).
 */
describe("a sample that arrives late because the tab was in the background", () => {
  it("credits the span it played through instead of cutting a hole in it", () => {
    const tracker = new WatchTracker();
    let now = 1_000_000;

    // Foreground: `timeupdate` about four times a second, and the clock keeps
    // pace with the media because that is what playing means.
    for (let t = 370; t <= 380; t += 0.25) {
      tracker.observe(t, true, 1, now);
      now += 250;
    }

    // Backgrounded. The next sample lands ninety media seconds on — and ninety
    // seconds of real time later, because the audio was playing the whole time.
    // No `seeking` event fired, so `closeOpen` was never called.
    now += 90_000;
    for (let t = 470; t <= 475; t += 0.25) {
      tracker.observe(t, true, 1, now);
      now += 250;
    }

    expect(tracker.drain()).toEqual([{ startSec: 370, endSec: 475 }]);
  });

  it("refuses the same jump when no time passed, because that is a scrub", () => {
    /*
     * The half that makes the case above safe, and the reason the first attempt
     * at this was wrong: position alone cannot tell throttled playback from a
     * drag of the scrub bar. Ninety media seconds in a quarter of a second of
     * real time is not something a media element can do.
     */
    const tracker = new WatchTracker();
    let now = 1_000_000;

    for (let t = 370; t <= 380; t += 0.25) {
      tracker.observe(t, true, 1, now);
      now += 250;
    }
    now += 250;
    for (let t = 470; t <= 475; t += 0.25) {
      tracker.observe(t, true, 1, now);
      now += 250;
    }

    expect(tracker.drain()).toEqual([
      { startSec: 370, endSec: 380 },
      { startSec: 470, endSec: 475 },
    ]);
  });

  it("still refuses to bridge a backward jump", () => {
    // The guard. A rewind is the one direction that could manufacture coverage
    // out of nothing, and it stays a break.
    const tracker = new WatchTracker();

    for (let t = 370; t <= 380; t += 0.25) tracker.observe(t, true);
    for (let t = 100; t <= 105; t += 0.25) tracker.observe(t, true);

    expect(tracker.drain()).toEqual([
      { startSec: 370, endSec: 380 },
      { startSec: 100, endSec: 105 },
    ]);
  });

  it("still breaks at a seek the player told it about", () => {
    // The path that actually detects a seek, and the reason the delta rule is
    // not needed for one: `VideoPlayer` calls this from the `seeking` event.
    const tracker = new WatchTracker();

    for (let t = 370; t <= 380; t += 0.25) tracker.observe(t, true);
    tracker.closeOpen();
    for (let t = 470; t <= 475; t += 0.25) tracker.observe(t, true);

    expect(tracker.drain()).toEqual([
      { startSec: 370, endSec: 380 },
      { startSec: 470, endSec: 475 },
    ]);
  });
});
