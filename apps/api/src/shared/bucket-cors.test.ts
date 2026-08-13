/**
 * The bucket's CORS rule, and the probe that is the actual evidence (P70-01).
 *
 * The interesting assertions are the negative ones. `probePreflight` exists
 * because a bucket that answers 200 and says nothing about the origin is
 * indistinguishable, from the API's side, from a bucket that is configured —
 * and it was that state on production for months. So the cases below are the
 * ways a bucket can answer while still refusing the browser: no header at all,
 * a different origin, the origin but no methods, the origin and the wrong
 * method. Each has to be a refusal, or the check cannot go red where it matters
 * (CLAUDE.md §9.1).
 */

import { describe, expect, it } from "vitest";
import {
  applyBucketCors,
  consoleUploadRule,
  contentMd5,
  corsConfigurationXml,
  describeFetchFailure,
  probePreflight,
} from "./bucket-cors.js";

const ORIGIN = "https://verwaltung.example.de";

/** A `fetch` that answers with these headers and records what it was asked. */
function answering(
  status: number,
  headers: Record<string, string>,
): { fetch: typeof fetch; calls: Array<{ url: string; init: RequestInit | undefined }> } {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const impl = ((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(new Response(null, { status, headers }));
  }) as unknown as typeof fetch;
  return { fetch: impl, calls };
}

describe("the CORS configuration document", () => {
  it("allows PUT from the console and nothing else", () => {
    const xml = corsConfigurationXml(consoleUploadRule([ORIGIN]));

    expect(xml).toContain(`<AllowedOrigin>${ORIGIN}</AllowedOrigin>`);
    expect(xml).toContain("<AllowedMethod>PUT</AllowedMethod>");
    expect(xml).toContain("<AllowedHeader>content-type</AllowedHeader>");
    expect(xml).not.toContain("<AllowedMethod>GET</AllowedMethod>");
    expect(xml).not.toContain("<AllowedMethod>DELETE</AllowedMethod>");
    expect(xml).not.toContain("*");
  });

  /*
   * The origin comes from a config file, and a value that closes a tag would
   * write a rule other than the one asked for — in the one document that
   * decides who may write to the bucket.
   */
  it("escapes an origin that would otherwise close the tag", () => {
    const xml = corsConfigurationXml(
      consoleUploadRule(["https://a.example</AllowedOrigin><AllowedOrigin>*"]),
    );

    expect(xml).not.toContain("<AllowedOrigin>*</AllowedOrigin>");
    expect(xml).toContain("&lt;/AllowedOrigin&gt;");
  });

  it("is base64 MD5, which is what Content-MD5 means", () => {
    // RFC 1864's own example.
    expect(contentMd5("")).toBe("1B2M2Y8AsgTpgAmY7PhCfg==");
  });
});

describe("writing the rule", () => {
  it("addresses the ?cors subresource with a signed Content-MD5", async () => {
    const { fetch: impl, calls } = answering(200, {});

    const result = await applyBucketCors(
      {
        presignBucketCors: (method, _ttl, _now, md5) =>
          `https://bucket/?cors&m=${method}&md5=${md5 ?? "none"}`,
      },
      consoleUploadRule([ORIGIN]),
      new Date("2026-08-13T10:00:00Z"),
      impl,
    );

    expect(result.kind).toBe("applied");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain("?cors");
    expect(calls[0]?.url).toContain("m=PUT");
    // The MD5 is signed *and* sent: signing a header the request does not carry
    // is a 403 the caller reads as "wrong credentials".
    const sent = calls[0]?.init?.headers as Record<string, string>;
    expect(calls[0]?.url).toContain(`md5=${sent["content-md5"]}`);
    expect(sent["content-md5"]).toBe(
      contentMd5(corsConfigurationXml(consoleUploadRule([ORIGIN]))),
    );
  });

  it("reports a refusal rather than throwing, so the probe still runs", async () => {
    const { fetch: impl } = answering(403, {});

    const result = await applyBucketCors(
      { presignBucketCors: () => "https://bucket/?cors" },
      consoleUploadRule([ORIGIN]),
      new Date(),
      impl,
    );

    expect(result.kind).toBe("refused");
  });
});

