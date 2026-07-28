import { describe, expect, it } from "vitest";
import {
  createSecretCipher,
  PlaintextSecretCipher,
  SecretCipherUnavailableError,
} from "./secret-cipher.js";

describe("the development cipher round-trips", () => {
  const cipher = new PlaintextSecretCipher("test");

  it("returns what it was given", () => {
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
});

describe("it refuses to be the production cipher", () => {
  it("throws at construction under NODE_ENV=production", () => {
    // The failure mode guarded against is shipping the plaintext cipher by
    // accident, so it fails loudly at boot rather than quietly at rest.
    expect(() => new PlaintextSecretCipher("production")).toThrow(
      SecretCipherUnavailableError,
    );
  });

  it("has no production fallback — a misconfigured deploy must not start", () => {
    expect(() => createSecretCipher("production")).toThrow(SecretCipherUnavailableError);
    expect(() => createSecretCipher("development")).not.toThrow();
  });
});
