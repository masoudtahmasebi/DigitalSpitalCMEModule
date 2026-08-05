/**
 * The TOTP primitives (P12-03, RFC 4226 + RFC 6238). Infrastructure layer.
 *
 * Everything that *decides* whether a code is accepted lives in
 * `@ds/domain/totp`: the drift window, replay refusal, constant-time
 * comparison. What is here is the arithmetic those decisions need — the HMAC,
 * the dynamic truncation, and Base32 — kept out of the domain package because
 * it is bundled into the browser widget and `node:crypto` would break that
 * build.
 *
 * ## Why this is implemented rather than taken from a library
 *
 * Every TOTP library on npm is a hundred lines of exactly the code below plus a
 * dependency, a maintainer and a supply-chain surface, for an algorithm that is
 * two RFCs long and has not changed since 2011. The security-relevant parts —
 * the window, the replay check, the comparison — are not in the library anyway;
 * they are the parts a caller gets wrong, which is why they are in the domain
 * package with tests around them.
 *
 * ## The secret
 *
 * Generated with `randomBytes`, 20 bytes (160 bits), which is what RFC 4226 §4
 * requires for HMAC-SHA1 and what every authenticator app expects. It is
 * **encrypted at rest** with the application KMS key before it reaches the
 * database (CLAUDE.md §4 invariant 7) and is returned to the client exactly
 * once, during enrolment — after that there is no endpoint that can produce it
 * again. Losing it means re-enrolling, which is the correct trade.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { TOTP_DIGITS, TOTP_STEP_SEC } from "@ds/domain";

/** RFC 4226 §4: 160 bits for HMAC-SHA1. */
const SECRET_BYTES = 20;

/**
 * SHA-1, and deliberately so.
 *
 * It is the only algorithm every authenticator app supports — Google
 * Authenticator ignores the `algorithm` parameter of an `otpauth://` URI
 * entirely — so SHA-256 here would produce codes that silently never match on
 * half the phones in use. HMAC-SHA1 is not affected by the collision attacks
 * that retired SHA-1 for signatures: HMAC's security rests on the compression
 * function's PRF property, which stands.
 */
const ALGORITHM = "sha1";

export function generateTotpSecret(): Buffer {
  return randomBytes(SECRET_BYTES);
}

/**
 * The code for one counter (RFC 4226 §5.3).
 *
 * The counter is written as a big-endian 64-bit integer; the low four bits of
 * the last byte of the digest select where to read a 31-bit value from, which
 * is then taken modulo 10^digits. `writeBigUInt64BE` rather than two 32-bit
 * writes, because the halves are easy to transpose and the failure would be a
 * code that is wrong only for counters above 2^32 — some time in 4147.
 */
export function totpCode(secret: Buffer, counter: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac(ALGORITHM, secret).update(message).digest();

  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const binary =
    (((digest[offset] ?? 0) & 0x7f) << 24) |
    (((digest[offset + 1] ?? 0) & 0xff) << 16) |
    (((digest[offset + 2] ?? 0) & 0xff) << 8) |
    ((digest[offset + 3] ?? 0) & 0xff);

  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

/**
 * Base32 as RFC 4648 §6, unpadded.
 *
 * Authenticator apps take the secret in this encoding and nothing else. Padding
 * is omitted because several popular apps reject a URI containing `=` — and
 * with a 20-byte secret the encoding is a whole 32 characters anyway.
 */
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function toBase32(input: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

/**
 * The `otpauth://` URI an authenticator app scans.
 *
 * The issuer appears twice — as a label prefix and as a parameter — because
 * older apps read only the first and newer ones only the second, and an entry
 * showing just an email address is one the operator cannot tell apart from
 * their other six.
 */
export function otpauthUri(input: {
  readonly secret: Buffer;
  readonly account: string;
  readonly issuer: string;
}): string {
  const label = encodeURIComponent(`${input.issuer}:${input.account}`);
  const parameters = new URLSearchParams({
    secret: toBase32(input.secret),
    issuer: input.issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SEC),
  });
  return `otpauth://totp/${label}?${parameters.toString()}`;
}

/**
 * Compare two codes without leaking how far a guess got.
 *
 * The domain's `verifyTotp` already compares in constant time; this is here for
 * callers holding raw buffers, and because `timingSafeEqual` throws on a length
 * mismatch — which is itself a branch on secret-adjacent data if the caller
 * forgets to guard it.
 */
export function codesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
