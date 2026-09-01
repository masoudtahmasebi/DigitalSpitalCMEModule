/**
 * The bucket's CORS rule: applied by the deploy, and then proved (P70-01).
 * Infrastructure — ADR-0006.
 *
 * ## The failure this exists to end
 *
 * The console mints an upload ticket from the API and then PUTs the bytes
 * straight to the bucket, which is a cross-origin request to a host that is not
 * ours. A browser will not make it unless the bucket says so, in a preflight
 * the bucket answers on its own — the API is not in that conversation and never
 * learns it happened.
 *
 * So a bucket without a CORS rule produces the exact defect the client reported
 * twice: the upload button works, the ticket is minted, the API log is clean,
 * and nothing arrives. `infra/deploy/config.env.example` has carried the rule
 * to paste since P23-04, under the heading *"Bucket configuration you have to
 * do once, by hand"*, and nobody ever did it — which is CLAUDE.md §9.9's
 * corollary in one line: **a setting that exists in the repository exists on
 * the installation only if somebody ran it.**
 *
 * ## Applying is the convenience; the preflight is the evidence
 *
 * `applyBucketCors` writes the rule. `probePreflight` then asks the bucket the
 * question a browser asks — an unsigned `OPTIONS` carrying `Origin` and
 * `Access-Control-Request-Method` — and reads the answer.
 *
 * The second one is the one that matters, and the split is deliberate. A write
 * that returns 200 proves the request was accepted, not that the effect is what
 * the browser needs; the preflight is the browser's own question, asked with no
 * credentials, so it cannot be green for a reason the browser would not share.
 * That is §9.1: a check whose subject is the real behaviour, not our belief
 * about it. If Hetzner ever refuses `PutBucketCors`, the probe still goes red
 * and the deploy still says what to paste.
 *
 * ## What the rule allows, and what it deliberately does not
 *
 * `PUT` only, from the console's origin only. The learner's browser fetches
 * media as a plain navigation with a signed URL, which is not a CORS request at
 * all, and the customers' own sites that may embed the widget have no business
 * writing to the bucket — `EXTRA_CORS_ORIGINS`/`projects.embed_origins` is a
 * different list for a different question, and unioning the two here would hand
 * every embedding site a write path.
 *
 * `GET` was added in P74-02, and the paragraph that predicted it is worth
 * keeping because it is what made this a one-line change rather than a
 * fortnight of "the length button does nothing":
 *
 * > `media-duration.ts` reads a video's length in the console with
 * > `crossOrigin = "anonymous"`, which is a CORS `GET` — and it does not need
 * > this rule today only because `probeableSourceUrl` skips `s3://` references,
 * > so an uploaded video is never probed. Whoever gives the console a readable
 * > URL after an upload must add `GET` here, or the length field will silently
 * > go back to being typed by hand — which is the accreditation defect
 * > `media-duration.ts` exists to prevent.
 *
 * It is still a **read** of one object with a signature the API minted, from
 * the console's own origin. It is not a way for anybody else's page to read the
 * bucket: without a signature the object answers 403 whatever CORS says, and
 * the origin list is still exactly the console.
 *
 * ## Deadlines (P144-01)
 *
 * These run during a deploy, against a bucket the host may not be able to
 * reach — P70-02 is the record of exactly that lasting months. A bare `fetch`
 * here does not fail the deploy, it stops it, with the last line printed being
 * whatever came before. The default carries a deadline so the deploy says
 * "the bucket did not answer" instead of appearing to still be working.
 */

import { joinUrl } from "@ds/domain";
import { withDeadline } from "./deadline-fetch.js";
import { createHash } from "node:crypto";

/**
 * The subset of `S3Presigner` this module needs.
 *
 * Narrow on purpose, the same way `ReadPresigner` is: nothing here can be
 * handed something that also signs object writes, so a mistake in this file
 * cannot become one.
 */
export interface BucketCorsPresigner {
  presignBucketCors(
    method: "GET" | "PUT",
    expiresInSec: number,
    now: Date,
    contentMd5?: string,
  ): string;
}

export interface BucketCorsRule {
  /** Exact origins, scheme and host. Never `*` — see the header. */
  readonly origins: readonly string[];
  readonly methods: readonly string[];
  readonly headers: readonly string[];
  readonly maxAgeSeconds: number;
}

/**
 * What the console needs, and nothing else.
 *
 * `PUT` to upload, `GET` to look at what was uploaded and to read a video's
 * own length (P74-02) — the second one is a compliance input, because the watch
 * gate is a percentage of `durationSec`.
 *
 * `content-type` is the only header the browser preflights: `content-length` is
 * signed too, but a browser computes it and forbids script from setting it, so
 * it never appears in `Access-Control-Request-Headers`. Listing it here would
 * be harmless and misleading — it would suggest the client may choose it.
 */
export function consoleUploadRule(origins: readonly string[]): BucketCorsRule {
  return {
    origins,
    methods: ["PUT", "GET"],
    headers: ["content-type"],
    maxAgeSeconds: 3000,
  };
}

/**
 * The `CORSConfiguration` document, escaped.
 *
 * The escaping is not decoration. An origin arrives from `BASE_DOMAIN` in a
 * config file, and a value that closes a tag would write a different rule than
 * the one this function was asked for — a configuration-injection in the one
 * document that decides who may write to the bucket.
 */
