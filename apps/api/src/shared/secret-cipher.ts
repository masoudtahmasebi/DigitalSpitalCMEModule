/**
 * Encryption at rest for stored secrets (`CLAUDE.md` §4 invariant 7).
 *
 * Two secrets live in the database: the **VNR password**, which authenticates
 * DigitalSpital to a legally binding accreditation interface, and **SMTP
 * credentials**. Both are stored in `bytea` columns whose names end `_enc`,
 * and neither is ever returned by an API response or written to a log.
 *
 * ## Why this seam exists in this shape
 *
 * The columns are `bytea` because ciphertext is bytes. Until the KMS key is
 * provisioned there is nothing to encrypt *with*, and the tempting shortcut —
 * quietly storing UTF-8 plaintext in a column called `_enc` — is the worst
 * option available: it satisfies every type, passes every test, and leaves a
 * plaintext VNR password in a database backup with a name that says otherwise.
 *
 * So the seam is explicit instead. `PlaintextSecretCipher` does exactly what
 * it says, and **refuses to run in production**. Wiring a real KMS-backed
 * implementation means implementing this interface and changing one line in
 * the composition root; nothing above this file changes.
 *
 * Tracked as P0-05 in `docs/backlog/P0.md`.
 */

export interface SecretCipher {
  /** Plaintext in, ciphertext bytes out, for storage in a `_enc` column. */
  encrypt(plaintext: string): Buffer;
  /** Ciphertext bytes from a `_enc` column, plaintext out. */
  decrypt(ciphertext: Buffer | null): string | null;
}

export class SecretCipherUnavailableError extends Error {
  constructor() {
    super(
      "No secret cipher configured. Set SECRETS_KMS_KEY, or run with " +
        "NODE_ENV != production to use the development plaintext cipher.",
    );
    this.name = "SecretCipherUnavailableError";
  }
}

/**
 * Development and test only. Stores the bytes of the plaintext.
 *
 * The `production` guard is the whole point: the failure mode this class
 * protects against is shipping it by accident, so it fails loudly at
 * construction rather than silently at rest.
 */
export class PlaintextSecretCipher implements SecretCipher {
  constructor(nodeEnv: string) {
    if (nodeEnv === "production") throw new SecretCipherUnavailableError();
  }

  encrypt(plaintext: string): Buffer {
    return Buffer.from(plaintext, "utf8");
  }

  decrypt(ciphertext: Buffer | null): string | null {
    if (ciphertext === null) return null;
    return ciphertext.toString("utf8");
  }
}

/**
 * Chooses the cipher for the running environment.
 *
 * Deliberately has no "fall back to plaintext in production" branch — a
 * misconfigured production deployment must fail to start, not start insecurely.
 */
export function createSecretCipher(nodeEnv: string): SecretCipher {
  return new PlaintextSecretCipher(nodeEnv);
}
