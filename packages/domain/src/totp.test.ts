/**
 * The second-factor rules.
 *
 * The cases worth writing down are the refusals and the boundaries: a code one
 * step stale is fine, two steps is not, and a code that was already spent is
 * refused even though it is arithmetically correct.
 */

import { describe, expect, it } from "vitest";
import { totpCounters, verifyTotp, TOTP_DRIFT_STEPS, TOTP_STEP_SEC } from "./totp.js";

/** A time exactly on a step boundary, so the arithmetic is easy to follow. */
const AT = new Date(1_700_000_010_000);
const CURRENT = Math.floor(AT.getTime() / 1000 / TOTP_STEP_SEC);

/** Stands in for the HMAC: the code is just the counter, zero-padded. */
const codeFor = (counter: number): string => String(counter).slice(-6).padStart(6, "0");

describe("totpCounters", () => {
  it("returns one step either side of now, earliest first", () => {
    expect(totpCounters(AT)).toEqual([CURRENT - 1, CURRENT, CURRENT + 1]);
  });

  it("defaults to the drift the constant declares", () => {
    expect(totpCounters(AT)).toEqual(totpCounters(AT, TOTP_DRIFT_STEPS));
  });

  it("can be widened, for a test that needs to reach further", () => {
    expect(totpCounters(AT, 2)).toHaveLength(5);
  });

  it("moves to the next counter as the step boundary passes", () => {
    const justBefore = new Date((CURRENT + 1) * TOTP_STEP_SEC * 1000 - 1);
    const justAfter = new Date((CURRENT + 1) * TOTP_STEP_SEC * 1000);

    expect(totpCounters(justBefore)[1]).toBe(CURRENT);
    expect(totpCounters(justAfter)[1]).toBe(CURRENT + 1);
  });
});

describe("verifyTotp", () => {
  const verify = (code: string, lastUsedCounter: number | null = null) =>
    verifyTotp({ code, now: AT, lastUsedCounter, codeFor });

  it("accepts the current code and reports which counter it was", () => {
    expect(verify(codeFor(CURRENT))).toEqual({ ok: true, counter: CURRENT });
  });

  it("accepts a code one step stale, for a phone whose clock lags", () => {
    expect(verify(codeFor(CURRENT - 1))).toEqual({ ok: true, counter: CURRENT - 1 });
  });

  it("accepts a code one step early, for one that runs fast", () => {
    expect(verify(codeFor(CURRENT + 1))).toEqual({ ok: true, counter: CURRENT + 1 });
  });

  it("refuses two steps out, because the window is a guess budget", () => {
    // Every accepted step multiplies an attacker's chances against six digits.
    expect(verify(codeFor(CURRENT - 2))).toEqual({ ok: false, reason: "wrong_code" });
    expect(verify(codeFor(CURRENT + 2))).toEqual({ ok: false, reason: "wrong_code" });
  });

  it("refuses a wrong code", () => {
    expect(verify("000000")).toEqual({ ok: false, reason: "wrong_code" });
  });

  it("refuses a code whose counter was already spent", () => {
    // Arithmetically correct and still refused: a code is valid for its whole
    // step, so replay is a real 30-second window without this.
    expect(verify(codeFor(CURRENT), CURRENT)).toEqual({ ok: false, reason: "replayed" });
  });

  it("refuses a counter below the last one used, not only the same one", () => {
    expect(verify(codeFor(CURRENT - 1), CURRENT)).toEqual({
      ok: false,
      reason: "replayed",
    });
  });

  it("accepts the next counter after one was spent", () => {
    expect(verify(codeFor(CURRENT + 1), CURRENT)).toEqual({
      ok: true,
      counter: CURRENT + 1,
    });
  });

  it("checks every counter in the window regardless of where the match is", () => {
    // Stopping at the first match would make the work depend on how stale the
    // presented code was, which is a timing signal.
    const seen: number[] = [];
    verifyTotp({
      code: codeFor(CURRENT - 1),
      now: AT,
      lastUsedCounter: null,
      codeFor: (counter) => {
        seen.push(counter);
        return codeFor(counter);
      },
    });

    expect(seen).toEqual([CURRENT - 1, CURRENT, CURRENT + 1]);
  });

  it("does not accept a code of the wrong length that shares a prefix", () => {
    expect(verify(codeFor(CURRENT).slice(0, 5))).toEqual({
      ok: false,
      reason: "wrong_code",
    });
  });
});
