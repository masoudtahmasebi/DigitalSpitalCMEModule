/**
 * The poster taken from the video (P80-01).
 *
 * jsdom has no media pipeline — no decoder, no canvas raster — so these do not
 * assert that a real frame comes out. They assert the parts that are *logic*
 * and that decide whether an author is interrupted:
 *
 * 1. where in the clip the still is taken, including the short-video clamp;
 * 2. that every failure answers `undefined` rather than throwing, because a
 *    poster is a convenience and the field beside it still works;
 * 3. that it always settles, so a dead URL cannot leave a detached `<video>`
 *    and its buffer pending for the lifetime of the page.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { capturePosterFrame } from "./poster-frame.js";

afterEach(() => {
  vi.useRealTimers();
});

/**
 * A `<video>` stand-in whose events a test fires by hand.
 *
 * A fake document rather than jsdom's own element: the real one never fires
 * `loadedmetadata`, so every case would hit the timeout and prove nothing about
 * the paths in between.
 */
function fakeDocument(options: {
  duration: number;
  videoWidth?: number;
  videoHeight?: number;
  /** What `toBlob` hands back; `null` models a canvas that produced nothing. */
  blob?: Blob | null;
  /** Throw from `drawImage`, as a tainted canvas does. */
  taint?: boolean;
  /** Fire `error` instead of `loadedmetadata`. */
  fail?: boolean;
}) {
  const listeners = new Map<string, () => void>();
  let seekedTo = -1;

  const video = {
    crossOrigin: "",
    muted: false,
    preload: "",
    duration: options.duration,
    videoWidth: options.videoWidth ?? 640,
    videoHeight: options.videoHeight ?? 360,
    get currentTime() {
      return seekedTo;
    },
    set currentTime(value: number) {
      seekedTo = value;
      queueMicrotask(() => listeners.get("seeked")?.());
    },
    addEventListener: (name: string, fn: () => void) => listeners.set(name, fn),
    removeAttribute: () => {},
    load: () => {},
    set src(_value: string) {
      queueMicrotask(() => {
        listeners.get(options.fail === true ? "error" : "loadedmetadata")?.();
      });
    },
  };

  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({
      drawImage: () => {
        if (options.taint === true) throw new Error("SecurityError: tainted canvas");
      },
    }),
    toBlob: (cb: (b: Blob | null) => void) => {
      cb(
        options.blob === undefined
          ? new Blob(["x"], { type: "image/jpeg" })
          : options.blob,
      );
    },
  };

  return {
    document: {
      createElement: (tag: string) => (tag === "video" ? video : canvas),
    } as unknown as Document,
    seekedAt: () => seekedTo,
  };
}

describe("where the still is taken from", () => {
  it("takes it a second in, not at frame zero", async () => {
    // Frame zero of a real recording is very often black — a fade-in, a title
    // animation, a camera still adjusting exposure. A black poster is no
    // better than none.
    const fake = fakeDocument({ duration: 30 });
    await capturePosterFrame("https://cdn/x.mp4", fake.document);
    expect(fake.seekedAt()).toBe(1);
  });

  it("clamps to the midpoint of a video shorter than that", async () => {
    // The client's own videos are seconds long. Seeking past the end would
    // either fail or land on nothing.
    const fake = fakeDocument({ duration: 1.2 });
    await capturePosterFrame("https://cdn/short.mp4", fake.document);
    expect(fake.seekedAt()).toBe(0.6);
  });

  it("still picks a position when the duration is not a number", async () => {
    const fake = fakeDocument({ duration: Number.NaN });
    await capturePosterFrame("https://cdn/live.m3u8", fake.document);
    expect(fake.seekedAt()).toBe(1);
  });
});

describe("what comes back", () => {
  it("is a JPEG file ready for the ordinary upload path", async () => {
    const fake = fakeDocument({ duration: 10 });
    const frame = await capturePosterFrame("https://cdn/x.mp4", fake.document);

    expect(frame).toBeDefined();
    expect((frame as File).type).toBe("image/jpeg");
    expect((frame as File).name).toBe("poster.jpg");
  });
});

describe("every failure is silent, never thrown", () => {
  it("answers undefined for a tainted canvas", async () => {
    // The expected one: the bucket answered without the CORS headers this
    // origin needs, so the pixels are on screen and unreadable.
    const fake = fakeDocument({ duration: 10, taint: true });
    await expect(
      capturePosterFrame("https://cdn/x.mp4", fake.document),
    ).resolves.toBeUndefined();
  });

  it("answers undefined when the media element errors", async () => {
    const fake = fakeDocument({ duration: 10, fail: true });
    await expect(
      capturePosterFrame("https://cdn/x.mp4", fake.document),
    ).resolves.toBeUndefined();
  });

  it("answers undefined when the canvas produces no blob", async () => {
    const fake = fakeDocument({ duration: 10, blob: null });
    await expect(
      capturePosterFrame("https://cdn/x.mp4", fake.document),
    ).resolves.toBeUndefined();
  });

  it("answers undefined for a video with no raster to read", async () => {
    const fake = fakeDocument({ duration: 10, videoWidth: 0, videoHeight: 0 });
    await expect(
      capturePosterFrame("https://cdn/x.mp4", fake.document),
    ).resolves.toBeUndefined();
  });
});

describe("it always settles", () => {
  it("gives up rather than holding a detached element for the page's lifetime", async () => {
    vi.useFakeTimers();
    // A document whose element fires nothing at all — a hung range request.
    const silent = {
      createElement: () => ({
        crossOrigin: "",
        muted: false,
        preload: "",
        duration: 10,
        videoWidth: 640,
        videoHeight: 360,
        currentTime: 0,
        addEventListener: () => {},
        removeAttribute: () => {},
        load: () => {},
        set src(_v: string) {},
      }),
    } as unknown as Document;

    const pending = capturePosterFrame("https://cdn/hangs.mp4", silent);
    await vi.advanceTimersByTimeAsync(20_000);
    await expect(pending).resolves.toBeUndefined();
  });
});