export function corsConfigurationXml(rule: BucketCorsRule): string {
  const parts = [
    ...rule.origins.map(
      (origin) => `<AllowedOrigin>${escapeXml(origin)}</AllowedOrigin>`,
    ),
    ...rule.methods.map(
      (method) => `<AllowedMethod>${escapeXml(method)}</AllowedMethod>`,
    ),
    ...rule.headers.map(
      (header) => `<AllowedHeader>${escapeXml(header)}</AllowedHeader>`,
    ),
    `<MaxAgeSeconds>${String(Math.trunc(rule.maxAgeSeconds))}</MaxAgeSeconds>`,
  ].join("");

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<CORSConfiguration><CORSRule>${parts}</CORSRule></CORSConfiguration>`
  );
}

/** Base64 MD5, which is what `Content-MD5` is defined to be (RFC 1864). */
export function contentMd5(body: string): string {
  // MD5 here is an integrity check-sum the S3 API defines, not a security
  // primitive: the request's authenticity comes from the SigV4 signature over
  // it, and the algorithm is not ours to choose.
  return createHash("md5").update(body, "utf8").digest("base64");
}

/**
 * Every layer of a failed `fetch`, because the top one says nothing (P70-02).
 *
 * Node's `fetch` reports **"fetch failed"** for a DNS failure, a refused
 * connection, an unreachable network and a certificate it does not trust
 * alike. The reason is one level down, in `cause`, and sometimes two.
 *
 * This is not a detail. The deploy's first run of `bucket-cors.js` printed
 * `Could not reach the bucket … fetch failed`, which named the symptom of four
 * quite different problems and pointed at none of them. The actual cause was
 * that the API container is on a Docker network with no gateway — a sentence
 * `EAI_AGAIN nbg1.your-objectstorage.com` would have led to in a minute.
 *
 * CLAUDE.md §9.4, in the diagnostic written to satisfy §9.4: say what the thing
 * is, in the words of the person holding it.
 */
export function describeFetchFailure(error: unknown): string {
  const layers: string[] = [];
  let current: unknown = error;

  // Bounded: `cause` chains are short in practice, and a cycle must not hang a
  // deploy step whose whole job is to report a failure.
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    const code = (current as { code?: unknown }).code;
    layers.push(
      typeof code === "string" ? `${current.message} (${code})` : current.message,
    );
    current = current.cause;
  }

  return layers.length === 0 ? "unknown error" : layers.join(" — ");
}

export type ApplyResult =
  | { readonly kind: "applied" }
  | { readonly kind: "refused"; readonly status: number; readonly body: string }
  | { readonly kind: "unreachable"; readonly reason: string };

export async function applyBucketCors(
  presigner: BucketCorsPresigner,
  rule: BucketCorsRule,
  now: Date,
  fetchImpl: typeof fetch = withDeadline(),
): Promise<ApplyResult> {
  const body = corsConfigurationXml(rule);
  const md5 = contentMd5(body);

  try {
    const response = await fetchImpl(presigner.presignBucketCors("PUT", 300, now, md5), {
      method: "PUT",
      headers: { "content-md5": md5, "content-type": "application/xml" },
      body,
    });

    if (!response.ok) {
      return {
        kind: "refused",
        status: response.status,
        // Bounded: an S3 error document is small, but a misdirected request can
        // land on an HTML page, and this string is printed in a deploy log.
        body: (await response.text()).slice(0, 500),
      };
    }
    return { kind: "applied" };
  } catch (error) {
    return { kind: "unreachable", reason: describeFetchFailure(error) };
  }
}

export type PreflightVerdict =
  | { readonly kind: "allowed" }
  /** The bucket answered, and the answer does not let the browser proceed. */
  | { readonly kind: "refused"; readonly why: string }
  | { readonly kind: "unreachable"; readonly reason: string };

/**
 * The browser's own question, asked without credentials.
 *
 * The key does not have to exist: a preflight is answered by the bucket's CORS
 * handler before any object is looked up, which is why this can probe a name
 * nothing will ever write.
 */
export async function probePreflight(
  endpoint: string,
  bucket: string,
  origin: string,
  method: string,
  fetchImpl: typeof fetch = withDeadline(),
): Promise<PreflightVerdict> {
  const url = joinUrl(endpoint, `${bucket}/ds-cors-preflight-probe`);

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "OPTIONS",
      headers: {
        origin,
        "access-control-request-method": method,
        "access-control-request-headers": "content-type",
      },
    });
  } catch (error) {
    return { kind: "unreachable", reason: describeFetchFailure(error) };
  }

  const allowedOrigin = response.headers.get("access-control-allow-origin");
  if (allowedOrigin === null) {
    return {
      kind: "refused",
      why: `the bucket answered ${String(response.status)} with no Access-Control-Allow-Origin, so the browser stops here`,
    };
  }
  if (allowedOrigin !== "*" && allowedOrigin !== origin) {
    return {
      kind: "refused",
      why: `the bucket allows ${allowedOrigin}, not ${origin}`,
    };
  }

  // A missing `Access-Control-Allow-Methods` on a preflight response is a
  // refusal, not a permission: the browser has asked whether this method is
  // allowed and been told nothing.
  const allowedMethods = response.headers.get("access-control-allow-methods") ?? "";
  const methods = allowedMethods.split(",").map((value) => value.trim().toUpperCase());
  if (!methods.includes(method.toUpperCase())) {
    return {
      kind: "refused",
      why:
        allowedMethods === ""
          ? `the bucket allows the origin but names no methods, so ${method} is not permitted`
          : `the bucket allows ${allowedMethods}, not ${method}`,
    };
  }

  return { kind: "allowed" };
}

function escapeXml(value: string): string {
  return value.replace(
    /[<>&"']/gu,
    (character) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[character] ?? character,
  );
}
