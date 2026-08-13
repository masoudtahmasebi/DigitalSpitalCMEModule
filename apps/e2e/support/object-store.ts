/**
 * An S3-compatible bucket, in the harness, that actually checks the signature
 * (P68-02).
 *
 * ## Why this exists rather than a skipped step
 *
 * The client's report on 12.08 was *"the video upload to s3 does not even
 * work!"*, and every gate was green. It was green because there is no object
 * storage on a developer's machine and none in CI, so the upload path had no
 * test that ran anywhere — the browser suite stopped before it and the
 * integration suites cannot reach it, because the bytes deliberately never go
 * through the API.
 *
 * The obvious answer is to skip the upload locally and cover it only in the
 * post-deploy run. That is worse than it looks: it makes the one step that
 * broke the step nobody exercises while writing the code, which is exactly the
 * shape CLAUDE.md §9.1 names — *the check is not run where the work happens*.
 *
 * So the harness stands up a bucket. Not a stub that accepts everything: a
 * bucket that verifies the SigV4 query signature, enforces the signed headers,
 * enforces the expiry, and answers CORS only once something has configured it
 * — the way a real bucket does. An upload that would 403 against Hetzner 403s
 * here, and one Hetzner's CORS rule would block is blocked here.
 *
 * ## Why the verifier is written out rather than imported
 *
 * `S3Presigner` could export a `verify` and this file could call it. Then a bug
 * in the canonical request would be present on both sides and cancel out, and
 * the test would prove the presigner agrees with itself. The same argument
 * `support/staff.ts` makes about RFC 6238: an independent statement of the same
 * rule is the only version worth asserting against, and a disagreement between
 * the two is the finding.
 *
 * ## What it is not
 *
 * Not a general S3 implementation, and it must never grow into one. It knows
 * the five operations this platform performs — PUT, GET, HEAD, DELETE and the
 * `list-type=2` listing the backup uses — and answers anything else with 501,
 * loudly, so an unimplemented operation is a named failure rather than a
 * mysterious empty response.
 *
 * Objects live in memory and die with the process. Nothing here is durable,
 * nothing here is a security boundary, and it is never started outside a test.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { createServer } from "node:https";
import type { AddressInfo } from "node:net";
import { selfSignedLoopbackCertificate } from "./tls.js";

export interface StoredObject {
  readonly body: Buffer;
  readonly contentType: string;
}

export interface ObjectStore {
  /** `http://127.0.0.1:<port>` — what `S3_ENDPOINT` is set to. */
  readonly endpoint: string;
  readonly bucket: string;
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** Every key currently held, so a spec can assert the object landed. */
  keys(): readonly string[];
  get(key: string): StoredObject | undefined;
  /** Every request that was refused, and why — the failure message's material. */
  refusals(): readonly string[];
  /**
   * The origins the bucket currently allows, or `undefined` while it has no
   * CORS rule at all. `stack.ts` asserts on this so that "the deploy's applier
   * ran" is a stated fact rather than an inference from the upload working.
   */
  corsOrigins(): readonly string[] | undefined;
  /** The CA file the API must trust to HEAD an object it just approved. */
  readonly caFile: string;
  stop(): Promise<void>;
}

/**
 * Fixed, self-describing, and not a credential anywhere.
 *
 * P33-02 is the record of what a realistic-looking fixture costs when somebody
 * mistakes one for a real key. These are shaped like AWS credentials because
 * the code under test parses them as such, and named so that nobody could
 * think they open anything.
 */
export const STORE_ACCESS_KEY_ID = "e2e-not-a-real-access-key";
export const STORE_SECRET_ACCESS_KEY = "e2e-not-a-real-secret-key";
export const STORE_BUCKET = "ds-e2e";
export const STORE_REGION = "eu-central-1";

/**
 * Started over **TLS**, and that is not incidental.
 *
 * The portal's deployed policy is `media-src 'self' https:` — the scheme is
 * part of the rule. A bucket served over plain HTTP here would be blocked by
 * the very policy this suite now applies (`csp.ts`), and the honest way to run
 * under the real policy is to be the kind of origin it allows rather than to
 * edit the policy for the test.
 *
 * The certificate is generated per run and trusted by exactly two parties: the
 * API, through `NODE_EXTRA_CA_CERTS`, and the browser, through
 * `ignoreHTTPSErrors`. Neither of those affects how the CSP is evaluated, which
 * is the property under test.
 */
