/**
 * The Range probe (P62-03).
 *
 * The property under test is that **`200` is a failure**. That is the whole
 * finding: a server answering `200` to a `Range` request looks healthy to
 * every other check ever written, and is precisely the configuration that
 * makes the player look like it is refusing a seek on the accreditation's
 * behalf.
 */

import { describe, expect, it } from "vitest";
import { allSeekable, MediaCheckService } from "./media-check.service.js";

const URL_A = "https://cdn.medice.de/modul-1.mp4";
const URL_B = "https://cdn.medice.de/modul-2.mp4";

function build(
  responder: (url: string, init: RequestInit) => Response | Promise<Response>,
) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const service = new MediaCheckService((async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return responder(url, init);
  }) as unknown as typeof fetch);
  return { service, calls };
}

const partial = () =>
  new Response("x", { status: 206, headers: { "content-range": "bytes 0-0/1024" } });

describe("a host that honours Range", () => {
  it("is seekable", async () => {
    const { service } = build(partial);
    expect(await service.check([URL_A])).toEqual([
      { url: URL_A, verdict: "seekable", status: 206 },
    ]);
  });

  it("is asked for exactly one byte", async () => {
    // The question is whether the header is understood, not how fast the CDN
    // is. Downloading a 700 MB module to find out would be its own outage.
    const { service, calls } = build(partial);
    await service.check([URL_A]);
    expect((calls[0]?.init.headers as Record<string, string>)["range"]).toBe("bytes=0-0");
  });
});

describe("a host that ignores Range", () => {
  it("is a failure even though it answered 200", async () => {
    // The finding, stated as a test: healthy-looking and unseekable.
    const { service } = build(() => new Response("whole file", { status: 200 }));

    const [result] = await service.check([URL_A]);
    expect(result?.verdict).toBe("no_range");
    expect(result?.detail).toContain("ignored the Range header");
    expect(allSeekable([result!])).toBe(false);
  });

  it("is a failure when it answers 206 without a Content-Range", async () => {
    // A status without the header it implies is not a partial response, and a
    // browser treats it accordingly.
    const { service } = build(() => new Response("x", { status: 206 }));
    expect((await service.check([URL_A]))[0]?.verdict).toBe("no_range");
  });
});

describe("a host that is not there", () => {
  it("reports the status when the server answered one", async () => {
    const { service } = build(() => new Response("nope", { status: 404 }));
    expect(await service.check([URL_A])).toEqual([
      { url: URL_A, verdict: "unreachable", status: 404 },
    ]);
  });

  it("reports the error class and never its message", async () => {
    // A fetch failure can quote the URL, and some of ours carry signatures.
    const { service } = build(() => {
      throw new TypeError("fetch failed for https://cdn/x?X-Amz-Signature=abc");
    });

    const [result] = await service.check([URL_A]);
    expect(result?.verdict).toBe("failed");
    expect(result?.detail).toBe("TypeError");
    expect(JSON.stringify(result)).not.toContain("X-Amz-Signature");
  });
});

describe("what it does not probe", () => {
  it("passes over an s3:// reference without a request", async () => {
    // The API signs those itself against an S3-compatible bucket, which is
    // Range-capable by definition; probing would mint a signature to discard.
    const { service, calls } = build(partial);

    expect(await service.check(["s3://customer/courses/course/modul.mp4"])).toEqual([
      { url: "s3://customer/courses/course/modul.mp4", verdict: "signed_by_us" },
    ]);
    expect(calls).toHaveLength(0);
    expect(allSeekable(await service.check(["s3://a/b"]))).toBe(true);
  });
});

describe("a course whose modules share a host", () => {
  it("asks each distinct URL once", async () => {
    // Five modules on one CDN is the normal shape; five identical answers is
    // a report nobody reads.
    const { service, calls } = build(partial);
    const results = await service.check([URL_A, URL_B, URL_A, URL_A]);

    expect(calls.map((call) => call.url)).toEqual([URL_A, URL_B]);
    expect(results.map((result) => result.url)).toEqual([URL_A, URL_B]);
  });
});
