/**
 * The rules the upload panel renders (P131-01).
 *
 * Worth testing rather than eyeballing because each is a rule the **server**
 * also applies, from the same table. A disagreement does not throw here — it
 * shows an author a file the API will refuse, or refuses one the API would have
 * taken.
 */

import { describe, expect, it } from "vitest";
import { MULTIPART_THRESHOLD_BYTES, UPLOAD_MAX_BYTES } from "@ds/domain";
import { acceptedMimeTypes, planFile, purposeFor } from "./media-upload.js";

describe("purposeFor", () => {
  it("derives the purpose from the type, so nobody is asked", () => {
    expect(purposeFor("video/mp4")).toBe("video");
    expect(purposeFor("image/png")).toBe("poster");
    expect(purposeFor("application/pdf")).toBe("material");
    expect(purposeFor("text/vtt")).toBe("captions");
  });

  it("ignores the parameter a file picker appends", () => {
    // What a browser actually reports for a subtitle file.
    expect(purposeFor("text/vtt; charset=utf-8")).toBe("captions");
    expect(purposeFor("VIDEO/MP4")).toBe("video");
  });

  it("has no answer for a type the platform does not accept", () => {
    // A Word document handed to a physician from a CME platform is a macro
    // target; `UPLOAD_TYPES` accepts PDF only, and this must agree.
    expect(purposeFor("application/msword")).toBeUndefined();
    expect(purposeFor("")).toBeUndefined();
  });
});

describe("planFile", () => {
  it("sends a small file whole and a large one in parts", () => {
    const small = planFile({ type: "video/mp4", size: 1024 });
    const large = planFile({ type: "video/mp4", size: MULTIPART_THRESHOLD_BYTES });

    expect(small.ok && small.plan.inParts).toBe(false);
    expect(large.ok && large.plan.inParts).toBe(true);
  });

  it("refuses an oversized file before a byte is sent", () => {
    /*
     * The point of refusing here at all. The server refuses too, but only after
     * `begin` — and for a 6 GiB file an author would otherwise learn it was too
     * large having already waited.
     */
    const result = planFile({
      type: "video/mp4",
      size: UPLOAD_MAX_BYTES.video + 1,
    });
    expect(result).toEqual({ ok: false, reason: "too_large" });
  });

  it("accepts a file at exactly the ceiling", () => {
    // The client's 5 GiB, which is the number they asked for.
    const result = planFile({ type: "video/mp4", size: UPLOAD_MAX_BYTES.video });
    expect(result.ok).toBe(true);
  });

  it("refuses an empty file", () => {
    expect(planFile({ type: "video/mp4", size: 0 })).toEqual({
      ok: false,
      reason: "empty",
    });
  });

  it("applies the ceiling of the file's own purpose, not video's", () => {
    // A 300 MB PDF is over `material`'s limit even though it is far under
    // `video`'s. Using one ceiling for everything would accept it and the
    // server would not.
    const result = planFile({
      type: "application/pdf",
      size: UPLOAD_MAX_BYTES.material + 1,
    });
    expect(result).toEqual({ ok: false, reason: "too_large" });
  });
});

describe("acceptedMimeTypes", () => {
  it("offers the file picker exactly what the server accepts", () => {
    const accepted = acceptedMimeTypes();
    expect(accepted).toContain("video/mp4");
    expect(accepted).toContain("application/pdf");
    expect(accepted).not.toContain("application/msword");
  });
});