export async function startObjectStore(): Promise<ObjectStore> {
  const objects = new Map<string, StoredObject>();
  const refusals: string[] = [];
  // A box rather than a plain `let`, so `handle` can write it back — the bucket
  // is unconfigured until something calls `PutBucketCors`, which is the state a
  // real bucket is created in.
  const bucketCors: { current: BucketCors | undefined } = { current: undefined };
  const certificate = selfSignedLoopbackCertificate();

  const server: Server = createServer(
    { key: certificate.key, cert: certificate.cert },
    (request, response) => {
      void handle(request, response, objects, refusals, bucketCors);
    },
  );

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    endpoint: `https://127.0.0.1:${port}`,
    caFile: certificate.caFile,
    bucket: STORE_BUCKET,
    region: STORE_REGION,
    accessKeyId: STORE_ACCESS_KEY_ID,
    secretAccessKey: STORE_SECRET_ACCESS_KEY,
    keys: () => [...objects.keys()],
    get: (key) => objects.get(key),
    refusals: () => [...refusals],
    corsOrigins: () => bucketCors.current?.origins,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/**
 * The bucket starts with **no CORS configuration**, exactly as a new one does
 * (P70-01).
 *
 * ## Why the harness used to allow everything, and why that was the bug
 *
 * This file previously answered every preflight with a fixed permissive list.
 * That made the sixteen browser tests green while production's bucket refused
 * every upload the console attempted — the harness modelled a bucket somebody
 * had already configured, and configuring it was the step nobody had done. A
 * fixture that assumes the missing setting is present is a fixture that cannot
 * find the missing setting (CLAUDE.md §9.1, third form).
 *
 * So the rule now has to be applied, by the same `dist/bucket-cors.js` the
 * deploy runs — see `stack.ts`. Delete that call and the journey fails at the
 * upload, which is what makes it evidence.
 */
interface BucketCors {
  readonly origins: readonly string[];
  readonly methods: readonly string[];
  readonly headers: readonly string[];
  readonly maxAgeSeconds: number;
}

/**
 * What the harness answers a preflight with, given what has been configured.
 *
 * Written as the browser reads it: an origin that is not on the list gets *no*
 * `Access-Control-Allow-Origin`, not an empty one, because that is the wire
 * behaviour the browser turns into "blocked by CORS policy".
 */
function preflightHeaders(
  cors: BucketCors | undefined,
  origin: string,
): Record<string, string> | undefined {
  if (cors === undefined) return undefined;
  if (!cors.origins.includes(origin) && !cors.origins.includes("*")) return undefined;

  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": cors.methods.join(","),
    "access-control-allow-headers": cors.headers.join(","),
    "access-control-max-age": String(cors.maxAgeSeconds),
    // The browser reads the length off the response to a ranged GET, and
    // without this the player cannot tell how much it received.
    "access-control-expose-headers": "content-length,content-range,etag",
  };
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  objects: Map<string, StoredObject>,
  refusals: string[],
  bucketCors: { current: BucketCors | undefined },
): Promise<void> {
  const origin = request.headers.origin;
  const allowed =
    origin === undefined ? undefined : preflightHeaders(bucketCors.current, origin);
  const cors: Record<string, string> = allowed ?? {};

  if (request.method === "OPTIONS") {
    if (allowed === undefined) {
      // 403 and no headers: Ceph's answer to a preflight it has no rule for,
      // and the shape the browser reports as "No 'Access-Control-Allow-Origin'
      // header is present on the requested resource."
      refuse(
        response,
        {},
        refusals,
        403,
        `preflight from ${origin ?? "no origin"}: the bucket has no CORS rule for it`,
      );
      return;
    }
    response.writeHead(204, allowed);
    response.end();
    return;
  }

  const url = new URL(
    request.url ?? "/",
    `http://${request.headers.host ?? "127.0.0.1"}`,
  );
  const path = decodeURIComponent(url.pathname);

  if (!path.startsWith(`/${STORE_BUCKET}`)) {
    refuse(response, cors, refusals, 404, `no such bucket in ${path}`);
    return;
  }
  const key = path.slice(`/${STORE_BUCKET}/`.length);

  const verdict = verifySignature(request, url, key);
  if (verdict !== "ok") {
    // 403 with no body, which is what a real bucket does for a bad signature
    // once the XML is stripped — and `uploadToTicket` shows the status, not the
    // body, so the harness matching S3's status is what matters.
    refuse(response, cors, refusals, 403, `${request.method} ${key}: ${verdict}`);
    return;
  }

  // `?cors` is a bucket subresource, so it is checked before the key-addressed
  // operations below — `key` is empty here and means the bucket itself.
  if (url.searchParams.has("cors")) {
    await bucketCorsSubresource(request, response, refusals, bucketCors);
    return;
  }

  switch (request.method) {
    case "PUT":
      await put(request, response, cors, objects, refusals, key);
      return;
    case "GET":
      if (url.searchParams.get("list-type") === "2") {
        list(response, cors, objects, url.searchParams.get("prefix") ?? "");
        return;
      }
      get(request, response, cors, objects, refusals, key, true);
      return;
    case "HEAD":
      get(request, response, cors, objects, refusals, key, false);
      return;
    case "DELETE":
      objects.delete(key);
      response.writeHead(204, cors);
      response.end();
      return;
    default:
      refuse(
        response,
        cors,
        refusals,
        501,
        `${request.method ?? "?"} is not implemented`,
      );
  }
}

