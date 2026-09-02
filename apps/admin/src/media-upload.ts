/**
 * Choosing how a dropped file is uploaded (P131-01).
 *
 * Pure, so the decisions can be tested without a browser, a bucket or a course.
 * Everything here is a rule the screen renders rather than a rule the screen
 * invents.
 */

import {
  MULTIPART_THRESHOLD_BYTES,
  UPLOAD_MAX_BYTES,
  UPLOAD_TYPES,
  type UploadPurpose,
} from "@ds/domain";

/**
 * Which purpose a file belongs to, from its own MIME type.
 *
 * The operator is not asked. A purpose is not a preference — it decides the
 * accepted types and the size ceiling, and the server derives the same answer
 * from the same table, so a dropdown here would be a second opinion that can
 * only ever disagree.
 *
 * The order matters where a type appears twice. It does not today; `find` over
 * a fixed order keeps it deterministic if it ever does.
 */
const PURPOSES: readonly UploadPurpose[] = ["video", "poster", "material", "captions"];

export function purposeFor(mimeType: string): UploadPurpose | undefined {
  // Browsers append parameters — `text/vtt; charset=utf-8` from a file picker.
  const declared = (mimeType.split(";")[0] ?? "").trim().toLowerCase();
  return PURPOSES.find((purpose) =>
    UPLOAD_TYPES[purpose].some((type) => type.mimeType === declared),
  );
}

/** Every type the library will accept, for the file input's `accept`. */
export function acceptedMimeTypes(): readonly string[] {
  return PURPOSES.flatMap((purpose) =>
    UPLOAD_TYPES[purpose].map((type) => type.mimeType),
  );
}

export type UploadRefusalReason = "unsupported_type" | "too_large" | "empty";

export interface PlannedFile {
  readonly purpose: UploadPurpose;
  readonly mimeType: string;
  readonly sizeBytes: number;
  /** Whether this goes in parts. The server decides the same way. */
  readonly inParts: boolean;
}

/**
 * What will happen to this file, or why nothing will.
 *
 * Refused **before** anything is sent, so an author learns that a 6 GiB file is
 * too large now rather than after twenty minutes of uploading — which is what
 * the server's own refusal would cost them. The server refuses again regardless;
 * this is not the gate, it is the courtesy.
 */
export function planFile(file: {
  readonly type: string;
  readonly size: number;
}): { ok: true; plan: PlannedFile } | { ok: false; reason: UploadRefusalReason } {
  const purpose = purposeFor(file.type);
  if (purpose === undefined) return { ok: false, reason: "unsupported_type" };
  if (!Number.isSafeInteger(file.size) || file.size <= 0) {
    return { ok: false, reason: "empty" };
  }
  if (file.size > UPLOAD_MAX_BYTES[purpose]) return { ok: false, reason: "too_large" };

  return {
    ok: true,
    plan: {
      purpose,
      mimeType: (file.type.split(";")[0] ?? "").trim().toLowerCase(),
      sizeBytes: file.size,
      inParts: file.size >= MULTIPART_THRESHOLD_BYTES,
    },
  };
}
