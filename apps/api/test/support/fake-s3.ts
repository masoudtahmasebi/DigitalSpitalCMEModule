/**
 * An S3-compatible server that actually verifies the signature (P23-01).
 *
 * ## Why this exists rather than an assertion on the URL
 *
 * A presigned URL is only correct if a bucket agrees with it, and every way of
 * getting SigV4 wrong produces a URL that looks perfect and returns 403. The
 * existing `s3-presigner.test.ts` pins the GET path to AWS's published vector,
 * which is the right check for the arithmetic — but the upload path adds two
 * things that vector cannot cover: a different HTTP method, and **signed
 * headers**. A canonical request that lists `content-type` in `SignedHeaders`
 * and forgets it in the canonical headers is self-consistent, deterministic,
 * and rejected by every real bucket.
 *
 * So this verifies the way a bucket does: from the request that arrived. It
 * reads the signed-header *names* out of the query string and takes their
 * values from the actual HTTP headers, reconstructs the canonical request from
 * the raw request line, and recomputes. Nothing here consults the presigner's
 * configuration or its code, which is what makes disagreement meaningful.
 *
 * It is deliberately strict and deliberately small: it implements exactly the
 * four operations the platform performs, refuses everything else, and keeps
 * objects in a Map. It is not a MinIO replacement — it is the part of a bucket
 * that can tell us we are wrong.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface FakeS3Object {
  readonly body: Buffer;
  readonly contentType: string;
}

export interface FakeS3 {
  /** `http://127.0.0.1:<port>` — pass as `S3_ENDPOINT`. */
  readonly endpoint: string;
  readonly bucket: string;
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** Objects by key, without the bucket prefix. */
  readonly objects: Map<string, FakeS3Object>;
  /** Every request that arrived, in order, whether or not it verified. */
  readonly requests: readonly FakeS3Request[];
  close(): Promise<void>;
}

export interface FakeS3Request {
  readonly method: string;
  readonly key: string;
  readonly status: number;
  /** Why a request was refused. `undefined` when it succeeded. */
  readonly refusal?: string;
}

const CREDENTIALS = {
  region: "eu-central-1",
  bucket: "ds-test-bucket",
  accessKeyId: "DSTESTACCESSKEY",
  /**
   * Deliberately low-entropy and self-describing.
   *
   * The first version of this was a base64 blob, which is *correct* as a
   * signing key and reads exactly like a stolen credential — gitleaks failed
   * the build on it, and it was right to. A secret scanner cannot know that a
   * high-entropy string in a test fixture is harmless, and the honest fix is
   * not to teach it an exception: it is to stop writing values that look like
   * credentials. SigV4 takes any string, so nothing is lost.
   */
  secretAccessKey: "example-not-a-real-secret-for-tests-only",
};

/**
 * Start the server on an ephemeral port.
 *
 * Path-style addressing only, which is what the platform configures
 * (`S3_FORCE_PATH_STYLE=yes`): virtual-hosted style would need the bucket in
 * the hostname, and `bucket.127.0.0.1` does not resolve.
 */
