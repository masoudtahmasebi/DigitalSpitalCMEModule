/**
 * Which source gets probed.
 *
 * The probe itself is a media element and jsdom has no decoder, so what is
 * tested here is the rule that chooses the URL — the part that would silently
 * measure the wrong file.
 */

import { describe, expect, it } from "vitest";
import { probeableSourceUrl } from "./media-duration.js";

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
