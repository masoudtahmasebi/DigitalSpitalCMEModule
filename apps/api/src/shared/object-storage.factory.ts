/**
 * Chooses an `ObjectStorage` from configuration, or says there is none (P23-01).
 *
 * The sibling of `media-url.factory.ts`, and it answers the same question — "is
 * object storage configured?" — from the same five variables. The two exist
 * separately because they fail differently, and both failures are deliberate:
 *
 * - **Reading** degrades. A deployment with no storage gets
 *   `PassthroughMediaResolver`, `s3://` media stays locked, and every other
 *   learning route keeps working. Taking down a course because a variable is
 *   missing would be worse than a padlock.
 * - **Writing** is absent. There is no degraded upload. `undefined` here means
 *   the upload endpoints answer "not configured" instead of minting signatures
 *   against a bucket that does not exist — an author told plainly that uploads
 *   are unavailable is in a much better position than one whose upload appears
 *   to succeed and produces a course pointing at nothing.
 *
 * The predicate is shared with `media-url.factory.ts` rather than written twice,
 * because the two drifting would produce the state neither is designed for:
 * signatures minted for a bucket the read path refuses to sign for.
 */

import type { AppConfig } from "../config/config.js";
import { ObjectStorage } from "./object-storage.js";
import { S3Presigner } from "./s3-presigner.js";

/** True when every field a presigner needs is set. Partial counts as absent. */
export function hasObjectStorage(config: AppConfig): boolean {
  return (
    config.S3_ENDPOINT !== "" &&
    config.S3_REGION !== "" &&
    config.S3_BUCKET !== "" &&
    config.S3_ACCESS_KEY_ID !== "" &&
    config.S3_SECRET_ACCESS_KEY !== ""
  );
}

export function objectStorageFor(config: AppConfig): ObjectStorage | undefined {
  if (!hasObjectStorage(config)) return undefined;

  return new ObjectStorage(
    new S3Presigner({
      endpoint: config.S3_ENDPOINT,
      region: config.S3_REGION,
      bucket: config.S3_BUCKET,
      accessKeyId: config.S3_ACCESS_KEY_ID,
      secretAccessKey: config.S3_SECRET_ACCESS_KEY,
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
    }),
    config.S3_UPLOAD_TTL_SEC,
  );
}