/**
 * `PutBucketCors` and `GetBucketCors`, parsed rather than accepted.
 *
 * The parse is the assertion: a document whose `AllowedMethod` the harness
 * cannot find produces a bucket that still refuses `PUT`, so a malformed rule
 * fails at the upload rather than at the write — which is the order the real
 * bucket fails in too.
 */
async function bucketCorsSubresource(
  request: IncomingMessage,
  response: ServerResponse,
  refusals: string[],
  bucketCors: { current: BucketCors | undefined },
): Promise<void> {
  if (request.method === "GET") {
    if (bucketCors.current === undefined) {
      refuse(response, {}, refusals, 404, "the bucket has no CORS configuration");
      return;
    }
    response.writeHead(200, { "content-type": "application/xml" });
    response.end(
      `<?xml version="1.0" encoding="UTF-8"?><CORSConfiguration><CORSRule>` +
        bucketCors.current.origins
          .map((value) => `<AllowedOrigin>${escapeXml(value)}</AllowedOrigin>`)
          .join("") +
        `</CORSRule></CORSConfiguration>`,
    );
    return;
  }

  if (request.method !== "PUT") {
    refuse(response, {}, refusals, 501, `${request.method ?? "?"} ?cors`);
    return;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const body = Buffer.concat(chunks).toString("utf8");

  /*
   * `Content-MD5`, checked. Amazon requires it for this operation and Ceph does
   * not, so the platform sends it to satisfy both — and a harness that ignored
   * it would leave "we send a correct one" with nothing asserting it.
   */
  const declared = request.headers["content-md5"];
  if (typeof declared === "string") {
    const actual = createHash("md5").update(body, "utf8").digest("base64");
    if (declared !== actual) {
      refuse(response, {}, refusals, 400, `?cors: Content-MD5 ${declared} ≠ ${actual}`);
      return;
    }
  }

  const tags = (name: string): string[] =>
    [...body.matchAll(new RegExp(`<${name}>([^<]*)</${name}>`, "gu"))].map(
      (match) => match[1] ?? "",
    );

  const origins = tags("AllowedOrigin");
  const methods = tags("AllowedMethod");
  if (origins.length === 0 || methods.length === 0) {
    refuse(response, {}, refusals, 400, "?cors: no AllowedOrigin or no AllowedMethod");
    return;
  }

  bucketCors.current = {
    origins,
    methods,
    headers: tags("AllowedHeader"),
    maxAgeSeconds: Number(tags("MaxAgeSeconds")[0] ?? "0"),
  };
  response.writeHead(200);
  response.end();
}

function refuse(
  response: ServerResponse,
  cors: Record<string, string>,
  refusals: string[],
  status: number,
  why: string,
): void {
  refusals.push(`${status} — ${why}`);
  response.writeHead(status, cors);
  response.end();
}

async function put(
  request: IncomingMessage,
  response: ServerResponse,
  cors: Record<string, string>,
  objects: Map<string, StoredObject>,
  refusals: string[],
  key: string,
): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const body = Buffer.concat(chunks);

  /*
   * The signed length is enforced, not merely signed.
   *
   * `object-storage.ts` says in its own header that "not every S3-compatible
   * implementation enforces a signed content-length with the same rigour",
   * which is why `verifyUpload` HEADs afterwards. A harness that stored
   * whatever arrived would make that HEAD a formality and the assertion behind
   * it untestable — so this one is strict, and the API's belt-and-braces check
   * has something to agree with.
   */
  const declared = request.headers["content-length"];
  if (declared !== undefined && Number(declared) !== body.length) {
    refuse(
      response,
      cors,
      refusals,
      400,
      `${key}: declared ${declared}, got ${body.length}`,
    );
    return;
  }

  objects.set(key, {
    body,
    contentType: String(request.headers["content-type"] ?? "application/octet-stream"),
  });
  response.writeHead(200, {
    ...cors,
    etag: `"${createHash("md5").update(body).digest("hex")}"`,
  });
  response.end();
}

