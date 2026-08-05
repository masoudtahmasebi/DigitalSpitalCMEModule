/**
 * The cryptographic primitives behind a staff account (P12-03), implementing
 * ADR-0012.
 *
 * Everything here is I/O or randomness, which is exactly why it is *not* in
 * `@ds/domain` — that package is pure and time is always an argument. The
 * decisions live there; the hashing lives here.
 *
 * ## Argon2id, and why the parameters are not tuned down
 *
 * `@node-rs/argon2`'s defaults are 19 MiB and two passes, which is the OWASP
 * minimum for Argon2id and costs roughly 50 ms on the hosts this runs on.
 * That is the point: a login should be slow enough that an offline attack on a
 * stolen hash is expensive, and 50 ms is imperceptible to the one person a
 * second who signs in to an admin console.
 *
 * The hash is stored in PHC string format, which carries its own parameters —
 * so raising the cost later leaves existing hashes verifiable, and a hash
 * written by an older deployment still works.
 *
 * ## Why tokens are hashed before storage
 *
 * A session cookie, an invitation link and a reset link are all bearer
 * credentials: whoever holds the value is the user. Storing them plainly would
 * make a database dump — or a read replica, or a backup on somebody's laptop —
 * a set of live logins. So the database holds SHA-256 of the value and the
 * value itself exists only in the email or the cookie.
 *
 * SHA-256 rather than Argon2 for these, deliberately: they are 256 bits of
 * output from a CSPRNG, not something a person chose, so there is no dictionary
 * to attack and nothing for a slow hash to buy. Making session lookup take
 * 50 ms would only make every request slower.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";

/**
 * Argon2id's numeric identifier, written out rather than imported.
 *
 * `@node-rs/argon2` exports `Algorithm` as an ambient const enum, which
 * `isolatedModules` cannot erase — every file compiles alone, so the compiler
 * has no way to inline the value. The number is fixed by the Argon2
 * specification (0 = Argon2d, 1 = Argon2i, 2 = Argon2id), so writing it is
 * safe in a way that inlining a library's own enum value would not be.
 */
const ARGON2ID = 2;

const ARGON_OPTIONS = { algorithm: ARGON2ID } as const;

/**
 * A hash of a password nobody will ever present.
 *
 * Verifying against this is how login stays constant-time when the account
 * does not exist. Without it, "unknown address" returns in a microsecond and
 * "wrong password" in fifty milliseconds — which is an account-enumeration
 * oracle any script can read, and it tells an attacker which of a leaked
 * address list are administrators here.
 *
 * Computed once at module load, on a value from the CSPRNG so it cannot be
 * precomputed.
 */
const DECOY_HASH_PROMISE: Promise<string> = argonHash(
  randomBytes(32).toString("hex"),
  ARGON_OPTIONS,
);

export async function hashPassword(password: string): Promise<string> {
  return argonHash(password, ARGON_OPTIONS);
}

/**
 * Check a password against a stored hash, taking the same time whether or not
 * the account exists.
 *
 * `storedHash` is `null` for two different situations and both must behave
 * identically to a caller: no such account, and an invited account that has
 * not set a password yet. Neither may authenticate, and neither may be
 * distinguishable from a wrong password.
 */
export async function verifyPassword(
  storedHash: string | null,
  password: string,
): Promise<boolean> {
  if (storedHash === null) {
    // Burn the same work, then refuse. Not a bare `return false`: that is the
    // enumeration oracle described above.
    await argonVerify(await DECOY_HASH_PROMISE, password).catch(() => false);
    return false;
  }

  try {
    return await argonVerify(storedHash, password);
  } catch {
    // A malformed hash in the database is a corruption, not a wrong password.
    // Refusing is right; throwing would leak that this account is different.
    return false;
  }
}

/**
 * A bearer token: 256 bits from the CSPRNG, base64url so it survives a cookie
 * and a URL without escaping.
 */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** What goes in the database. The token itself never does. */
export function hashToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

/**
 * Compare a presented CSRF token against the stored hash without leaking
 * position through timing.
 *
 * `timingSafeEqual` throws on a length mismatch, which would itself be a
 * signal, so the lengths are checked first and a mismatch returns false — both
 * inputs are always 32-byte digests here, so an unequal length means something
 * malformed rather than a near miss.
 */
export function tokenMatches(presented: string, storedHash: Buffer): boolean {
  const presentedHash = hashToken(presented);
  if (presentedHash.length !== storedHash.length) return false;
  return timingSafeEqual(presentedHash, storedHash);
}

/**
 * SHA-256 of a client IP, for the security log.
 *
 * An IP address is personal data (docs/gdpr.md §2). Hashing keeps "the same
 * address signed in from two places" answerable without keeping the address.
 * Salted with the KMS key so the hash is not reversible by rainbow table over
 * the whole IPv4 space — which is small enough to enumerate.
 */
export function hashIp(ip: string, salt: string): Buffer {
  return createHash("sha256").update(salt, "utf8").update(ip, "utf8").digest();
}
