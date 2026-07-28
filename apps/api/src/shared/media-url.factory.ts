/**
 * Chooses a media resolver from configuration (P10-06).
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
import { S3Presigner } from "./s3-presigner.js";

export function mediaResolverFor(config: AppConfig): MediaResolver {
  const configured =
    config.S3_ENDPOINT !== "" &&
    config.S3_REGION !== "" &&
    config.S3_BUCKET !== "" &&
    config.S3_ACCESS_KEY_ID !== "" &&
    config.S3_SECRET_ACCESS_KEY !== "";

  if (!configured) return new PassthroughMediaResolver();

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
