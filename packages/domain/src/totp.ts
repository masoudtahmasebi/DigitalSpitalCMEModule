/**
 * The time-based one-time password rules (P12-03, RFC 6238).
 *
 * This file exists to make the *decisions* around a second factor testable
 * without a clock and without a crypto library: which counter values a code may
 * legitimately have been generated from, and whether a given counter has
 * already been spent.
 *
 * ## What is deliberately not here
 *
 * The HMAC. `@ds/domain` is bundled into the learner widget, which runs in a
 * browser, so a `node:crypto` import here would break that build — and the
 * rule in `CLAUDE.md` §4 (no framework imports, no clock, no randomness) exists
 * partly to keep that true. The HMAC and the constant-time comparison live in
 * `apps/api/src/modules/staff/totp.ts`, which is the only place they are
 * needed.
 *
 * What is left is the part that actually decides whether somebody gets in.
 *
 * ## Why the window is one step and not three
 *
 * Every accepted step multiplies an attacker's chances against a six-digit
 * code. One step either side of the current one covers about 90 seconds, which
 * absorbs ordinary phone clock drift; beyond that the honest answer is that the
 * operator's device clock is wrong and should be fixed, not compensated for
 * indefinitely. RFC 6238 §5.2 makes the same recommendation.
 *
 * ## Why a used counter is remembered
 *
 * A six-digit code is valid for the whole of its step, so without this a code
 * observed over somebody's shoulder — or captured by a phishing page — can be
 * replayed for up to 30 seconds. Recording the last counter accepted for an
 * account and refusing anything at or below it costs one integer and closes
 * that window.
 */

/** Seconds per step. Thirty is the RFC default and what every authenticator app assumes. */
export const TOTP_STEP_SEC = 30;

/** Digits in a code. Six, for the same reason. */
export const TOTP_DIGITS = 6;

/** How many steps either side of `now` are accepted. See the header. */
export const TOTP_DRIFT_STEPS = 1;

/**
 * The counter values a code presented at `now` may legitimately come from,
 * earliest first.
 *
 * `now` is an argument, never read from a clock, so the boundary cases are
 * ordinary tests rather than something that has to be raced.
 */
export function totpCounters(
  now: Date,
  driftSteps = TOTP_DRIFT_STEPS,
): readonly number[] {
  const current = Math.floor(now.getTime() / 1000 / TOTP_STEP_SEC);
  const counters: number[] = [];
  for (let offset = -driftSteps; offset <= driftSteps; offset += 1) {
    counters.push(current + offset);
  }
  return counters;
}

export type TotpRejection = "replayed" | "wrong_code";

export type TotpVerdict =
  | { readonly ok: true; readonly counter: number }
  | { readonly ok: false; readonly reason: TotpRejection };

/**
 * Decide a presented code, given a way to compute the expected code for a
 * counter.
 *
 * The caller supplies `codeFor` — that is the HMAC, and it stays outside this
 * package. Everything that decides *acceptance* is here: which counters are in
 * the window, that a replayed counter is refused, and that a rejection does not
 * say which of the two it was.
 *
 * `lastUsedCounter` is the highest counter this account has already spent, or
 * `null` if it never has.
 *
 * Note the loop does not stop at the first match. It cannot: stopping early
 * makes the work done depend on which counter matched, which is a timing
 * signal about how far off the presented code was. Every call walks the whole
 * window.
 */
export function verifyTotp(input: {
  readonly code: string;
  readonly now: Date;
  readonly lastUsedCounter: number | null;
  readonly codeFor: (counter: number) => string;
  readonly driftSteps?: number;
}): TotpVerdict {
  let matched: number | undefined;

  for (const counter of totpCounters(input.now, input.driftSteps ?? TOTP_DRIFT_STEPS)) {
    // `codeFor` is expected to be constant-time in its comparison inputs; the
    // comparison itself is on two strings of fixed, equal length.
    if (constantTimeEquals(input.codeFor(counter), input.code)) {
      matched = counter;
    }
  }

  if (matched === undefined) return { ok: false, reason: "wrong_code" };

  // A code is valid for its whole step, so without this it can be replayed for
  // up to thirty seconds by anyone who saw it.
  if (input.lastUsedCounter !== null && matched <= input.lastUsedCounter) {
    return { ok: false, reason: "replayed" };
  }

  return { ok: true, counter: matched };
}

/**
 * Length-independent, branch-free string comparison.
 *
 * `===` on strings short-circuits at the first differing character, which
 * leaks how much of a code was guessed correctly. Codes here are always six
 * digits, so the length difference is not itself a secret — but a comparison
 * that is only safe when its inputs happen to be the right length is a
 * comparison waiting to be reused somewhere they are not.
 */
function constantTimeEquals(a: string, b: string): boolean {
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    difference |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return difference === 0;
}
