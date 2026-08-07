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

/**
 * What an upload signature is allowed to be spent on.
 *
 * Both fields become **signed headers**, which is what turns a presigned PUT
 * from "you may write this object" into "you may write this object, with
 * exactly this type, at exactly this length". S3 recomputes the signature from
 * the headers the request actually carried, so a browser that sends a different
 * content type — or a body of a different size — gets a 403 from the bucket
 * rather than a stored object nobody approved.
 *
 * `contentLength` works because a browser computes it from the body and refuses
 * to let script set it. The client therefore cannot lie about it and have the
 * upload succeed: the declared size either matches the file or the signature
 * does not verify.
 */
export interface UploadConstraints {
  readonly contentType: string;
  readonly contentLength: number;
}

/**
 * The read half, and the only half the learner-facing path is given.
 *
 * `PresigningMediaResolver` takes this rather than `Presigner` so the code that
 * runs on every lesson request is structurally incapable of writing or deleting
 * an object. It is a type, not a runtime boundary — the same `S3Presigner`
 * satisfies both — but it means a delete in the media path is a compile error
 * rather than a review comment somebody has to notice.
 */
export interface ReadPresigner {
  /** A URL that fetches exactly this object, valid for `expiresInSec`. */
  presignGet(key: string, expiresInSec: number, now: Date): string;
}

export interface Presigner extends ReadPresigner {
  /**
   * A URL that writes exactly this object, with exactly this type and length.
   *
   * Short-lived by construction and minted only for a key the server built
   * itself from the caller's validated tenant — see `object-storage.ts`.
   */
  presignPut(
    key: string,
    expiresInSec: number,
    now: Date,
    constraints: UploadConstraints,
  ): string;

  /**
   * A URL that reads this object's metadata and nothing else.
   *
   * Used by the API to check what was actually uploaded. A HEAD is the cheapest
   * question that distinguishes "the browser said it succeeded" from "the bytes
   * are in the bucket".
   */
  presignHead(key: string, expiresInSec: number, now: Date): string;

  /**
   * A URL that removes this object.
   *
   * Only ever used on an upload that failed verification. An object we refused
   * still costs storage, still lands in the backup, and still has to be
   * explained to whoever reads a bucket listing later.
   */
  presignDelete(key: string, expiresInSec: number, now: Date): string;
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
    return this.presign("GET", key, expiresInSec, now, {});
  }

  presignPut(
    key: string,
    expiresInSec: number,
    now: Date,
    constraints: UploadConstraints,
  ): string {
    return this.presign("PUT", key, expiresInSec, now, {
      "content-length": String(constraints.contentLength),
      "content-type": constraints.contentType,
    });
  }

  presignHead(key: string, expiresInSec: number, now: Date): string {
    return this.presign("HEAD", key, expiresInSec, now, {});
  }

  presignDelete(key: string, expiresInSec: number, now: Date): string {
    return this.presign("DELETE", key, expiresInSec, now, {});
  }

  /**
   * The one implementation of SigV4 query signing.
   *
   * Every method goes through here rather than each growing its own copy: the
   * canonical request is the part that is easy to get subtly wrong, and a
   * second copy of it would be tested against the first rather than against
   * AWS's vector.
   *
   * `extraHeaders` are additional **signed** headers. `host` is always signed —
   * it is what stops a signature minted for our bucket being replayed against
   * another endpoint.
   */
  private presign(
    method: "GET" | "PUT" | "HEAD" | "DELETE",
    key: string,
    expiresInSec: number,
    now: Date,
    extraHeaders: Readonly<Record<string, string>>,
  ): string {
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

    // Header names lower-cased and sorted, values trimmed — SigV4's canonical
    // form. Built from a map rather than a string so a caller cannot supply an
    // out-of-order pair that signs cleanly here and fails at the bucket.
    const headers = new Map<string, string>([["host", host]]);
    for (const [name, value] of Object.entries(extraHeaders)) {
      headers.set(name.toLowerCase(), value.trim());
    }
    const names = [...headers.keys()].sort();
    const signedHeaders = names.join(";");
    const canonicalHeaders = names
      .map((name) => `${name}:${headers.get(name)}\n`)
      .join("");

    // Sorted by key, as SigV4 requires — object literal order is not a
    // guarantee anyone should lean on for a signature.
    const query = new URLSearchParams([
      ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
      ["X-Amz-Credential", `${this.config.accessKeyId}/${scope}`],
      ["X-Amz-Date", amzDate],
      ["X-Amz-Expires", String(expiresInSec)],
      ["X-Amz-SignedHeaders", signedHeaders],
    ]);
    query.sort();

    const canonicalRequest = [
      method,
      canonicalUri,
      query.toString(),
      canonicalHeaders,
      signedHeaders,
      // "UNSIGNED-PAYLOAD" is the documented value for a presigned request: the
      // signature covers the URL and the signed headers, not the body. For a
      // PUT that is what makes streaming a 700 MB file possible at all — a
      // signed payload would require hashing it first, on the client.
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
