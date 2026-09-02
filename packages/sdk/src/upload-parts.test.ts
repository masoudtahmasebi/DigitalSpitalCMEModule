/**
 * The multipart uploader's orchestration (P129-05).
 *
 * All of it runs without a network: `put` is injected, and so is the backoff
 * delay, so a four-attempt retry costs microseconds rather than seven seconds.
 *
 * The properties here are the ones that go wrong silently. A slicing bug does
 * not throw — it assembles an object of the **right size** and the wrong bytes,
 * which verifies, stores, and plays as garbage. A signing bug does not throw
 * either; it leaves live capabilities behind after the tab closes.
 */

import { describe, expect, it, vi } from "vitest";
import { uploadInParts } from "./index.js";

const PART = 32 * 1024 * 1024;

function fakeApi(partCount: number) {
  const signedBatches: number[][] = [];
  return {
    signedBatches,
    completed: [] as unknown[],
    adminBeginMultipartUpload: vi.fn(async () => ({
      key: "cus/courses/crs/video-abc.mp4",
      uploadId: "up-1",
      partCount,
      partBytes: PART,
      expiresAt: "2026-08-31T12:00:00.000Z",
    })),
    adminSignUploadParts: vi.fn(
      async (_slug: string, input: { partNumbers: readonly number[] }) => {
        signedBatches.push([...input.partNumbers]);
        return {
          parts: input.partNumbers.map((partNumber) => ({
            partNumber,
            url: `https://bucket.test/p/${String(partNumber)}`,
          })),
          expiresAt: "2026-08-31T12:00:00.000Z",
        };
      },
    ),
    adminCompleteMultipartUpload: vi.fn(async () => ({
      reference: "s3://cus/courses/crs/video-abc.mp4",
      sizeBytes: 1,
      mimeType: "video/mp4",
    })),
  };
}

/** A Blob whose `slice` records the ranges asked for. */
function trackedFile(size: number) {
  const slices: Array<[number, number]> = [];
  const file = {
    size,
    slice(start: number, end: number) {
      slices.push([start, end]);
      return { size: end - start } as unknown as Blob;
    },
  } as unknown as Blob;
  return { file, slices };
}

const INPUT = { purpose: "video", mimeType: "video/mp4", sizeBytes: 1 } as never;
const noDelay = async () => undefined;

describe("slicing", () => {
  it("tiles the file exactly on the server's boundaries", async () => {
    /*
     * The failure this guards: a client that slices differently from the plan
     * the server signed against produces an object of the right size and the
     * wrong bytes. Nothing downstream notices — `verifyUpload` compares length.
     */
    const size = PART * 2 + 1234;
    const { file, slices } = trackedFile(size);
    const api = fakeApi(3);

    await uploadInParts(api, "slug", file, INPUT, {
      put: async () => undefined,
      delay: noDelay,
    });

    slices.sort((a, b) => a[0] - b[0]);
    expect(slices).toEqual([
      [0, PART],
      [PART, PART * 2],
      [PART * 2, size],
    ]);
  });
});

describe("signing", () => {
  it("never asks for more than the contract's batch limit", async () => {
    // 40 parts, and the endpoint accepts 32 at most. A client that asked for all
    // of them would be refused by its own API.
    const api = fakeApi(40);
    const { file } = trackedFile(PART * 40);

    await uploadInParts(api, "slug", file, INPUT, {
      put: async () => undefined,
      delay: noDelay,
    });

    for (const batch of api.signedBatches) expect(batch.length).toBeLessThanOrEqual(32);
  });

  it("signs a part only when it is about to be uploaded", async () => {
    /*
     * Every URL is a live capability. If all 40 were minted at the start, an
     * author closing the tab after part 3 would leave 37 valid signatures
     * behind for the rest of their lifetime.
     */
    const api = fakeApi(40);
    const { file } = trackedFile(PART * 40);
    let signedBeforeFirstPut = 0;

    await uploadInParts(api, "slug", file, INPUT, {
      delay: noDelay,
      put: async () => {
        signedBeforeFirstPut ||= api.signedBatches.flat().length;
      },
    });

    expect(signedBeforeFirstPut).toBeLessThan(40);
  });
});

describe("retry", () => {
  it("retries a failed part and finishes", async () => {
    const api = fakeApi(2);
    const { file } = trackedFile(PART * 2);
    let calls = 0;

    const result = await uploadInParts(api, "slug", file, INPUT, {
      delay: noDelay,
      put: async () => {
        calls += 1;
        if (calls === 1) throw new Error("connection reset");
      },
    });

    expect(result.reference).toContain("s3://");
    expect(calls).toBeGreaterThan(2);
  });

  it("asks for a fresh signature before retrying", async () => {
    /*
     * A part that failed near its URL's expiry fails again for the same reason
     * however many times it is tried. Re-signing is what makes the retry mean
     * something.
     */
    const api = fakeApi(1);
    const { file } = trackedFile(PART);
    let calls = 0;

    await uploadInParts(api, "slug", file, INPUT, {
      delay: noDelay,
      put: async () => {
        calls += 1;
        if (calls === 1) throw new Error("403");
      },
    });

    expect(api.adminSignUploadParts).toHaveBeenCalledTimes(2);
  });

  it("gives up after the attempt limit rather than retrying for ever", async () => {
    const api = fakeApi(1);
    const { file } = trackedFile(PART);
    const put = vi.fn(async () => {
      throw new Error("connection reset");
    });

    await expect(
      uploadInParts(api, "slug", file, INPUT, {
        put,
        delay: noDelay,
        attemptsPerPart: 3,
      }),
    ).rejects.toThrow("connection reset");

    expect(put).toHaveBeenCalledTimes(3);
    expect(
      api.adminCompleteMultipartUpload,
      "nothing was assembled",
    ).not.toHaveBeenCalled();
  });
});

describe("cancelling", () => {
  it("stops, and does not retry the part that was in flight", async () => {
    // A cancelled upload is not a failed one. Retrying it would be the uploader
    // arguing with the person who pressed the button.
    const api = fakeApi(4);
    const { file } = trackedFile(PART * 4);
    const controller = new AbortController();
    const put = vi.fn(async () => {
      controller.abort();
      throw new Error("upload cancelled");
    });

    await expect(
      uploadInParts(api, "slug", file, INPUT, {
        put,
        delay: noDelay,
        signal: controller.signal,
        concurrency: 1,
      }),
    ).rejects.toThrow();

    expect(put).toHaveBeenCalledTimes(1);
    expect(api.adminCompleteMultipartUpload).not.toHaveBeenCalled();
  });
});

describe("progress", () => {
  it("reports bytes confirmed, ending at 100", async () => {
    const size = PART * 3;
    const { file } = trackedFile(size);
    const api = fakeApi(3);
    const seen: number[] = [];

    await uploadInParts(api, "slug", file, INPUT, {
      put: async () => undefined,
      delay: noDelay,
      onProgress: (percent) => seen.push(percent),
    });

    expect(seen.at(-1)).toBe(100);
    // Monotonic: a bar that goes backwards is worse than no bar.
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
  });
});
