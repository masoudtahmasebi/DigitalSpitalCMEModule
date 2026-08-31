/**
 * Multipart against a fake bucket (P129-02).
 *
 * The cases here are the ones a real bucket would teach expensively: an
 * assembly that fails inside a 200, a part list that has to survive being read
 * back, and an abort that must not turn an already-bad situation into a 500.
 */

import { describe, expect, it, vi } from "vitest";
import { ObjectStorage } from "./object-storage.js";
import type { Presigner } from "./s3-presigner.js";

const presigner: Presigner = {
  presignGet: () => "https://bucket.test/get",
  presignPut: () => "https://bucket.test/put",
  presignHead: () => "https://bucket.test/head",
  presignDelete: () => "https://bucket.test/delete",
  presignCreateMultipart: () => "https://bucket.test/create",
  presignUploadPart: (_k, _e, _n, uploadId, partNumber) =>
    `https://bucket.test/part?uploadId=${uploadId}&partNumber=${String(partNumber)}`,
  presignListParts: () => "https://bucket.test/list",
  presignCompleteMultipart: () => "https://bucket.test/complete",
  presignAbortMultipart: () => "https://bucket.test/abort",
};

const ok = (body: string) => new Response(body, { status: 200 });

function storage(fetchImpl: typeof fetch) {
  return new ObjectStorage(presigner, 600, fetchImpl);
}

const PLAN = {
  ok: true as const,
  purpose: "video" as const,
  mimeType: "video/mp4",
  sizeBytes: 3 * 1024 * 1024 * 1024,
  extension: "mp4",
};

/*
 * Real UUIDs, because `courseAssetKey` refuses anything else — the tenant
 * boundary is enforced in the key builder, not only by the caller, so a test
 * cannot hand it a convenient short string.
 */
const SCOPE = {
  customerId: "0198f4c1-7a2e-7000-8000-000000000001",
  courseId: "0198f4c1-7a2e-7000-8000-0000000000c1",
};

describe("beginMultipart", () => {
  it("takes the UploadId from the bucket, and never from the request", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        ok(
          "<InitiateMultipartUploadResult><UploadId>abc123</UploadId></InitiateMultipartUploadResult>",
        ),
      );

    const result = await storage(fetchImpl as unknown as typeof fetch).beginMultipart(
      PLAN,
      SCOPE,
      { partCount: 96, partBytes: 32 * 1024 * 1024 },
      new Date("2026-08-31T00:00:00Z"),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.upload.uploadId).toBe("abc123");
    // Built from the scope, with nothing from the client in it.
    expect(result.upload.key).toContain(SCOPE.customerId);
    expect(result.upload.key).toContain(SCOPE.courseId);
  });

  it("refuses when the bucket answers without an UploadId", async () => {
    // A 200 with an unexpected body is not a usable upload, and pretending it
    // is would hand the browser part URLs for an upload that does not exist.
    const fetchImpl = vi.fn().mockResolvedValue(ok("<Nothing/>"));
    const result = await storage(fetchImpl as unknown as typeof fetch).beginMultipart(
      PLAN,
      SCOPE,
      { partCount: 1, partBytes: 32 },
      new Date(),
    );
    expect(result.ok).toBe(false);
  });
});

describe("listParts", () => {
  it("reads what the bucket holds, in the order it gave", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      ok(`<ListPartsResult>
            <Part><PartNumber>1</PartNumber><ETag>"aaa"</ETag><Size>100</Size></Part>
            <Part><PartNumber>2</PartNumber><ETag>"bbb"</ETag><Size>50</Size></Part>
          </ListPartsResult>`),
    );

    const result = await storage(fetchImpl as unknown as typeof fetch).listParts(
      "k",
      "u",
      new Date(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.parts).toEqual([
      { partNumber: 1, etag: '"aaa"', sizeBytes: 100 },
      { partNumber: 2, etag: '"bbb"', sizeBytes: 50 },
    ]);
  });

  it("skips a malformed entry rather than inventing a part number", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        ok("<ListPartsResult><Part><Size>1</Size></Part></ListPartsResult>"),
      );
    const result = await storage(fetchImpl as unknown as typeof fetch).listParts(
      "k",
      "u",
      new Date(),
    );
    expect(result.ok && result.parts).toEqual([]);
  });
});

describe("completeMultipart", () => {
  it("sends the parts in order, whatever order they were listed in", async () => {
    // S3 refuses an out-of-order part list, and `listParts` is not required to
    // return them sorted.
    const fetchImpl = vi.fn().mockResolvedValue(ok("<CompleteMultipartUploadResult/>"));
    await storage(fetchImpl as unknown as typeof fetch).completeMultipart(
      "k",
      "u",
      [
        { partNumber: 2, etag: '"bbb"', sizeBytes: 1 },
        { partNumber: 1, etag: '"aaa"', sizeBytes: 1 },
      ],
      new Date(),
    );

    const body = String((fetchImpl.mock.calls[0]?.[1] as RequestInit).body);
    expect(body.indexOf("<PartNumber>1</PartNumber>")).toBeLessThan(
      body.indexOf("<PartNumber>2</PartNumber>"),
    );
  });

  it("treats a 200 carrying <Error> as a failure", async () => {
    /*
     * The case that makes this method exist. `CompleteMultipartUpload` can take
     * minutes, so S3 answers 200 immediately, holds the connection, and writes
     * the outcome into the body. A caller checking only the status code records
     * a finished upload and points a course at an object that is not there.
     */
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(ok("<Error><Code>InvalidPart</Code></Error>"));

    const result = await storage(fetchImpl as unknown as typeof fetch).completeMultipart(
      "k",
      "u",
      [{ partNumber: 1, etag: '"a"', sizeBytes: 1 }],
      new Date(),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.kind).toBe("unreachable");
  });

  it("refuses to assemble nothing", async () => {
    const fetchImpl = vi.fn();
    const result = await storage(fetchImpl as unknown as typeof fetch).completeMultipart(
      "k",
      "u",
      [],
      new Date(),
    );
    expect(result.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("abortMultipart", () => {
  it("reports a failure instead of throwing one", async () => {
    // Abandoning an upload is already the unhappy path; a 500 on top helps
    // nobody, and the lifecycle rule is the backstop either way.
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network is gone"));
    const result = await storage(fetchImpl as unknown as typeof fetch).abortMultipart(
      "k",
      "u",
      new Date(),
    );
    expect(result.ok).toBe(false);
  });

  it("treats an already-gone upload as aborted", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("", { status: 404 }));
    const result = await storage(fetchImpl as unknown as typeof fetch).abortMultipart(
      "k",
      "u",
      new Date(),
    );
    expect(result.ok).toBe(true);
  });
});
