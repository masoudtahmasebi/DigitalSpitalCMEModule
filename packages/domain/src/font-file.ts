/**
 * What an uploaded webfont actually is (P10-08).
 *
 * A customer admin uploads a file and the platform serves it back from its own
 * origin, to every learner, on the same page that holds a bearer token. The
 * declared content type is therefore a claim by the uploader and nothing more —
 * this module decides what the bytes are.
 *
 * ## Why only woff2 and woff
 *
 * Not because older formats are unsupported. Because every accepted format is
 * parser surface we did not need. woff2 covers every browser capable of running
 * a Shadow-DOM custom element; woff is kept only because some foundries still
 * ship it.
 *
 * **SVG fonts are impossible here by construction.** An SVG font is executable
 * markup; served from our origin it is stored XSS with extra steps. There is no
 * branch below that can return one, and the CHECK constraint in migration 0008
 * says the same thing again in SQL.
 *
 * ## Why the length field is checked
 *
 * Both container formats record their own total size at byte 8. A file whose
 * header says 40 KB but which is 90 KB long is not a font with a typo — it is a
 * font with something appended, which is the classic polyglot: valid woff to a
 * font parser, valid something-else to a parser that scans further. We serve
 * this file from our own origin with a long cache lifetime, so we accept only
 * files that are exactly as long as they claim to be.
 *
 * Pure and exhaustively tested, like everything else here (CLAUDE.md §4
 * invariant 4).
 */

/** The only two formats the platform will store or serve. */
export type FontFormat = "font/woff2" | "font/woff";

export type FontSniffResult =
  | { readonly ok: true; readonly mime: FontFormat }
  | { readonly ok: false; readonly reason: FontRejection };

export type FontRejection =
  /** Zero bytes, or too short to carry a header at all. */
  | "empty"
  /** Not `wOFF` and not `wOF2` — including every SVG, TTF, OTF and ZIP. */
  | "unknown_signature"
  /** The header's own length field disagrees with the file. See above. */
  | "length_mismatch";

/** `wOFF` — WOFF 1.0, ISO/IEC 14496-22. */
const WOFF = 0x774f4646;
/** `wOF2` — WOFF 2.0. */
const WOFF2 = 0x774f4632;

/**
 * The shortest header either format defines (WOFF 1.0 is 44 bytes, WOFF 2.0 is
 * 48). Below this there is nothing to read, let alone a font.
 */
const MIN_HEADER_BYTES = 44;

/** Both formats put a big-endian uint32 total length at byte 8. */
const LENGTH_OFFSET = 8;

export function sniffFontFormat(bytes: Uint8Array): FontSniffResult {
  if (bytes.byteLength < MIN_HEADER_BYTES) return { ok: false, reason: "empty" };

  // A DataView rather than index arithmetic: `bytes` may be a view onto a
  // larger buffer (Node hands out pooled Buffers), and byteOffset must be
  // respected or we would read someone else's bytes.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const signature = view.getUint32(0, false);
  const mime =
    signature === WOFF2 ? "font/woff2" : signature === WOFF ? "font/woff" : undefined;

  if (mime === undefined) return { ok: false, reason: "unknown_signature" };

  if (view.getUint32(LENGTH_OFFSET, false) !== bytes.byteLength) {
    return { ok: false, reason: "length_mismatch" };
  }

  return { ok: true, mime };
}
