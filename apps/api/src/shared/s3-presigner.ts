/**
 * Presigned S3 GET URLs (P10-09). Infrastructure — ADR-0006.
 *
 * ## Why this is 90 lines instead of a dependency
 *
 * `@aws-sdk/client-s3` plus `@aws-sdk/s3-request-presigner` is several hundred
 * packages for one operation. SigV4 query-string signing is fully specified,
 * deterministic, and testable against AWS's own published vectors — which is
 * what `s3-presigner.test.ts` does. A signature that can be checked against a
 * fixture is not a place where a dependency earns its supply-chain surface.
 *
 * It also keeps the platform honest about *which* S3. Hosting is Hetzner, in
 * Germany, on purpose (CLAUDE.md §4): course media for German physicians in a
 * US-controlled bucket is a data-transfer question nobody wants to answer.
 * Plain SigV4 against a configurable endpoint speaks to Hetzner Object Storage,
 * MinIO and Amazon alike; an Amazon SDK quietly assumes one of them.
 *
 * ## What a presigned URL is, and what it is not
 *
 * It is a **capability with an expiry**: possession is permission, until it
 * expires. So:
 *
 * - it is minted only after the sequence gate has already agreed (see
 *   `learning.service.ts`), never speculatively;
 * - it is short-lived, because a URL in a browser history, a proxy log or a
 *   copied message keeps working until it is not;
 * - it names exactly one object. There is no bucket-wide credential anywhere
 *   near a client.
 *
 * The signing key never leaves the server, and nothing here is ever logged.
 */

import { createHash, createHmac } from "node:crypto";

export interface S3Config {
  /** e.g. `https://fsn1.your-objectstorage.com` — no bucket, no trailing slash. */
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /**
   * `https://<endpoint>/<bucket>/<key>` rather than
   * `https://<bucket>.<endpoint>/<key>`.
   *
   * Defaults to path-style, which MinIO wants out of the box and every
   * S3-compatible store accepts. Virtual-hosted style exists because it is what
   * Amazon's own documentation signs — which is how the test suite checks this
   * implementation against a published vector rather than only against itself.
   */
  readonly forcePathStyle?: boolean;
}

export interface Presigner {
  /** A URL that fetches exactly this object, valid for `expiresInSec`. */
  presignGet(key: string, expiresInSec: number, now: Date): string;
}

/**
 * Refuses to exist without credentials, rather than producing URLs that 403.
 *
 * A misconfigured presigner that returns plausible-looking broken URLs is
 * worse than one that will not start: the first fails per learner, at play
 * time; the second fails at boot, in front of whoever deployed it.
 */
export class S3ConfigurationError extends Error {
  constructor(missing: readonly string[]) {
    super(`object storage is not configured: missing ${missing.join(", ")}`);
    this.name = "S3ConfigurationError";
  }
}

export class S3Presigner implements Presigner {
  constructor(private readonly config: S3Config) {
    const missing = (
      ["endpoint", "region", "bucket", "accessKeyId", "secretAccessKey"] as const
    ).filter((field) => config[field] === "");

    if (missing.length > 0) throw new S3ConfigurationError(missing);
  }

  presignGet(key: string, expiresInSec: number, now: Date): string {
    const endpoint = new URL(this.config.endpoint);
    const pathStyle = this.config.forcePathStyle !== false;

    // Path-style avoids the DNS and certificate assumptions virtual-hosted
    // style makes about a bucket name; virtual-hosted is what Amazon signs in
    // its own documentation. The host is part of the signature either way, so
    // a config pointed at the wrong style fails to verify rather than quietly
    // fetching the wrong thing.
    const host = pathStyle ? endpoint.host : `${this.config.bucket}.${endpoint.host}`;
    const canonicalUri = pathStyle
      ? `/${encodeKey(this.config.bucket)}/${encodeKey(key)}`
      : `/${encodeKey(key)}`;
    const origin = pathStyle ? this.config.endpoint : `${endpoint.protocol}//${host}`;

    const amzDate = iso8601Basic(now);
    const dateStamp = amzDate.slice(0, 8);
    const scope = `${dateStamp}/${this.config.region}/s3/aws4_request`;

    // Sorted by key, as SigV4 requires — object literal order is not a
    // guarantee anyone should lean on for a signature.
    const query = new URLSearchParams([
      ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
      ["X-Amz-Credential", `${this.config.accessKeyId}/${scope}`],
      ["X-Amz-Date", amzDate],
      ["X-Amz-Expires", String(expiresInSec)],
      ["X-Amz-SignedHeaders", "host"],
    ]);
    query.sort();

    const canonicalRequest = [
      "GET",
      canonicalUri,
      query.toString(),
      `host:${host}\n`,
      "host",
      // "UNSIGNED-PAYLOAD" is the documented value for a presigned GET: the
      // body is empty and the signature covers the URL, not content.
      "UNSIGNED-PAYLOAD",
    ].join("\n");

    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      scope,
      sha256Hex(canonicalRequest),
    ].join("\n");

    const signature = hmac(this.signingKey(dateStamp), stringToSign).toString("hex");
    query.append("X-Amz-Signature", signature);

    return `${origin}${canonicalUri}?${query.toString()}`;
  }

  /** The date-scoped derived key. Rotates daily by construction. */
  private signingKey(dateStamp: string): Buffer {
    const date = hmac(
      Buffer.from(`AWS4${this.config.secretAccessKey}`, "utf8"),
      dateStamp,
    );
    const region = hmac(date, this.config.region);
    const service = hmac(region, "s3");
    return hmac(service, "aws4_request");
  }
}

function hmac(key: Buffer, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** `YYYYMMDDTHHMMSSZ`. */
function iso8601Basic(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

/**
 * Percent-encode a key, keeping `/` as a path separator.
 *
 * `encodeURIComponent` escapes too little for SigV4 (`!'()*` are unreserved to
 * it but not to AWS) and too much for a path (it escapes `/`). Getting this
 * wrong produces a signature mismatch, which surfaces as a 403 on a video —
 * hence the explicit table rather than a library call.
 */
function encodeKey(key: string): string {
  return key
    .split("/")
    .map((segment) =>
      encodeURIComponent(segment).replace(
        /[!'()*]/g,
        (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join("/");
}
