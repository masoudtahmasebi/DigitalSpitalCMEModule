/**
 * Media sources.
 *
 * `orderSources` carries the weight. It is the whole of the platform's format
 * negotiation — no user-agent test, no runtime branch — and getting it backwards
 * fails silently: Safari would take the MP4, lose its adaptive stream, and
 * nothing would look wrong to anyone testing on Chrome.
 */

import { describe, expect, it } from "vitest";
import {
  hasAdaptiveSource,
  mediaSourceProblems,
  orderSources,
  parseMediaSources,
  streamingKindOf,
  type MediaSource,
} from "./media.js";

function source(url: string, mimeType: string, label: string | null = null): MediaSource {
  return { url, mimeType, label };
}

const mp4 = source("https://cdn/x-720.mp4", "video/mp4", "720p");
const mp4Low = source("https://cdn/x-360.mp4", "video/mp4", "360p");
const hls = source("https://cdn/x.m3u8", "application/vnd.apple.mpegurl");
const dash = source("https://cdn/x.mpd", "application/dash+xml");

describe("streamingKindOf", () => {
  it("recognises both spellings of the HLS type", () => {
    // Both are in the wild and Safari accepts either; rejecting one would
    // refuse a correctly configured CDN.
    expect(streamingKindOf("application/vnd.apple.mpegurl")).toBe("hls");
    expect(streamingKindOf("application/x-mpegurl")).toBe("hls");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(streamingKindOf("  Application/DASH+XML ")).toBe("dash");
  });

  it("treats anything else as progressive", () => {
    expect(streamingKindOf("video/mp4")).toBe("progressive");
    expect(streamingKindOf("audio/mpeg")).toBe("progressive");
  });
});

describe("orderSources", () => {
  it("puts adaptive streams ahead of progressive files", () => {
    // The browser takes the first `type` it can play: HLS first means Safari
    // gets adaptive bitrate and Chrome falls through to the MP4, with no
    // detection code anywhere.
    expect(orderSources([mp4, hls]).map((s) => s.mimeType)).toEqual([
      "application/vnd.apple.mpegurl",
      "video/mp4",
    ]);
  });

  it("keeps the author's order within each group", () => {
    // A label is free text. Inferring "720p beats 360p" from it would be a
    // parser that gets "Audio" wrong.
    expect(orderSources([mp4, mp4Low]).map((s) => s.label)).toEqual(["720p", "360p"]);
    expect(orderSources([dash, hls]).map((s) => s.mimeType)).toEqual([
      "application/dash+xml",
      "application/vnd.apple.mpegurl",
    ]);
  });

  it("is stable, so a re-render cannot reshuffle a playing element's sources", () => {
    const input = [mp4, hls, mp4Low, dash];
    const once = orderSources(input);
    expect(orderSources([...once])).toEqual(once);
  });

  it("does not mutate its input", () => {
    const input = [mp4, hls];
    orderSources(input);
    expect(input).toEqual([mp4, hls]);
  });

  it("handles an empty list", () => {
    expect(orderSources([])).toEqual([]);
  });
});

describe("hasAdaptiveSource", () => {
  it("is true only when something other than a progressive file is present", () => {
    expect(hasAdaptiveSource([mp4, mp4Low])).toBe(false);
    expect(hasAdaptiveSource([mp4, hls])).toBe(true);
    expect(hasAdaptiveSource([])).toBe(false);
  });
});

describe("mediaSourceProblems", () => {
  it("reports an empty list without judging whether that is allowed", () => {
    // A video with no source is unplayable; a text content legitimately has
    // none. The kind-specific rule lives with the kind, not here.
    expect(mediaSourceProblems([])).toEqual(["empty"]);
  });

  it("accepts a well-formed list", () => {
    expect(mediaSourceProblems([mp4, hls])).toEqual([]);
  });

  it("refuses a mime type no browser would match", () => {
    // "mp4" or "video/mp4 " produces a <source> every browser skips — a video
    // that silently refuses to play with nothing in the console to explain it.
    expect(mediaSourceProblems([source("https://cdn/x.mp4", "mp4")])).toContain(
      "unknown_mime_type",
    );
    expect(mediaSourceProblems([source("https://cdn/x.mp4", "")])).toContain(
      "unknown_mime_type",
    );
  });

  it("tolerates the case and padding an author will paste", () => {
    expect(mediaSourceProblems([source("https://cdn/x.mp4", " Video/MP4 ")])).toEqual([]);
  });

  it("refuses a blank url", () => {
    expect(mediaSourceProblems([source("   ", "video/mp4")])).toContain("blank_url");
  });

  it("catches the same file listed twice", () => {
    // Harmless to a browser, but the quality menu then offers two identical
    // entries and an author who meant to paste a second rendition has silently
    // shipped one.
    expect(mediaSourceProblems([mp4, source(mp4.url, "video/mp4", "1080p")])).toContain(
      "duplicate_url",
    );
  });

  it("reports each distinct problem once", () => {
    const problems = mediaSourceProblems([source("", "nope"), source("", "also-nope")]);
    expect(problems.filter((p) => p === "blank_url")).toHaveLength(1);
    expect(problems.filter((p) => p === "unknown_mime_type")).toHaveLength(1);
  });
});

describe("parseMediaSources", () => {
  it("reads a well-formed column", () => {
    expect(
      parseMediaSources([
        { url: "https://cdn/x.mp4", mimeType: "video/mp4", label: "720p" },
      ]),
    ).toEqual([{ url: "https://cdn/x.mp4", mimeType: "video/mp4", label: "720p" }]);
  });

  it("drops an unusable entry rather than rendering it", () => {
    // The column is jsonb: a hand-run migration or a restored dump can put
    // anything there. A malformed entry must become one missing rendition, not
    // a <source> with `undefined` in its src.
    expect(
      parseMediaSources([
        { url: "https://cdn/ok.mp4", mimeType: "video/mp4" },
        { url: "https://cdn/bad.mp4", mimeType: "application/zip" },
        { mimeType: "video/mp4" },
        { url: "https://cdn/x.mp4" },
        null,
        "not an object",
        42,
      ]),
    ).toEqual([{ url: "https://cdn/ok.mp4", mimeType: "video/mp4", label: null }]);
  });

  it("normalises the mime type and trims the url", () => {
    expect(
      parseMediaSources([{ url: " https://cdn/x.mp4 ", mimeType: "VIDEO/MP4" }]),
    ).toEqual([{ url: "https://cdn/x.mp4", mimeType: "video/mp4", label: null }]);
  });

  it("treats a blank label as absent", () => {
    expect(
      parseMediaSources([
        { url: "https://cdn/x.mp4", mimeType: "video/mp4", label: "  " },
      ])[0]?.label,
    ).toBeNull();
  });

  it("returns an empty list for anything that is not an array", () => {
    expect(parseMediaSources(null)).toEqual([]);
    expect(parseMediaSources({})).toEqual([]);
    expect(parseMediaSources(undefined)).toEqual([]);
    expect(parseMediaSources("[]")).toEqual([]);
  });
});
