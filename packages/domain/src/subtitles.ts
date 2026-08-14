/**
 * Turning an SRT file into the WebVTT a browser will actually accept (P74-05).
 *
 * ## Why this exists
 *
 * Asked for by the client, of the field labelled "Untertitel-Datei (WebVTT)":
 *
 * > _"can we make the subtitle be also in srt format?"_
 *
 * Reasonable, because SRT is what comes out of nearly every transcription
 * service and every subtitle editor, and it is what a production company hands
 * over. And it cannot simply be allowed through: `<track src>` takes **WebVTT
 * and nothing else**. A browser handed an `.srt` fires `error` on the track and
 * shows no captions — silently, with the video playing perfectly. So "accepting
 * SRT" can only mean converting it, and the alternative is an author who
 * uploaded subtitles, saw no error, and does not know their course has none.
 *
 * Captions are not decoration here: WCAG 1.2.2 is Level A, and a Fortbildung a
 * hearing-impaired physician cannot follow is one they cannot be credited for.
 *
 * ## Why the conversion is here and not on the server
 *
 * It is a pure text transformation with no I/O, no clock and no randomness,
 * which is this package's whole definition — and putting it here means the one
 * place that decides what a cue is has exhaustive tests. The console converts
 * before uploading, so the object in the bucket is genuinely `text/vtt`: the
 * API's upload rules do not have to learn a second format, nothing has to
 * convert at play time, and a file downloaded from the Mediathek is what it
 * says it is.
 *
 * ## What is deliberately not done
 *
 * **Nothing is repaired.** A file that is not SRT is refused rather than
 * cleaned up: a converter that guesses produces a `.vtt` full of plausible
 * nonsense, and the failure surfaces to a physician rather than to the author
 * who could fix it.
 *
 * **Positioning is dropped, not translated.** SRT's `X1:…` coordinates are a
 * non-standard extension with no WebVTT equivalent that means the same thing.
 * Dropping them leaves captions in the default position, which is right; a
 * guessed translation moves them somewhere nobody chose.
 */

/**
 * The `hh:mm:ss.mmm` a timestamp becomes, or undefined if it is not one.
 *
 * Split by hand rather than matched by one regular expression, and not for
 * style: a pattern with an optional leading group, two required ones and an
 * optional tail backtracks on input designed to make it, which is a denial of
 * service reachable from a file an author uploads. The lint rule that says so
 * is `security/detect-unsafe-regex` and it was right.
 *
 * It is also the part that has to be strict, because it decides which commas
 * become dots: a line of dialogue reading "10:30, morgen" must survive
 * untouched. Hours are optional — some tools emit `mm:ss,mmm` — and the
 * fractional separator may be a comma (SRT) or a dot (a file somebody has
 * already half-converted, which exists in the wild).
 */
function parseStamp(raw: string): string | undefined {
  const text = raw.trim();
  const sep = Math.max(text.lastIndexOf(","), text.lastIndexOf("."));
  if (sep === -1) return undefined;

  const millis = text.slice(sep + 1);
  if (!DIGITS.test(millis)) return undefined;

  const parts = text.slice(0, sep).split(":");
  if (parts.length < 2 || parts.length > 3) return undefined;
  if (!parts.every((part) => DIGITS.test(part))) return undefined;

  const [hours, minutes, seconds] =
    parts.length === 3 ? parts : ["0", parts[0], parts[1]];

  return (
    `${pad(hours ?? "0", 2)}:${pad(minutes ?? "0", 2)}:` +
    `${pad(seconds ?? "0", 2)}.${padEnd(millis)}`
  );
}

/** One to three digits and nothing else. No quantifier to backtrack over. */
const DIGITS = /^\d{1,3}$/u;

/**
 * The WebVTT form of an SRT timing line, or undefined if this is not one.
 *
 * Everything after the end timestamp is SRT positioning (`X1:100 X2:600 …`),
 * which has no WebVTT equivalent that means the same thing — so it is dropped
 * rather than guessed at. See the header.
 */
function timingLine(line: string): string | undefined {
  const arrow = line.indexOf("-->");
  if (arrow === -1) return undefined;

  const from = parseStamp(line.slice(0, arrow));
  const to = parseStamp(
    line
      .slice(arrow + 3)
      .trim()
      .split(" ")[0] ?? "",
  );
  return from === undefined || to === undefined ? undefined : `${from} --> ${to}`;
}

/** Does this text look like SRT — enough to be worth converting? */
export function looksLikeSrt(text: string): boolean {
  return lines(text).some((line) => timingLine(line) !== undefined);
}

/** Is this already WebVTT? Then it is passed through untouched. */
export function isWebVtt(text: string): boolean {
  const first = lines(text)[0]?.trim() ?? "";
  return (
    first === "WEBVTT" || first.startsWith("WEBVTT ") || first.startsWith("WEBVTT\t")
  );
}

export type SubtitleConversion =
  | { readonly ok: true; readonly vtt: string; readonly cues: number }
  /** `already_vtt` is not a failure — it is the caller's cue to upload as-is. */
  | { readonly ok: false; readonly reason: "already_vtt" | "not_subtitles" };

/**
 * Convert SRT to WebVTT, or say why it is not being converted.
 *
 * The differences that matter, and they are all of them for a file a browser
 * has to parse:
 *
 * 1. **The signature.** A WebVTT file begins `WEBVTT`. Without that first line
 *    the browser rejects the whole file, which is the single most common reason
 *    a renamed `.srt` shows no captions at all.
 * 2. **The fraction separator.** `00:00:01,000` in SRT, `00:00:01.000` in VTT.
 *    Only on timing lines — see `TIMING`.
 * 3. **Hours are mandatory in VTT** when the timestamp has three parts, and SRT
 *    tools sometimes emit `00:01,000`. Each component is re-emitted padded, so
 *    the output is always `hh:mm:ss.mmm` and never depends on what the source
 *    happened to pad.
 * 4. **Byte-order marks and CRLF.** A leading BOM makes the signature check
 *    fail on a file that is otherwise perfect, and it is exactly what a Windows
 *    subtitle editor writes.
 *
 * Cue numbers are kept. They are legal WebVTT cue identifiers, they are what an
 * author sees when they open the file, and dropping them would make the
 * converted file harder to compare with the original.
 */
export function srtToVtt(text: string): SubtitleConversion {
  const source = stripBom(text);
  if (isWebVtt(source)) return { ok: false, reason: "already_vtt" };
  if (!looksLikeSrt(source)) return { ok: false, reason: "not_subtitles" };

  let cues = 0;
  const converted = lines(source).map((line) => {
    const timing = timingLine(line);
    if (timing === undefined) return line;
    cues += 1;
    return timing;
  });

  return { ok: true, vtt: `WEBVTT\n\n${converted.join("\n").trimStart()}\n`, cues };
}

function pad(value: string, width: number): string {
  return value.padStart(width, "0");
}

/**
 * Milliseconds are padded on the **right**.
 *
 * `,5` is five tenths of a second, which is 500 ms and not 005 ms. Padding it
 * the way the other components are padded would move every such cue by half a
 * second, and a subtitle half a second early is a subtitle for the previous
 * sentence.
 */
function padEnd(millis: string): string {
  return millis.padEnd(3, "0").slice(0, 3);
}

function stripBom(text: string): string {
  return text.startsWith("\u{FEFF}") ? text.slice(1) : text;
}

function lines(text: string): string[] {
  return text.split(/\r\n|\r|\n/u);
}
