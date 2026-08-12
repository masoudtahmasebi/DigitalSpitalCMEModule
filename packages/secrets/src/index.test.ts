/**
 * These are the tests for the two values that authenticate this platform to
 * the outside world: the VNR password (the Ärztekammer's Punktemeldung
 * interface) and the SMTP credentials. Getting the cipher wrong does not
 * present as a crash — it presents as a Punktemeldung that will not
 * authenticate, days later, against a statutory deadline.
 *
 * So the interesting cases here are the refusals, not the round-trip.
 */

import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  AesGcmSecretCipher,
  createSecretCipher,
  PlaintextSecretCipher,
  SecretCipherUnavailableError,
  SecretDecryptionError,
} from "./index.js";

const KEY = randomBytes(32).toString("base64");

describe("the production cipher", () => {
  const cipher = AesGcmSecretCipher.fromBase64(KEY);

  it("round-trips a secret", () => {
    expect(cipher.decrypt(cipher.encrypt("vnr-password"))).toBe("vnr-password");
  });

  it("handles non-ASCII, which a real password may contain", () => {
    expect(cipher.decrypt(cipher.encrypt("Paßwort-äöü-✓"))).toBe("Paßwort-äöü-✓");
  });

  it("maps an absent secret to null rather than an empty string", () => {
    // "" and "no secret configured" mean different things to the worker: one
    // is a password, the other is an authoring gap it must report.
    expect(cipher.decrypt(null)).toBeNull();
  });

  it("round-trips the empty string as the empty string", () => {
    expect(cipher.decrypt(cipher.encrypt(""))).toBe("");
  });

  it("does not store the plaintext", () => {
    // The whole point. A `_enc` column that contains readable bytes is the
    // failure this class exists to prevent.
    const stored = cipher.encrypt("vnr-password");
    expect(stored.toString("utf8")).not.toContain("vnr-password");
    expect(stored.toString("latin1")).not.toContain("vnr-password");
  });

  it("produces different ciphertext each time, so equal secrets are not visibly equal", () => {
    // A deterministic cipher would let anyone with read access to the table
    // see which customers share a password.
    const a = cipher.encrypt("same");
    const b = cipher.encrypt("same");
    expect(a.equals(b)).toBe(false);
    expect(cipher.decrypt(a)).toBe(cipher.decrypt(b));
  });
});

describe("it refuses anything it did not write", () => {
  const cipher = AesGcmSecretCipher.fromBase64(KEY);

  it("rejects an altered ciphertext rather than returning garbage", () => {
    // GCM's authentication is the reason for choosing it: a flipped bit in a
    // backup restore must be an error, not a subtly wrong password.
    const stored = cipher.encrypt("vnr-password");
    const at = stored.length - 20;
    // Buffer index access is `number | undefined` under noUncheckedIndexedAccess;
    // the read/write pair is typed and says the same thing.
    stored.writeUInt8(stored.readUInt8(at) ^ 0xff, at);
    expect(() => cipher.decrypt(stored)).toThrow(SecretDecryptionError);
  });

  it("rejects a tampered authentication tag", () => {
    const stored = cipher.encrypt("vnr-password");
    const at = stored.length - 1;
    stored.writeUInt8(stored.readUInt8(at) ^ 0x01, at);
    expect(() => cipher.decrypt(stored)).toThrow(SecretDecryptionError);
  });

  it("rejects a value encrypted under a different key", () => {
    const other = AesGcmSecretCipher.fromBase64(randomBytes(32).toString("base64"));
    expect(() => cipher.decrypt(other.encrypt("vnr-password"))).toThrow(
      SecretDecryptionError,
    );
  });

  it("rejects an unknown envelope version", () => {
    // The version byte is what makes a future algorithm change possible; a
    // reader that ignored it would try to parse the new format as the old one.
    const stored = cipher.encrypt("vnr-password");
    stored[0] = 99;
    expect(() => cipher.decrypt(stored)).toThrow(/unknown envelope version/);
  });

  it("rejects plaintext left over from the development cipher", () => {
    // The migration hazard: a database written under the plaintext cipher and
    // then pointed at a real key. Failing loudly is right — these bytes are a
    // password that must now be re-entered, not data to be silently mangled.
    const legacy = new PlaintextSecretCipher("development").encrypt("vnr-password");
    expect(() => cipher.decrypt(legacy)).toThrow(SecretDecryptionError);
  });

  it("rejects a truncated value without reading past the end", () => {
    expect(() => cipher.decrypt(Buffer.of(1, 2, 3))).toThrow(/too short/);
  });

  it("never puts the secret or the key in the error message", () => {
    const other = AesGcmSecretCipher.fromBase64(randomBytes(32).toString("base64"));
    try {
      cipher.decrypt(other.encrypt("vnr-password"));
      expect.unreachable("decrypt should have thrown");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain("vnr-password");
      expect(message).not.toContain(KEY);
    }
  });
});

describe("the key itself is validated", () => {
  it("refuses a key that is not 32 bytes", () => {
    expect(() =>
      AesGcmSecretCipher.fromBase64(randomBytes(16).toString("base64")),
    ).toThrow(/must decode to exactly 32 bytes/);
  });

  it("refuses a key that is not really base64", () => {
    // `Buffer.from(…, "base64")` silently drops what it cannot decode, so a
    // mistyped key arrives short rather than as an error. The length check is
    // what turns that into a refusal.
    expect(() => AesGcmSecretCipher.fromBase64("not-a-real-key")).toThrow(
      /must decode to exactly 32 bytes/,
    );
  });
});

describe("the development cipher", () => {
  const cipher = new PlaintextSecretCipher("test");

  it("returns what it was given", () => {
    expect(cipher.decrypt(cipher.encrypt("vnr-password"))).toBe("vnr-password");
  });

  it("maps an absent secret to null rather than an empty string", () => {
    expect(cipher.decrypt(null)).toBeNull();
  });

  it("throws at construction under NODE_ENV=production", () => {
    // The failure mode guarded against is shipping the plaintext cipher by
    // accident, so it fails loudly at boot rather than quietly at rest.
    expect(() => new PlaintextSecretCipher("production")).toThrow(
      SecretCipherUnavailableError,
    );
  });
});

describe("createSecretCipher chooses correctly", () => {
  it("uses the real cipher whenever a key is configured, in any environment", () => {
    // Development on the real construction is how the real construction gets
    // exercised before it matters.
    expect(createSecretCipher("development", KEY)).toBeInstanceOf(AesGcmSecretCipher);
    expect(createSecretCipher("production", KEY)).toBeInstanceOf(AesGcmSecretCipher);
  });

  it("falls back to plaintext only outside production", () => {
    expect(createSecretCipher("development")).toBeInstanceOf(PlaintextSecretCipher);
    expect(createSecretCipher("test")).toBeInstanceOf(PlaintextSecretCipher);
  });

  it("has no production fallback — a misconfigured deploy must not start", () => {
    expect(() => createSecretCipher("production")).toThrow(SecretCipherUnavailableError);
  });

  it("refuses a malformed key in production rather than falling back", () => {
    // The dangerous near-miss: a key that is present but wrong must not be
    // treated as "no key", because "no key" outside production means plaintext.
    expect(() => createSecretCipher("production", "too-short")).toThrow(
      /must decode to exactly 32 bytes/,
    );
  });
});
