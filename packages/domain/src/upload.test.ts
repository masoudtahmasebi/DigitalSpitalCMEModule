import { describe, expect, it } from "vitest";
import { MEDIA_MIME_TYPES } from "./media.js";
import {
  InvalidUploadTokenError,
  planUpload,
  UPLOAD_MAX_BYTES,
  UPLOAD_TYPES,
  uploadObjectName,
  type UploadPurpose,
} from "./upload.js";

const PURPOSES: readonly UploadPurpose[] = ["video", "captions", "poster", "material"];

describe("the accepted-type table", () => {
  it("offers every uploadable video type as a playable source", () => {
    // If these two lists disagree, an author uploads a file successfully and
    // then cannot attach it to anything — the failure is two screens away from
    // the cause, which is the worst place for it to surface.
    for (const type of UPLOAD_TYPES.video) {
      expect(
        MEDIA_MIME_TYPES.includes(type.mimeType),
        `${type.mimeType} is uploadable but not a valid media source type`,
      ).toBe(true);
    }
  });

  it("accepts no manifest format", () => {
    // A manifest is an index over segments that were never uploaded. Accepting
    // one produces a course that plays nothing and reports no error.
    const uploadable = PURPOSES.flatMap((purpose) =>
      UPLOAD_TYPES[purpose].map((type) => type.mimeType),
    );
    for (const manifest of [
      "application/vnd.apple.mpegurl",
      "application/x-mpegurl",
      "application/dash+xml",
    ]) {
      expect(uploadable).not.toContain(manifest);
    }
  });

  it("gives every purpose at least one type and a positive ceiling", () => {
    for (const purpose of PURPOSES) {
      expect(UPLOAD_TYPES[purpose].length).toBeGreaterThan(0);
      expect(UPLOAD_MAX_BYTES[purpose]).toBeGreaterThan(0);
    }
  });

  it("uses a distinct extension within each purpose", () => {
    // Two types sharing an extension is not itself broken, but it means an
    // object name no longer implies its content type, which is the one thing
    // the name is for during an incident.
    for (const purpose of PURPOSES) {
      const extensions = UPLOAD_TYPES[purpose].map((type) => type.extension);
      expect(new Set(extensions).size).toBe(extensions.length);
    }
  });

  it("declares every mime type in lower case with no parameter", () => {
    // `planUpload` normalises the *input*; a table entry with a stray parameter
    // or capital would simply never match, silently.
    for (const purpose of PURPOSES) {
      for (const type of UPLOAD_TYPES[purpose]) {
        expect(type.mimeType).toBe(type.mimeType.toLowerCase());
        expect(type.mimeType).not.toContain(";");
        expect(type.extension).toMatch(/^[a-z0-9]+$/);
      }
    }
  });
});

describe("planUpload", () => {
  it("accepts each declared type for its own purpose", () => {
    for (const purpose of PURPOSES) {
      for (const type of UPLOAD_TYPES[purpose]) {
        const plan = planUpload({
          purpose,
          mimeType: type.mimeType,
          sizeBytes: 1024,
        });
        expect(plan.ok, `${purpose}/${type.mimeType}`).toBe(true);
        if (plan.ok) {
          expect(plan.extension).toBe(type.extension);
          expect(plan.mimeType).toBe(type.mimeType);
          expect(plan.purpose).toBe(purpose);
        }
      }
    }
  });

  it("refuses a type that belongs to a different purpose", () => {
    // The interesting case: `application/pdf` is perfectly acceptable — as a
    // material. Offered as a poster it is a mistake, and a per-purpose list is
    // the only thing that catches it.
    const plan = planUpload({
      purpose: "poster",
      mimeType: "application/pdf",
      sizeBytes: 1024,
    });
    expect(plan).toEqual({ ok: false, reason: "unsupported_type" });
  });

  it("drops a charset parameter rather than refusing the file", () => {
    // What a browser actually reports for a .vtt from a file picker.
    const plan = planUpload({
      purpose: "captions",
      mimeType: "text/vtt; charset=utf-8",
      sizeBytes: 400,
    });
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.mimeType).toBe("text/vtt");
  });

  it("normalises case and surrounding space", () => {
    const plan = planUpload({
      purpose: " Video ",
      mimeType: "  VIDEO/MP4  ",
      sizeBytes: 10,
    });
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.mimeType).toBe("video/mp4");
  });

  it("refuses a purpose it does not know", () => {
    expect(
      planUpload({ purpose: "certificate", mimeType: "video/mp4", sizeBytes: 10 }),
    ).toEqual({ ok: false, reason: "unknown_purpose" });
  });

  it("reports an unsupported type before a size problem", () => {
    // "we do not take .mov" is actionable. "too large" on a file that was never
    // acceptable sends the author away to compress it for nothing.
    expect(
      planUpload({
        purpose: "video",
        mimeType: "video/quicktime",
        sizeBytes: UPLOAD_MAX_BYTES.video + 1,
      }),
    ).toEqual({ ok: false, reason: "unsupported_type" });
  });

  describe("the size boundary", () => {
    it("accepts exactly the ceiling", () => {
      const plan = planUpload({
        purpose: "poster",
        mimeType: "image/png",
        sizeBytes: UPLOAD_MAX_BYTES.poster,
      });
      expect(plan.ok).toBe(true);
    });

    it("refuses one byte over", () => {
      expect(
        planUpload({
          purpose: "poster",
          mimeType: "image/png",
          sizeBytes: UPLOAD_MAX_BYTES.poster + 1,
        }),
      ).toEqual({ ok: false, reason: "too_large" });
    });

    it("accepts one byte", () => {
      expect(
        planUpload({ purpose: "captions", mimeType: "text/vtt", sizeBytes: 1 }).ok,
      ).toBe(true);
    });
  });

  describe("sizes that are not sizes", () => {
    for (const [label, sizeBytes] of [
      ["zero", 0],
      ["negative", -1],
      ["fractional", 12.5],
      ["NaN", Number.NaN],
      ["Infinity", Number.POSITIVE_INFINITY],
      ["beyond Number.MAX_SAFE_INTEGER", Number.MAX_SAFE_INTEGER + 2],
    ] as const) {
      it(`treats ${label} as no file at all`, () => {
        expect(
          planUpload({ purpose: "video", mimeType: "video/mp4", sizeBytes }),
        ).toEqual({ ok: false, reason: "empty" });
      });
    }
  });
});

describe("uploadObjectName", () => {
  it("names the purpose and uses the extension we chose", () => {
    expect(uploadObjectName("video", "a1b2c3d4e5", "mp4")).toBe("video-a1b2c3d4e5.mp4");
  });

  it("produces a name the storage-key grammar accepts", () => {
    // `courseAssetKey` refuses a filename outside `SAFE_SEGMENT`. These two
    // rules live in different files and a name that fails there would fail at
    // upload time, in front of an author, having already passed every check.
    const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
    for (const purpose of PURPOSES) {
      for (const type of UPLOAD_TYPES[purpose]) {
        const name = uploadObjectName(purpose, "0123456789abcdef", type.extension);
        expect(SAFE_SEGMENT.test(name), name).toBe(true);
      }
    }
  });

  for (const [label, token] of [
    ["too short", "abc"],
    ["upper case", "ABCDEFGH"],
    ["a path separator", "abcd/efgh"],
    ["a dot", "abcdefg.h"],
    ["a traversal", "..abcdefg"],
    ["empty", ""],
  ] as const) {
    it(`refuses a token that is ${label}`, () => {
      expect(() => uploadObjectName("video", token, "mp4")).toThrow(
        InvalidUploadTokenError,
      );
    });
  }
});
