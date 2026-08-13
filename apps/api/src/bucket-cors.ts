/**
 * Configure the media bucket for browser uploads, and prove it (P70-01).
 *
 * Runs from inside the API image, the way the migrator and the seeds do,
 * because the production host has no checkout and no workspace:
 *
 *   ./dsc run --rm -e S3_CORS_ORIGINS=https://verwaltung.example.de \
 *     --entrypoint node api dist/bucket-cors.js
 *
 * `deploy.sh` invokes it on every deploy and **fails the deploy when the probe
 * refuses**. That is the point of it. Before this existed, a bucket without a
 * CORS rule produced a console whose upload silently did nothing, a clean API
 * log, and a green deploy — for months. The rule was written down in
 * `config.env.example` for a human to apply, and CLAUDE.md §9.9's corollary
 * held: the repository's state is not the installation's state.
 *
 * Exit codes, because a deploy script reads them:
 *
 *   0  the bucket allows the console to upload — or object storage is not
 *      configured on this installation at all, which is a supported state
 *   1  it does not, and the message says what to paste where
 *
 * Idempotent: applying a rule the bucket already has is the same request.
 */

import {
  applyBucketCors,
  consoleUploadRule,
  corsConfigurationXml,
  probePreflight,
} from "./shared/bucket-cors.js";
import { S3Presigner } from "./shared/s3-presigner.js";

/* eslint-disable no-console -- this is a CLI; its output is the point */

function env(name: string): string {
  return process.env[name] ?? "";
}

async function main(): Promise<void> {
  const endpoint = env("S3_ENDPOINT");
  const bucket = env("S3_BUCKET");

  /*
   * Not an error. Object storage is optional — an installation without it
   * serves media from plain https:// URLs and disables the upload button with a
   * reason — so this must be a no-op there rather than a deploy failure.
   */
  if (endpoint === "" || bucket === "") {
    console.log("No object storage is configured; nothing to do.");
    return;
  }

  /*
   * Required once storage exists, and deliberately not defaulted.
   *
   * A guessed origin would produce a rule that is present, plausible and wrong
   * — the worst of the three states, because the probe below would then be the
   * only thing that noticed and it would report the guess rather than the
   * mistake. `deploy.sh` derives this from BASE_DOMAIN, which is the one place
   * the console's hostname is decided.
   */
  const origins = env("S3_CORS_ORIGINS")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value !== "");

  if (origins.length === 0) {
    throw new Error(
      "S3_CORS_ORIGINS is required when object storage is configured — " +
        "the console's origin, e.g. https://verwaltung.example.de",
    );
  }

  const rule = consoleUploadRule(origins);
  const presigner = new S3Presigner({
    endpoint,
    region: env("S3_REGION"),
    bucket,
    accessKeyId: env("S3_ACCESS_KEY_ID"),
    secretAccessKey: env("S3_SECRET_ACCESS_KEY"),
    forcePathStyle: env("S3_FORCE_PATH_STYLE") !== "no",
  });

  const applied = await applyBucketCors(presigner, rule, new Date());
  switch (applied.kind) {
    case "applied":
      // The rule's own methods, not the word "PUT": a red-check that changed
      // `consoleUploadRule` to GET produced a line reading "Applied … PUT" over
      // a document that said GET. A log that restates its intention rather than
      // what it did is the kind of green that cannot go red (§9.1).
      console.log(
        `Applied the CORS rule to ${bucket}: ` +
          `${rule.methods.join(", ")} from ${origins.join(", ")}.`,
      );
      break;
    /*
     * A warning, not a failure, and the ordering is the whole design.
     *
     * Some S3 implementations do not expose PutBucketCors to an ordinary access
     * key, and some operators apply the rule in a web console instead. Either
     * way the question that decides whether uploads work is the probe below —
     * so a refusal here is reported and the run continues to ask it. Failing
     * now would turn "you already did this by hand" into a broken deploy.
     */
    case "refused":
      console.warn(
        `Could not write the CORS rule (HTTP ${String(applied.status)}). ` +
          `Checking whether the bucket already allows the console anyway.`,
      );
      break;
    case "unreachable":
      console.warn(
        `Could not reach the bucket to write the CORS rule: ${applied.reason}. ` +
          `Checking whether it answers a preflight anyway.`,
      );
      break;
  }

  // Every origin, not the first: a two-console installation where only one is
  // allowed is precisely the half-configured state this is here to catch.
  const refusals: string[] = [];
  for (const origin of origins) {
    const verdict = await probePreflight(endpoint, bucket, origin, "PUT");
    if (verdict.kind === "allowed") {
      console.log(`${bucket} allows PUT from ${origin}.`);
    } else if (verdict.kind === "refused") {
      refusals.push(`${origin}: ${verdict.why}`);
    } else {
      refusals.push(`${origin}: the bucket could not be reached — ${verdict.reason}`);
    }
  }

  if (refusals.length > 0) {
    throw new Error(
      [
        "The bucket will not accept an upload from the console.",
        ...refusals.map((line) => `  ${line}`),
        "",
        "Every video upload in the console fails in the browser's preflight,",
        "which the API never sees and no server log explains.",
        "",
        `Apply this CORS configuration to ${bucket} at your storage provider:`,
        "",
        `  ${JSON.stringify([
          {
            AllowedOrigins: rule.origins,
            AllowedMethods: rule.methods,
            AllowedHeaders: rule.headers,
            ExposeHeaders: [],
            MaxAgeSeconds: rule.maxAgeSeconds,
          },
        ])}`,
        "",
        "or, as the XML form of the same document:",
        "",
        `  ${corsConfigurationXml(rule)}`,
      ].join("\n"),
    );
  }
}

main().catch((error: unknown) => {
  // No credential is ever in one of these messages: the signature lives in a
  // URL this file never prints, and the access key is not echoed.
  console.error(
    "\nThe media bucket is not ready for browser uploads.\n",
    error instanceof Error ? error.message : "unknown error",
  );
  process.exit(1);
});