/**
 * A GET or a HEAD, with Range — which the video player is not optional about.
 *
 * Chromium requests media with `Range: bytes=0-` and expects **206** with a
 * `Content-Range`. A server that answers 200 to a ranged request produces a
 * video that plays once and cannot be seeked, and `python -m http.server` doing
 * exactly that cost an afternoon in QA §9. The player is the point of this
 * suite, so the harness serves ranges properly.
 */
function get(
  request: IncomingMessage,
  response: ServerResponse,
  cors: Record<string, string>,
  objects: Map<string, StoredObject>,
  refusals: string[],
  key: string,
  withBody: boolean,
): void {
  const object = objects.get(key);
  if (object === undefined) {
    refuse(response, cors, refusals, 404, `${key} is not in the bucket`);
    return;
  }

  const range = /^bytes=(\d*)-(\d*)$/u.exec(request.headers.range ?? "");
  const headers: Record<string, string> = {
    ...cors,
    "content-type": object.contentType,
    "accept-ranges": "bytes",
  };

  if (range === null) {
    headers["content-length"] = String(object.body.length);
    response.writeHead(200, headers);
    response.end(withBody ? object.body : undefined);
    return;
  }

  const from = range[1] === "" ? 0 : Number(range[1]);
  const to = range[2] === "" ? object.body.length - 1 : Number(range[2]);
  if (from > to || to >= object.body.length) {
    refuse(
      response,
      cors,
      refusals,
      416,
      `${key}: range ${from}-${to} of ${object.body.length}`,
    );
    return;
  }

  const slice = object.body.subarray(from, to + 1);
  headers["content-length"] = String(slice.length);
  headers["content-range"] = `bytes ${from}-${to}/${object.body.length}`;
  response.writeHead(206, headers);
  response.end(withBody ? slice : undefined);
}

