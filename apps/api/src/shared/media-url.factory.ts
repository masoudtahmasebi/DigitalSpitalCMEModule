/**
 * Chooses a media resolver from configuration (P10-09).
 *
 * Its own file so `media-url.ts` stays free of configuration and remains
 * trivially unit-testable, and so the "is storage configured?" question is
 * answered in exactly one place.
 *
 * A **partially** configured deployment gets the passthrough resolver rather
 * than a half-built presigner. `S3Presigner` throws on a partial config, and a
 * controller constructor is the wrong place for that to surface — it would
 * take down every learning route because somebody set four of five variables.
 * The visible symptom is instead that `s3://` media stays locked, which is the
 * conservative failure.
 */

import type { AppConfig } from "../config/config.js";
import {
  PassthroughMediaResolver,
  PresigningMediaResolver,
  type MediaResolver,
} from "./media-url.js";
import { hasObjectStorage } from "./object-storage.factory.js";
import { S3Presigner } from "./s3-presigner.js";

export function mediaResolverFor(config: AppConfig): MediaResolver {
  // Shared with the upload factory rather than repeated. Two copies of "is
  // storage configured?" that disagreed would mint upload signatures for a
  // bucket the read path had already decided it could not sign for.
  if (!hasObjectStorage(config)) return new PassthroughMediaResolver();

  return new PresigningMediaResolver(
    new S3Presigner({
      endpoint: config.S3_ENDPOINT,
      region: config.S3_REGION,
      bucket: config.S3_BUCKET,
      accessKeyId: config.S3_ACCESS_KEY_ID,
      secretAccessKey: config.S3_SECRET_ACCESS_KEY,
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
    }),
    config.S3_URL_TTL_SEC,
  );
}