describe("the preflight probe", () => {
  it("passes when the bucket allows the origin and the method", async () => {
    const { fetch: impl, calls } = answering(200, {
      "access-control-allow-origin": ORIGIN,
      "access-control-allow-methods": "PUT",
    });

    const verdict = await probePreflight(
      "https://nbg1.example",
      "media",
      ORIGIN,
      "PUT",
      impl,
    );

    expect(verdict).toEqual({ kind: "allowed" });
    // No credential on the wire: this is exactly what the browser sends, which
    // is why its answer is worth more than a signed request's.
    expect(calls[0]?.init?.method).toBe("OPTIONS");
    expect(JSON.stringify(calls[0]?.init?.headers)).not.toContain("X-Amz");
  });

  /* The production state on 13.08: the bucket answers, and says nothing. */
  it("refuses when there is no Access-Control-Allow-Origin at all", async () => {
    const { fetch: impl } = answering(200, {});

    const verdict = await probePreflight("https://x", "media", ORIGIN, "PUT", impl);

    expect(verdict.kind).toBe("refused");
    expect(verdict.kind === "refused" && verdict.why).toContain(
      "no Access-Control-Allow-Origin",
    );
  });

  it("refuses when the bucket allows a different origin", async () => {
    const { fetch: impl } = answering(200, {
      "access-control-allow-origin": "https://someone-else.example",
      "access-control-allow-methods": "PUT",
    });

    const verdict = await probePreflight("https://x", "media", ORIGIN, "PUT", impl);

    expect(verdict.kind).toBe("refused");
    expect(verdict.kind === "refused" && verdict.why).toContain("someone-else");
  });

  /*
   * The half-configured bucket, which is the one a "we set up CORS" answer
   * produces: read access from the console, no write.
   */
  it("refuses when the origin is allowed but PUT is not", async () => {
    const { fetch: impl } = answering(200, {
      "access-control-allow-origin": ORIGIN,
      "access-control-allow-methods": "GET, HEAD",
    });

    const verdict = await probePreflight("https://x", "media", ORIGIN, "PUT", impl);

    expect(verdict.kind).toBe("refused");
    expect(verdict.kind === "refused" && verdict.why).toContain("GET, HEAD");
  });

  it("refuses when the origin is allowed and no method is named", async () => {
    const { fetch: impl } = answering(204, {
      "access-control-allow-origin": ORIGIN,
    });

    const verdict = await probePreflight("https://x", "media", ORIGIN, "PUT", impl);

    expect(verdict.kind).toBe("refused");
    expect(verdict.kind === "refused" && verdict.why).toContain("names no methods");
  });

  it("accepts a wildcard, because a browser does", async () => {
    const { fetch: impl } = answering(200, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "put",
    });

    expect(await probePreflight("https://x", "media", ORIGIN, "PUT", impl)).toEqual({
      kind: "allowed",
    });
  });

  it("says the bucket was unreachable rather than that it refused", async () => {
    const impl = (() =>
      Promise.reject(new Error("getaddrinfo ENOTFOUND"))) as typeof fetch;

    const verdict = await probePreflight("https://x", "media", ORIGIN, "PUT", impl);

    expect(verdict.kind).toBe("unreachable");
  });

  /*
   * The one that actually mattered on 13.08. Node's fetch rejects with the
   * word "fetch failed" and nothing else; the deploy printed that, and it is
   * the same sentence for a DNS failure, a refused connection, an unreachable
   * network and an untrusted certificate. The cause was a container with no
   * gateway, and the chain below is what would have said so.
   */
  it("carries the cause out, because 'fetch failed' names nothing", async () => {
    const cause = Object.assign(
      new Error("getaddrinfo EAI_AGAIN nbg1.your-objectstorage.com"),
      { code: "EAI_AGAIN" },
    );
    const impl = (() =>
      Promise.reject(new TypeError("fetch failed", { cause }))) as typeof fetch;

    const verdict = await probePreflight("https://x", "media", ORIGIN, "PUT", impl);

    expect(verdict.kind).toBe("unreachable");
    expect(verdict.kind === "unreachable" && verdict.reason).toContain(
      "nbg1.your-objectstorage.com",
    );
    expect(verdict.kind === "unreachable" && verdict.reason).toContain("EAI_AGAIN");
  });
});

describe("describing why a fetch failed", () => {
  it("walks the whole cause chain", () => {
    const root = Object.assign(new Error("connect ECONNREFUSED"), {
      code: "ECONNREFUSED",
    });
    const middle = new Error("socket hang up", { cause: root });

    expect(describeFetchFailure(new TypeError("fetch failed", { cause: middle }))).toBe(
      "fetch failed — socket hang up — connect ECONNREFUSED (ECONNREFUSED)",
    );
  });

  it("terminates on a cycle rather than hanging the deploy", () => {
    const a = new Error("a");
    const b = new Error("b", { cause: a });
    (a as { cause?: unknown }).cause = b;

    expect(describeFetchFailure(a).split(" — ")).toHaveLength(5);
  });

  it("says something for a value that is not an Error at all", () => {
    expect(describeFetchFailure("boom")).toBe("unknown error");
  });
});
