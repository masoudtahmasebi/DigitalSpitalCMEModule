/**
 * How a large file is split (P129-01).
 *
 * ## Why this is worth exhaustive tests
 *
 * Two independent implementations slice on these boundaries: the server signs
 * `partCount` URLs, and the browser cuts the file with `Blob.slice`. If they
 * disagree by one byte the bucket assembles an object that is the **right size**
 * and the wrong bytes — a video that verifies, stores, and plays as garbage.
 *
 * That is why `planMultipart` and `partRange` are one function each rather than
 * arithmetic inlined at both call sites, and why the boundaries are pinned here.
 */

import { describe, expect, it } from "vitest";
import {
  MULTIPART_MAX_PARTS,
  MULTIPART_PART_BYTES,
  MULTIPART_THRESHOLD_BYTES,
  UPLOAD_MAX_BYTES,
  planMultipart,
  partRange,
} from "./upload.js";

const MiB = 1024 * 1024;

describe("planMultipart", () => {
  it("leaves a small file alone", () => {
    // Below the threshold a file is one PUT: three API calls and a part loop
    // buy nothing when the whole upload costs seconds.
    expect(planMultipart(MULTIPART_THRESHOLD_BYTES - 1)).toBeUndefined();
    expect(planMultipart(1)).toBeUndefined();
  });

  it("splits at the threshold itself", () => {
    const plan = planMultipart(MULTIPART_THRESHOLD_BYTES);
    expect(plan).toEqual({ partCount: 1, partBytes: MULTIPART_PART_BYTES });
  });

  it("rounds the last part up, never down", () => {
    // One byte past a boundary is a whole extra part. Rounding down would leave
    // the tail of the file unsent, and the object would be short by up to 32 MiB.
    expect(planMultipart(MULTIPART_PART_BYTES * 3)?.partCount).toBe(3);
    expect(planMultipart(MULTIPART_PART_BYTES * 3 + 1)?.partCount).toBe(4);
  });

  it("covers the client's own file sizes", () => {
    // "we have videos which are 3 gb"
    expect(planMultipart(3 * 1024 * MiB)?.partCount).toBe(96);
    // And the ceiling they asked for.
    expect(planMultipart(UPLOAD_MAX_BYTES.video)?.partCount).toBe(160);
  });

  it("stays inside S3's part limit at the largest file we accept", () => {
    /*
     * The property that keeps the part size honest: if somebody shrinks
     * `MULTIPART_PART_BYTES` to reduce wasted work on a failure, this fails
     * before a 5 GiB upload does — and it fails here rather than at 9,999 parts
     * against a real bucket.
     */
    const plan = planMultipart(UPLOAD_MAX_BYTES.video);
    expect(plan).toBeDefined();
    expect(plan!.partCount).toBeLessThanOrEqual(MULTIPART_MAX_PARTS);
  });

  it("refuses a file that would need more parts than S3 allows", () => {
    expect(planMultipart(MULTIPART_PART_BYTES * MULTIPART_MAX_PARTS + 1)).toBeUndefined();
  });

  it("refuses nonsense rather than producing a plan for it", () => {
    expect(planMultipart(0)).toBeUndefined();
    expect(planMultipart(-1)).toBeUndefined();
    expect(planMultipart(1.5)).toBeUndefined();
    expect(planMultipart(Number.NaN)).toBeUndefined();
  });
});

describe("partRange", () => {
  const size = MULTIPART_PART_BYTES * 2 + 12_345;
  const plan = planMultipart(size)!;

  it("tiles the file exactly: no gap, no overlap, nothing left over", () => {
    /*
     * The one property that matters. Asserted as a walk rather than as three
     * hand-written ranges, because the failure this guards against is an
     * off-by-one at a boundary and hand-written cases tend to test the middle.
     */
    let cursor = 0;
    for (let part = 1; part <= plan.partCount; part += 1) {
      const range = partRange(plan, size, part);
      expect(range, `part ${part}`).toBeDefined();
      expect(range!.start, `part ${part} starts where the last ended`).toBe(cursor);
      expect(range!.end).toBeGreaterThan(range!.start);
      cursor = range!.end;
    }
    expect(cursor, "the last part ends at the end of the file").toBe(size);
  });

  it("gives the last part only what remains", () => {
    expect(partRange(plan, size, plan.partCount)).toEqual({
      start: MULTIPART_PART_BYTES * 2,
      end: size,
    });
  });

  it("refuses a part number outside the plan", () => {
    // Zero-based is the natural mistake: S3 part numbers start at 1.
    expect(partRange(plan, size, 0)).toBeUndefined();
    expect(partRange(plan, size, plan.partCount + 1)).toBeUndefined();
    expect(partRange(plan, size, 1.5)).toBeUndefined();
  });
});