/** `ListObjectsV2`, in the shape the backup's parser reads. */
function list(
  response: ServerResponse,
  cors: Record<string, string>,
  objects: Map<string, StoredObject>,
  prefix: string,
): void {
  const contents = [...objects.entries()]
    .filter(([key]) => key.startsWith(prefix))
    .map(
      ([key, object]) =>
        `<Contents><Key>${escapeXml(key)}</Key><Size>${object.body.length}</Size></Contents>`,
    )
    .join("");

  const body =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<ListBucketResult><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`;

  response.writeHead(200, { ...cors, "content-type": "application/xml" });
  response.end(body);
}

function escapeXml(value: string): string {
  return value.replace(
    /[<>&]/gu,
    (character) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[character] ?? character,
  );
}

/**
 * SigV4 query signing, verified — an independent re-derivation, deliberately.
 *
 * Returns `"ok"` or the sentence explaining the refusal, because a 403 with no
 * explanation is what makes a signing bug take an afternoon. The sentence goes
 * into `refusals()`, which the spec prints when the upload step fails.
 */
function verifySignature(request: IncomingMessage, url: URL, key: string): string {
  const query = url.searchParams;
  const presented = query.get("X-Amz-Signature");
  if (presented === null) return "no X-Amz-Signature on the request";

  const amzDate = query.get("X-Amz-Date");
  const credential = query.get("X-Amz-Credential");
  const expires = query.get("X-Amz-Expires");
  const signedHeaders = query.get("X-Amz-SignedHeaders");
  if (
    amzDate === null ||
    credential === null ||
    expires === null ||
    signedHeaders === null
  ) {
    return "the request is missing one of X-Amz-Date, -Credential, -Expires, -SignedHeaders";
  }

  const [accessKeyId, dateStamp, region] = credential.split("/");
  if (accessKeyId !== STORE_ACCESS_KEY_ID)
    return `unknown access key ${String(accessKeyId)}`;
  if (region !== STORE_REGION)
    return `signed for region ${String(region)}, not ${STORE_REGION}`;

  /*
   * The expiry, enforced.
   *
   * A presigned URL is a capability with an expiry, and "with an expiry" is
   * only true if something checks. `S3_UPLOAD_TTL_SEC` exists to bound how long
   * a copied URL keeps working, and a harness that ignored it would leave that
   * bound with no test at all.
   */
  const signedAt = Date.parse(
    `${amzDate.slice(0, 4)}-${amzDate.slice(4, 6)}-${amzDate.slice(6, 8)}T` +
      `${amzDate.slice(9, 11)}:${amzDate.slice(11, 13)}:${amzDate.slice(13, 15)}Z`,
  );
  if (Number.isNaN(signedAt)) return `X-Amz-Date is not a date: ${amzDate}`;
  if (Date.now() > signedAt + Number(expires) * 1000) {
    return `the signature expired ${Math.round((Date.now() - signedAt) / 1000 - Number(expires))}s ago`;
  }

  // The canonical query string is every parameter except the signature itself,
  // sorted — the same set the presigner had before it appended its result.
  const canonicalQuery = new URLSearchParams(query);
  canonicalQuery.delete("X-Amz-Signature");
  canonicalQuery.sort();

  const names = signedHeaders.split(";");
  const canonicalHeaders = names
    .map((name) => `${name}:${String(request.headers[name] ?? "").trim()}\n`)
    .join("");

  // Re-encoded rather than taken from `url.pathname`: the presigner escapes
  // `!'()*` that `encodeURI` leaves alone, and a mismatch there is exactly the
  // subtle failure this verifier exists to detect.
  const canonicalUri = `/${encodeKey(STORE_BUCKET)}/${encodeKey(key)}`;

  const canonicalRequest = [
    request.method ?? "GET",
    canonicalUri,
    canonicalQuery.toString(),
    canonicalHeaders,
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const scope = `${String(dateStamp)}/${STORE_REGION}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    createHash("sha256").update(canonicalRequest, "utf8").digest("hex"),
  ].join("\n");

  let signingKey = Buffer.from(`AWS4${STORE_SECRET_ACCESS_KEY}`, "utf8");
  for (const part of [String(dateStamp), STORE_REGION, "s3", "aws4_request"]) {
    signingKey = createHmac("sha256", signingKey).update(part, "utf8").digest();
  }
  const expected = createHmac("sha256", signingKey)
    .update(stringToSign, "utf8")
    .digest("hex");

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(presented, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    // The canonical request, not the signature, because the signature says
    // nothing and the canonical request says which byte differs. Only the
    // harness ever sees this.
    return `signature mismatch over:\n${canonicalRequest.replace(/\n/gu, "\\n")}`;
  }

  return "ok";
}

/** `encodeKey` from `s3-presigner.ts`, restated — see the header for why. */
function encodeKey(key: string): string {
  return key
    .split("/")
    .map((segment) =>
      encodeURIComponent(segment).replace(
        /[!'()*]/gu,
        (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join("/");
}
