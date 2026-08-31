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
 * ## Where that agreement actually comes from (P134-02)
 *
 * This header used to say it came from `partRange`, "one function rather than
 * arithmetic inlined at both call sites". That was not true and could not be:
 * `@ds/sdk` has **no runtime dependencies at all** — deliberately, because it is
 * embedded in the widget and the console — so the browser cannot import a
 * slicer from here, and it never did. `partRange` was written for a caller that
 * could not exist, `scripts/unused-rules.mjs` said so for two phases, and the
 * comment claiming otherwise is what stopped anybody looking. It is deleted.
 *
 * The agreement is real and comes from somewhere else: `planMultipart` decides
 * `partBytes` **once**, the server puts that number in the ticket, and the
 * browser slices on `ticket.partBytes` rather than on a constant of its own. So
 * there is one number, not two that must match. What pins it is this file for
 * the plan and `packages/sdk/src/upload-parts.test.ts` for the tiling, which
 * asserts the exact ranges `Blob.slice` is asked for.
 */

import { describe, expect, it } from "vitest";
import {
  MULTIPART_MAX_PARTS,
  MULTIPART_PART_BYTES,
  MULTIPART_THRESHOLD_BYTES,
  UPLOAD_MAX_BYTES,
  planMultipart,
  uploadLimitLabel,
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

describe("uploadLimitLabel", () => {
  /*
   * P133-01. The client read "MP4 or WebM, up to 2 GB" on a console whose
   * server accepts 5 GB, because the sentence was a literal in four locale
   * entries and the ceiling had moved underneath it (§9.3).
   *
   * These cases pin the *shape* of the answer. What stops the drift happening
   * again is that the locale files call this rather than restating the number,
   * which `apps/admin/src/locale/language.test.ts` asserts.
   */
  it("says the video ceiling the way a person writes it", () => {
    expect(uploadLimitLabel("video")).toBe("5 GB");
  });

  it("keeps the smaller ceilings in megabytes rather than fractions of a gigabyte", () => {
    expect(uploadLimitLabel("material")).toBe("200 MB");
    expect(uploadLimitLabel("poster")).toBe("10 MB");
    expect(uploadLimitLabel("captions")).toBe("2 MB");
  });

  it("tracks the constant rather than a copy of it", () => {
    // The property that matters: if `UPLOAD_MAX_BYTES` moves, this moves. A
    // hard-coded "5 GB" here would pass the first case and fail this one.
    const mib = UPLOAD_MAX_BYTES.video / (1024 * 1024);
    expect(uploadLimitLabel("video")).toBe(`${mib / 1024} GB`);
  });
});
