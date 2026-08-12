/**
 * The secret cipher, re-exported from `@ds/secrets` (P64-02).
 *
 * ## Why it moved, and why this file stays
 *
 * The implementation used to live here. It has exactly one dependency —
 * `node:crypto` — and one job: encrypt the VNR password and the SMTP password
 * so they are ciphertext in the database (CLAUDE.md §4 invariant 7).
 *
 * `packages/seed` needs it too, and could not have it. A seed writes
 * `courses.vnr_password_enc`, and a package may not reach into an app, so the
 * MEDICE seed had no way to produce a valid value — which is why it left the
 * column null, which is why the course could not be published, which is why
 * `/medice` showed an empty catalogue. One missing dependency edge, three
 * layers down from the symptom.
 *
 * So the implementation is now `@ds/secrets`, reachable from both. This file
 * remains as a re-export rather than being deleted, because roughly a dozen
 * modules import `../shared/secret-cipher.js` and a mechanical rename of all of
 * them would bury the one change that matters in this commit. There is one
 * implementation; this is a name for it.
 */

export {
  AesGcmSecretCipher,
  createSecretCipher,
  PlaintextSecretCipher,
  SecretCipherUnavailableError,
  SecretDecryptionError,
  type SecretCipher,
} from "@ds/secrets";
