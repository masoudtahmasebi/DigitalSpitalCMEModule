import { describe, expect, it } from "vitest";
import { sniffFontFormat } from "./font-file.js";

/**
 * Builds a syntactically plausible font container.
 *
 * `declaredLength` defaults to the real length, so a test that cares about the
 * length check has to say so — the interesting cases are the ones where the two
 * disagree.
 */
function container(
  signature: string,
  totalBytes = 64,
  declaredLength: number = totalBytes,
): Uint8Array {
  const bytes = new Uint8Array(totalBytes);
  for (let i = 0; i < 4; i += 1) bytes[i] = signature.charCodeAt(i);
  new DataView(bytes.buffer).setUint32(8, declaredLength, false);
  return bytes;
}

describe("sniffFontFormat", () => {
  it("accepts a woff2 container", () => {
    expect(sniffFontFormat(container("wOF2"))).toEqual({ ok: true, mime: "font/woff2" });
  });

  it("accepts a woff container", () => {
    expect(sniffFontFormat(container("wOFF"))).toEqual({ ok: true, mime: "font/woff" });
  });

  it("refuses an SVG font however it is dressed up", () => {
    // The whole reason this function exists. An SVG font is executable markup
    // that we would serve from our own origin, so no path may reach one — not
    // by declared type, not by extension, not by leading whitespace.
    const svg = new TextEncoder().encode(
      `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><font id="x">` +
        `<glyph unicode="A"/></font><script>alert(1)</script></svg>`.padEnd(64, " "),
    );
    expect(sniffFontFormat(svg)).toEqual({ ok: false, reason: "unknown_signature" });
  });

  it("refuses raw TrueType and OpenType", () => {
    // Real fonts, and harmless — but unwrapped sfnt is a format we do not
    // serve, and accepting it would mean a Content-Type that is a guess.
    const ttf = new Uint8Array(64);
    new DataView(ttf.buffer).setUint32(0, 0x00010000, false);
    expect(sniffFontFormat(ttf)).toEqual({ ok: false, reason: "unknown_signature" });

    expect(sniffFontFormat(container("OTTO"))).toEqual({
      ok: false,
      reason: "unknown_signature",
    });
  });

  it("refuses a woff2 with data appended after it", () => {
    // The polyglot: a valid font to a font parser, and something else entirely
    // to anything that keeps reading. We serve this file from our own origin
    // with a year-long cache, so it must be exactly as long as it claims.
    const appended = container("wOF2", 128, 64);
    expect(sniffFontFormat(appended)).toEqual({ ok: false, reason: "length_mismatch" });
  });

  it("refuses a truncated font", () => {
    expect(sniffFontFormat(container("wOF2", 64, 4096))).toEqual({
      ok: false,
      reason: "length_mismatch",
    });
  });

  it("refuses anything too short to hold a header", () => {
    expect(sniffFontFormat(new Uint8Array(0))).toEqual({ ok: false, reason: "empty" });
    expect(sniffFontFormat(new Uint8Array([0x77, 0x4f, 0x46, 0x32]))).toEqual({
      ok: false,
      reason: "empty",
    });
  });

  it("reads from the view's own offset, not the underlying buffer's start", () => {
    // Node hands out pooled Buffers, so an uploaded font routinely arrives as a
    // view into a much larger allocation. Reading from index 0 of `.buffer`
    // would sniff whatever the previous request left there.
    const pool = new Uint8Array(256);
    pool.set(container("wOF2", 64), 100);
    const view = pool.subarray(100, 164);

    expect(sniffFontFormat(view)).toEqual({ ok: true, mime: "font/woff2" });
  });

  it("is case-sensitive about the signature", () => {
    // `WOFF` uppercase is not the signature; the spec says `wOFF`.
    expect(sniffFontFormat(container("WOFF"))).toEqual({
      ok: false,
      reason: "unknown_signature",
    });
  });
});
