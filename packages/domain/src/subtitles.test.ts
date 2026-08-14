/**
 * SRT in, WebVTT out (P74-05).
 *
 * Exhaustive because the failure mode is silent: a browser handed a file it
 * cannot parse shows **no captions at all**, with the video playing perfectly,
 * and nothing anywhere says so. The author sees an upload that worked. The
 * physician who needs the captions sees nothing.
 *
 * So the cases here are the four ways a real subtitle file differs from the
 * textbook one — a byte-order mark, CRLF line endings, a comma inside a line of
 * dialogue, and a tool that padded a timestamp differently — plus the two
 * non-conversions, which are answers rather than errors.
 */

import { describe, expect, it } from "vitest";
import { isWebVtt, looksLikeSrt, srtToVtt } from "./subtitles.js";

const SRT = [
  "1",
  "00:00:01,000 --> 00:00:04,000",
  "Willkommen zur Fortbildung ADHS bei Erwachsenen.",
  "",
  "2",
  "00:00:04,500 --> 00:00:09,250",
  "Mein Name ist Dr. Meyer.",
  "",
].join("\n");

function vttOf(text: string): string {
  const result = srtToVtt(text);
  if (!result.ok) throw new Error(`expected a conversion, got ${result.reason}`);
  return result.vtt;
}

describe("srtToVtt", () => {
  it("puts the signature first, which is what a browser looks for", () => {
    // Without this line the file is rejected whole — the single most common
    // reason a renamed `.srt` shows no captions.
    expect(vttOf(SRT).startsWith("WEBVTT\n\n")).toBe(true);
  });

  it("turns the fraction comma into a dot on timing lines", () => {
    expect(vttOf(SRT)).toContain("00:00:01.000 --> 00:00:04.000");
    expect(vttOf(SRT)).toContain("00:00:04.500 --> 00:00:09.250");
  });

  it("leaves a comma inside dialogue alone", () => {
    // The reason `TIMING` is written strictly rather than as a global replace.
    const text = ["1", "00:00:01,000 --> 00:00:04,000", "Guten Tag, Frau Kollegin."].join(
      "\n",
    );
    expect(vttOf(text)).toContain("Guten Tag, Frau Kollegin.");
  });

  it("keeps the cue numbers, which are legal identifiers in WebVTT", () => {
    const vtt = vttOf(SRT);
    expect(vtt).toContain("\n1\n");
    expect(vtt).toContain("\n2\n");
  });

  it("counts the cues it converted", () => {
    const result = srtToVtt(SRT);
    expect(result.ok && result.cues).toBe(2);
  });

  it("survives a byte-order mark, which is what Windows editors write", () => {
    // The BOM lands in front of the signature and the browser then rejects a
    // file that is otherwise perfect.
    expect(vttOf(`\u{FEFF}${SRT}`).startsWith("WEBVTT")).toBe(true);
  });

  it("survives CRLF line endings", () => {
    const vtt = vttOf(SRT.replace(/\n/gu, "\r\n"));
    expect(vtt).toContain("00:00:01.000 --> 00:00:04.000");
    expect(vtt).not.toContain("\r");
  });

  it("pads an hourless timestamp, because WebVTT does not accept one", () => {
    const text = ["1", "00:01,000 --> 00:04,000", "Kurz."].join("\n");
    expect(vttOf(text)).toContain("00:00:01.000 --> 00:00:04.000");
  });

  it("pads milliseconds on the right, not the left", () => {
    // `,5` is half a second. Padding it like the other components would make it
    // five milliseconds, and every such cue would arrive half a second early —
    // a subtitle for the previous sentence.
    const text = ["1", "00:00:01,5 --> 00:00:04,25", "Halb."].join("\n");
    expect(vttOf(text)).toContain("00:00:01.500 --> 00:00:04.250");
  });

  it("drops SRT positioning rather than guessing an equivalent", () => {
    const text = [
      "1",
      "00:00:01,000 --> 00:00:04,000  X1:100 X2:600 Y1:400 Y2:460",
      "Unten.",
    ].join("\n");
    const vtt = vttOf(text);
    expect(vtt).toContain("00:00:01.000 --> 00:00:04.000");
    expect(vtt).not.toContain("X1:");
  });

  it("says a WebVTT file is already one instead of converting it twice", () => {
    // Not an error: the caller uploads it unchanged. A second `WEBVTT` line in
    // the middle of a file is a parse failure.
    expect(srtToVtt("WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nHallo.")).toEqual({
      ok: false,
      reason: "already_vtt",
    });
  });

  it("refuses something that is not subtitles at all", () => {
    // Nothing is repaired. A converter that guessed would produce a `.vtt` of
    // plausible nonsense and the failure would surface to a physician.
    expect(srtToVtt("Sehr geehrte Frau Kollegin,\n\nanbei die Folien.")).toEqual({
      ok: false,
      reason: "not_subtitles",
    });
    expect(srtToVtt("")).toEqual({ ok: false, reason: "not_subtitles" });
  });

  it("does not mistake a timecode in prose for a cue", () => {
    expect(looksLikeSrt("Die Sitzung war 00:00:01,000 lang.")).toBe(false);
  });
});

describe("isWebVtt", () => {
  it("accepts the signature with and without a trailing comment", () => {
    expect(isWebVtt("WEBVTT")).toBe(true);
    expect(isWebVtt("WEBVTT - Untertitel ADHS")).toBe(true);
  });

  it("does not accept a file that merely mentions it", () => {
    expect(isWebVtt("Dies ist eine WEBVTT-Datei")).toBe(false);
    expect(isWebVtt("1\n00:00:01,000 --> 00:00:04,000")).toBe(false);
  });
});
