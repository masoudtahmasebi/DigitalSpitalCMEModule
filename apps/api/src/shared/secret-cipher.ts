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
 * The columns are `bytea` because ciphertext is bytes. The tempting shortcut —
 * quietly storing UTF-8 plaintext in a column called `_enc` — is the worst
 * option available: it satisfies every type, passes every test, and leaves a
 * plaintext VNR password in a database backup with a name that says otherwise.
 *
 * So there are two implementations behind one interface, and which one you get
 * is decided by configuration that is validated at boot:
 *
 * - `AesGcmSecretCipher` — the real one, used whenever a key is configured.
 * - `PlaintextSecretCipher` — development and test only, and it **refuses to
 *   be constructed in production**.
 *
 * For a long time only the second existed, and `createSecretCipher` therefore
 * threw unconditionally when `NODE_ENV=production`. That was a deliberate
 * fail-closed choice rather than an oversight — but its consequence was that
 * **the API could not start in production at all**, because the EIV scheduler
 * and the certificate delivery scheduler both build a cipher during boot. The
 * platform was safe and unshippable at the same time. This file is the other
 * half of that decision.
 *
 * ## Why AES-256-GCM, and why the envelope has a version byte
 *
 * GCM is authenticated: a modified ciphertext fails to decrypt rather than
 * yielding plausible garbage. That property is the point here. These values
 * authenticate us to the Ärztekammer's accreditation interface, and a silently
 * corrupted VNR password produces a failed Punktemeldung against a statutory
 * 8-day deadline — a compliance incident that would present as "the EIV
 * interface is rejecting us" with nothing pointing at the database.
 *
 * The stored envelope is:
 *
 *     [0]      version (currently 1)
 *     [1..13)  96-bit nonce, random per encryption
 *     [13..n)  ciphertext
 *     [n-16..) 128-bit GCM tag
 *
 * The version byte costs one byte per row and is what makes the algorithm
 * changeable later. Without it, rotating to a different construction means
 * guessing the format of every existing row from its length — and these rows
 * outlive the code that wrote them.
 *
 * A random 96-bit nonce per encryption is the standard construction for GCM.
 * The number of secrets this platform stores is a handful per customer, so the
 * birthday bound on random nonces is not close to being a concern.
 *
 * ## Key management
 *
 * `SECRETS_KMS_KEY` is 32 bytes, base64-encoded. It is validated at boot by
 * `config.ts` — a production deployment with a missing or malformed key fails
 * to start, which is the correct outcome and the one the schedulers already
 * assumed.
 *
 * The key is *not* stored beside the data it protects: it belongs in the
 * deployment's secret store, and the production compose file reads it from the
 * host's `.env`, which is not in the repository.
 *
 * Rotation is **not** automated, and P7-04's acceptance criterion "rotating the
 * KMS key is possible without re-entering every password" is therefore not yet
 * met. Rotating today means decrypting every `_enc` column under the old key
 * and re-encrypting under the new one — a sweep nothing here performs. The
 * version byte is the half of that problem this file does solve: it makes the
 * envelope self-describing, so a two-key transitional period can tell which
 * rows have been migrated. See `docs/backlog/P7.md` P7-04.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export interface SecretCipher {
  /** Plaintext in, ciphertext bytes out, for storage in a `_enc` column. */
  encrypt(plaintext: string): Buffer;
  /** Ciphertext bytes from a `_enc` column, plaintext out. */
  decrypt(ciphertext: Buffer | null): string | null;
}

export class SecretCipherUnavailableError extends Error {
  constructor() {
    super(
      "No secret cipher configured. Set SECRETS_KMS_KEY to a base64-encoded " +
        "32-byte key, or run with NODE_ENV != production to use the " +
        "development plaintext cipher.",
    );
    this.name = "SecretCipherUnavailableError";
  }
}

/** Raised when stored bytes are not something this cipher wrote. */
export class SecretDecryptionError extends Error {
  constructor(reason: string) {
    // Deliberately says nothing about the value: this message reaches logs.
    super(`Stored secret could not be decrypted: ${reason}`);
    this.name = "SecretDecryptionError";
  }
}

const VERSION = 1;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export class AesGcmSecretCipher implements SecretCipher {
  readonly #key: Buffer;

  constructor(key: Buffer) {
    if (key.length !== KEY_BYTES) {
      throw new Error(
        `SECRETS_KMS_KEY must decode to exactly ${KEY_BYTES} bytes, got ${key.length}`,
      );
    }
    this.#key = key;
  }

  /**
   * Build from the configured base64 key.
   *
   * Base64 rather than hex only because a 32-byte key is 44 characters instead
   * of 64, and these are pasted into deployment secret stores by hand.
   */
  static fromBase64(encoded: string): AesGcmSecretCipher {
    const key = Buffer.from(encoded, "base64");
    // `Buffer.from` is famously forgiving: it ignores anything it cannot
    // decode rather than failing, so a truncated or mistyped key arrives as a
    // short buffer instead of an error. The length check in the constructor is
    // what turns that into a refusal to start.
    return new AesGcmSecretCipher(key);
  }

  encrypt(plaintext: string): Buffer {
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.#key, nonce);

    // The version byte is authenticated, not merely prepended: binding it as
    // additional data means an attacker cannot rewrite it to steer a future
    // reader towards a weaker construction.
    const header = Buffer.of(VERSION);
    cipher.setAAD(header);

    const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return Buffer.concat([header, nonce, body, cipher.getAuthTag()]);
  }

  decrypt(ciphertext: Buffer | null): string | null {
    if (ciphertext === null) return null;

    if (ciphertext.length < 1 + NONCE_BYTES + TAG_BYTES) {
      throw new SecretDecryptionError("value is too short to be an envelope");
    }

    const header = ciphertext.subarray(0, 1);
    if (!timingSafeEqual(header, Buffer.of(VERSION))) {
      throw new SecretDecryptionError(`unknown envelope version ${String(header[0])}`);
    }

    const nonce = ciphertext.subarray(1, 1 + NONCE_BYTES);
    const body = ciphertext.subarray(1 + NONCE_BYTES, ciphertext.length - TAG_BYTES);
    const tag = ciphertext.subarray(ciphertext.length - TAG_BYTES);

    const decipher = createDecipheriv("aes-256-gcm", this.#key, nonce);
    decipher.setAAD(header);
    decipher.setAuthTag(tag);

    try {
      return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
    } catch {
      // GCM's authentication failing means the key is wrong or the bytes were
      // altered. Both are operational emergencies, and neither should surface
      // the stored value or the key in the message.
      throw new SecretDecryptionError(
        "authentication failed — wrong key or altered data",
      );
    }
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
 * A configured key always wins, in every environment — running development
 * against the real construction is how the real construction gets exercised.
 * Only when there is no key does the environment decide, and in production
 * that is a refusal: there is deliberately no "fall back to plaintext"
 * branch, because a misconfigured production deployment must fail to start
 * rather than start insecurely.
 */
export function createSecretCipher(nodeEnv: string, kmsKey = ""): SecretCipher {
  if (kmsKey !== "") return AesGcmSecretCipher.fromBase64(kmsKey);
  return new PlaintextSecretCipher(nodeEnv);
}
