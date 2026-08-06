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

  it("skips a storage key, which is not something a browser can fetch", () => {
    // `s3://` is resolved to a signed URL by the API at play time. Nothing is
    // wrong with it; it simply cannot be read from the console.
    expect(
      probeableSourceUrl([
        source("s3://ds-media/adhs/modul-1.mp4"),
        source("https://cdn.example.org/modul-1.mp4"),
      ]),
    ).toBe("https://cdn.example.org/modul-1.mp4");
  });

  it("ignores a row the author started and abandoned", () => {
    expect(probeableSourceUrl([source("   "), source("https://cdn/x.mp4")])).toBe(
      "https://cdn/x.mp4",
    );
  });

  it("has nothing to offer when no source is fetchable", () => {
    expect(probeableSourceUrl([])).toBeUndefined();
    expect(probeableSourceUrl([source("s3://ds-media/x.mp4")])).toBeUndefined();
    // Not a scheme a browser will load media over, and one worth never trying:
    // a `javascript:` URL assigned to `video.src` is inert, but writing the
    // allow-list as "http and https" rather than "not s3" keeps it that way.
    expect(probeableSourceUrl([source("javascript:alert(1)")])).toBeUndefined();
  });
});