export async function startFakeS3(): Promise<FakeS3> {
  const objects = new Map<string, FakeS3Object>();
  const requests: FakeS3Request[] = [];

  const server: Server = createServer((request, response) => {
    const record = (status: number, key: string, refusal?: string): void => {
      requests.push(
        refusal === undefined
          ? { method: request.method ?? "", key, status }
          : { method: request.method ?? "", key, status, refusal },
      );
      response.statusCode = status;
    };

    const rawPath = (request.url ?? "").split("?")[0] ?? "";
    const query = new URLSearchParams((request.url ?? "").split("?")[1] ?? "");
    const prefix = `/${CREDENTIALS.bucket}/`;
    const key = rawPath.startsWith(prefix)
      ? decodeURIComponent(rawPath.slice(prefix.length))
      : "";

    // `ListObjectsV2` addresses the bucket itself, so an empty key is only
    // legitimate for a listing.
    const listing = key === "" && query.get("list-type") === "2";

    if (key === "" && !listing) {
      record(400, rawPath, "not addressed to the bucket");
      response.end();
      return;
    }

    const refusal = verify(request);
    if (refusal !== undefined) {
      record(403, key, refusal);
      response.end();
      return;
    }

    if (listing) {
      // Enough of the real answer to exercise the caller: keys, XML-escaped,
      // and a continuation token when the page is full. `max-keys` is honoured
      // so a test can force pagination without creating a thousand objects.
      const wanted = query.get("prefix") ?? "";
      const after = query.get("continuation-token") ?? "";
      const maxKeys = Number(query.get("max-keys") ?? "1000");

      const all = [...objects.keys()].filter((k) => k.startsWith(wanted)).sort();
      const start = after === "" ? 0 : all.indexOf(after) + 1;
      const page = all.slice(start, start + maxKeys);
      const truncated = start + page.length < all.length;

      response.setHeader("content-type", "application/xml");
      record(200, wanted);
      response.end(
        `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult>` +
          page.map((k) => `<Contents><Key>${escapeXml(k)}</Key></Contents>`).join("") +
          `<IsTruncated>${truncated}</IsTruncated>` +
          (truncated
            ? `<NextContinuationToken>${escapeXml(page.at(-1) ?? "")}</NextContinuationToken>`
            : "") +
          `</ListBucketResult>`,
      );
      return;
    }

    switch (request.method) {
      case "PUT": {
        const copySource = request.headers["x-amz-copy-source"];
        if (typeof copySource === "string") {
          // `/bucket/key`. Only this bucket, as a real store would only allow
          // buckets the credential can read.
          const sourceKey = decodeURIComponent(
            copySource.replace(new RegExp(`^/${CREDENTIALS.bucket}/`), ""),
          );
          const source = objects.get(sourceKey);
          response.setHeader("content-type", "application/xml");
          if (source === undefined) {
            // The trap this fake exists to reproduce: S3 answers a failed copy
            // with **200** and an error document, so a caller checking only the
            // status records a copy that did not happen.
            record(200, sourceKey, "copy source does not exist");
            response.end(
              `<?xml version="1.0" encoding="UTF-8"?><Error><Code>NoSuchKey</Code></Error>`,
            );
            return;
          }
          objects.set(key, source);
          record(200, key);
          response.end(
            `<?xml version="1.0" encoding="UTF-8"?><CopyObjectResult><ETag>"x"</ETag></CopyObjectResult>`,
          );
          return;
        }

        const chunks: Buffer[] = [];
        request.on("data", (chunk: Buffer) => chunks.push(chunk));
        request.on("end", () => {
          objects.set(key, {
            body: Buffer.concat(chunks),
            // S3 stores the request's content type as object metadata. That is
            // the whole reason binding it into the signature is worth anything.
            contentType: String(request.headers["content-type"] ?? ""),
          });
          record(200, key);
          response.end();
        });
        return;
      }
      case "HEAD":
      case "GET": {
        const object = objects.get(key);
        if (object === undefined) {
          record(404, key, "no such object");
          response.end();
          return;
        }
        response.setHeader("content-type", object.contentType);
        response.setHeader("content-length", String(object.body.byteLength));
        record(200, key);
        response.end(request.method === "HEAD" ? undefined : object.body);
        return;
      }
      case "DELETE": {
        objects.delete(key);
        record(204, key);
        response.end();
        return;
      }
      default: {
        record(405, key, `method ${request.method} is not implemented`);
        response.end();
      }
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    endpoint: `http://127.0.0.1:${port}`,
    ...CREDENTIALS,
    objects,
    requests,
    // Idempotent, because a test that closes the bucket to prove the API
    // survives an outage still runs its `afterEach`. A second close reporting
    // "Server is not running" would fail the test that just passed.
    close: () =>
      new Promise<void>((resolve, reject) => {
        if (!server.listening) return resolve();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

/**
 * Recompute the signature from the request that arrived, and compare.
 *
 * Written from the SigV4 specification rather than from `s3-presigner.ts`: it
 * starts at the raw request line and the actual headers, which is the only
 * vantage point from which "the presigner and the bucket disagree" is
 * observable at all.
 */
function verify(request: IncomingMessage): string | undefined {
  const [rawPath = "", rawQuery = ""] = (request.url ?? "").split("?");

  // Sorting the raw `key=value` pairs is the canonical query string, and doing
  // it on the raw text rather than through URLSearchParams keeps the exact
  // percent-encoding the client sent — which is what the client signed.
  const pairs = rawQuery.split("&").filter((pair) => pair !== "");
  const parameters = new Map<string, string>();
  for (const pair of pairs) {
    const [name = "", value = ""] = pair.split("=");
    parameters.set(decodeURIComponent(name), decodeURIComponent(value));
  }

  const supplied = parameters.get("X-Amz-Signature");
  if (supplied === undefined) return "no X-Amz-Signature";
  if (parameters.get("X-Amz-Algorithm") !== "AWS4-HMAC-SHA256") {
    return "unsupported algorithm";
  }

  const signedHeaderNames = (parameters.get("X-Amz-SignedHeaders") ?? "").split(";");
  if (!signedHeaderNames.includes("host")) return "host is not signed";

  // The values come from the request, not from anything the client claimed in
  // the query string. A header named in `SignedHeaders` and absent from the
  // request is a mismatch, exactly as it is at a real bucket.
  const canonicalHeaders = signedHeaderNames
    .map((name) => `${name}:${String(request.headers[name] ?? "").trim()}\n`)
    .join("");

  const canonicalQuery = pairs
    .filter((pair) => !pair.startsWith("X-Amz-Signature="))
    .sort()
    .join("&");

  const canonicalRequest = [
    request.method ?? "",
    rawPath,
    canonicalQuery,
    canonicalHeaders,
    signedHeaderNames.join(";"),
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const amzDate = parameters.get("X-Amz-Date") ?? "";
  const scope = `${amzDate.slice(0, 8)}/${CREDENTIALS.region}/s3/aws4_request`;

  if (parameters.get("X-Amz-Credential") !== `${CREDENTIALS.accessKeyId}/${scope}`) {
    return "credential scope does not match";
  }

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    createHash("sha256").update(canonicalRequest, "utf8").digest("hex"),
  ].join("\n");

  let key = Buffer.from(`AWS4${CREDENTIALS.secretAccessKey}`, "utf8");
  for (const part of [amzDate.slice(0, 8), CREDENTIALS.region, "s3", "aws4_request"]) {
    key = createHmac("sha256", key).update(part, "utf8").digest();
  }
  const expected = createHmac("sha256", key).update(stringToSign, "utf8").digest("hex");

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(supplied, "utf8");
  if (a.byteLength !== b.byteLength || !timingSafeEqual(a, b)) {
    return "signature does not match";
  }

  return undefined;
}

/** The five entities S3 escapes in a key, on the way out of a listing. */
function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
