/**
 * Which source gets probed.
 *
 * The probe itself is a media element and jsdom has no decoder, so what is
 * tested here is the rule that chooses the URL — the part that would silently
 * measure the wrong file.
 */

import { describe, expect, it } from "vitest";
import { durationFromMetadata, probeableSourceUrl } from "./media-duration.js";

const source = (url: string) => ({ url, mimeType: "video/mp4", label: null });

describe("probeableSourceUrl", () => {
  it("takes the first source, because that is the one the player takes", () => {
    expect(
      probeableSourceUrl([
        source("https://cdn.example.org/modul-1-720.mp4"),
        source("https://cdn.example.org/modul-1-360.mp4"),
      ]),
    ).toBe("https://cdn.example.org/modul-1-720.mp4");
  });

  /*
   * A storage key is now a candidate (P74-04).
   *
   * It used to be skipped, because a browser cannot fetch one — and the effect
   * was that the button which gets `durationSec` right vanished exactly when
   * the author uploaded the video through this console, sending the field back
   * to being typed. `adminViewUpload` resolves it; this rule only decides which
   * row to resolve, and the uploaded rendition is the one the player takes.
   */
  it("takes an uploaded video, which is the normal way one gets here", () => {
    expect(
      probeableSourceUrl([
        source("s3://ds-media/adhs/modul-1.mp4"),
        source("https://cdn.example.org/modul-1.mp4"),
      ]),
    ).toBe("s3://ds-media/adhs/modul-1.mp4");
  });

  it("ignores a row the author started and abandoned", () => {
    expect(probeableSourceUrl([source("   "), source("https://cdn/x.mp4")])).toBe(
      "https://cdn/x.mp4",
    );
  });

  it("has nothing to offer when no source could be read", () => {
    expect(probeableSourceUrl([])).toBeUndefined();
    // Still an allow-list of two schemes rather than a deny-list. A
    // `javascript:` URL assigned to `video.src` is inert, and writing it this
    // way round is what keeps the next scheme somebody types out of the probe.
    expect(probeableSourceUrl([source("javascript:alert(1)")])).toBeUndefined();
    expect(probeableSourceUrl([source("file:///etc/passwd")])).toBeUndefined();
  });
});

/**
 * The authored length may never exceed the file (P78-01).
 *
 * The client's report: a ~5.5-second video, a scrub bar stuck short of the end,
 * „noch 0:00" under it, and *"although the video is done, i can not go
 * forward"*. `Math.round` had stored `6` for a 5.5-second file, so the gate was
 * a percentage of seconds the file did not contain.
 *
 * The invariant these hold is one sentence: **whatever comes back is <= the
 * length the element reported.** That is what makes watching to the end always
 * enough.
 */
describe("durationFromMetadata", () => {
  it("floors, so the stored length never exceeds the file", () => {
    // The reported case. `Math.round` gave 6 here, which is the bug.
    expect(durationFromMetadata(5.5)).toBe(5);
    expect(durationFromMetadata(5.9)).toBe(5);
    expect(durationFromMetadata(1524.99)).toBe(1524);
  });

  it("leaves a whole number alone", () => {
    expect(durationFromMetadata(18)).toBe(18);
    expect(durationFromMetadata(1)).toBe(1);
  });

  it("never returns more than it was given, for any length", () => {
    // The invariant itself, rather than a handful of examples — this is the
    // property the watch gate depends on.
    for (const seconds of [1, 1.01, 2.5, 5.5, 7.999, 45.3, 600.6, 1545.9]) {
      const stored = durationFromMetadata(seconds);
      expect(stored).toBeDefined();
      expect(stored as number).toBeLessThanOrEqual(seconds);
    }
  });

  it("refuses what is not a length", () => {
    // `Infinity` is a live stream, `NaN` a manifest whose header has not
    // arrived. Neither is a duration and neither may be stored as one.
    for (const seconds of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1]) {
      expect(durationFromMetadata(seconds)).toBeUndefined();
    }
  });

  it("refuses anything under a second rather than storing a zero", () => {
    // `contentProblems` refuses a non-positive duration at publish time with a
    // worse message than the form's own "could not be read" explanation.
    expect(durationFromMetadata(0.4)).toBeUndefined();
    expect(durationFromMetadata(0.99)).toBeUndefined();
  });
});
