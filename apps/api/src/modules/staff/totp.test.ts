/**
 * The TOTP arithmetic, checked against the RFC's own vectors.
 *
 * These are worth having precisely because a wrong implementation still
 * produces six plausible digits. The only way to know the counter is packed,
 * truncated and reduced correctly is to reproduce values somebody else
 * published.
 */

import { describe, expect, it } from "vitest";
import { TOTP_STEP_SEC } from "@ds/domain";
import {
  codesMatch,
  generateTotpSecret,
  otpauthUri,
  toBase32,
  totpCode,
} from "./totp.js";

/** RFC 6238 Appendix B uses the ASCII secret "12345678901234567890". */
const RFC_SECRET = Buffer.from("12345678901234567890", "utf8");

const counterAt = (unixSeconds: number): number =>
  Math.floor(unixSeconds / TOTP_STEP_SEC);

describe("totpCode against the RFC 6238 test vectors", () => {
  // Appendix B, the SHA-1 column, truncated to six digits — the published
  // table is eight-digit, so these are its last six.
  it.each([
    [59, "287082"],
    [1_111_111_109, "081804"],
    [1_111_111_111, "050471"],
    [1_234_567_890, "005924"],
    [2_000_000_000, "279037"],
    [20_000_000_000, "353130"],
  ])("time %i produces %s", (unixSeconds, expected) => {
    expect(totpCode(RFC_SECRET, counterAt(unixSeconds))).toBe(expected);
  });

  it("stays correct past 2^32 seconds, where a 32-bit counter would break", () => {
    // 20000000000 is the vector above and is deliberately beyond 2^32, which
    // is what catches a counter written as two transposed 32-bit halves.
    expect(totpCode(RFC_SECRET, counterAt(20_000_000_000))).toBe("353130");
  });

  it("always returns six digits, including when the value is small", () => {
    for (let counter = 0; counter < 500; counter += 1) {
      expect(totpCode(RFC_SECRET, counter)).toMatch(/^\d{6}$/);
    }
  });
});

describe("toBase32", () => {
  // RFC 4648 §10.
  it.each([
    ["", ""],
    ["f", "MY"],
    ["fo", "MZXQ"],
    ["foo", "MZXW6"],
    ["foob", "MZXW6YQ"],
    ["fooba", "MZXW6YTB"],
    ["foobar", "MZXW6YTBOI"],
  ])("encodes %o as %s", (input, expected) => {
    expect(toBase32(Buffer.from(input, "utf8"))).toBe(expected);
  });

  it("emits no padding, which several authenticator apps reject", () => {
    expect(toBase32(generateTotpSecret())).not.toContain("=");
  });

  it("encodes a 20-byte secret as exactly 32 characters", () => {
    expect(toBase32(generateTotpSecret())).toHaveLength(32);
  });
});

describe("generateTotpSecret", () => {
  it("is 20 bytes, as RFC 4226 §4 requires for HMAC-SHA1", () => {
    expect(generateTotpSecret()).toHaveLength(20);
  });

  it("does not repeat", () => {
    const seen = new Set(
      Array.from({ length: 50 }, () => generateTotpSecret().toString("hex")),
    );
    expect(seen.size).toBe(50);
  });
});

describe("otpauthUri", () => {
  const uri = otpauthUri({
    secret: RFC_SECRET,
    account: "operator@ds.test",
    issuer: "DigitalSpital",
  });

  it("names the issuer in the label as well as the parameter", () => {
    // Older apps read only the label, newer ones only the parameter, and an
    // entry showing a bare email is one the operator cannot identify later.
    expect(uri).toContain("DigitalSpital%3Aoperator%40ds.test");
    expect(uri).toContain("issuer=DigitalSpital");
  });

  it("declares the algorithm, digits and period the code assumes", () => {
    expect(uri).toContain("algorithm=SHA1");
    expect(uri).toContain("digits=6");
    expect(uri).toContain("period=30");
  });

  it("carries the secret in Base32", () => {
    expect(uri).toContain(`secret=${toBase32(RFC_SECRET)}`);
  });
});

describe("codesMatch", () => {
  it("accepts identical codes", () => {
    expect(codesMatch("123456", "123456")).toBe(true);
  });

  it("refuses different codes", () => {
    expect(codesMatch("123456", "123457")).toBe(false);
  });

  it("refuses a length mismatch rather than throwing", () => {
    // `timingSafeEqual` throws on unequal lengths, which would turn a
    // malformed submission into a 500 instead of a refusal.
    expect(codesMatch("123456", "12345")).toBe(false);
    expect(codesMatch("", "123456")).toBe(false);
  });
});
