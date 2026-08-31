/**
 * What the platform will accept bytes for, and how large (P23-01).
 *
 * Course media is uploaded **straight from the browser to object storage**. The
 * API mints a short-lived signature and never sees the bytes — which is the
 * whole point (a 700 MB video through a Node process is a memory profile and a
 * request timeout nobody needs), and which also removes the one thing
 * `font-file.ts` relies on: there is no buffer here to sniff.
 *
 * So this module is the *policy*, and it is deliberately narrow. Three things
 * make the missing sniff acceptable rather than a hole:
 *
 * 1. **The declared content type is bound into the signature.** S3 stores the
 *    request's `Content-Type` as object metadata, so the object is served back
 *    with a type from the table below and no other — an uploader cannot declare
 *    `video/mp4`, send HTML, and have it served as HTML.
 * 2. **The bucket is a different origin.** Objects are fetched from
 *    `…your-objectstorage.com`, never from the app's origin, so markup that got
 *    in has no session, no cookie and no DOM to reach.
 * 3. **The upload is verified afterwards.** The API HEADs the object and
 *    compares size and type against what it approved, and deletes it when they
 *    disagree — see `object-storage.ts`.
 *
 * ## Why a separate list from `MEDIA_MIME_TYPES`
 *
 * `MEDIA_MIME_TYPES` says what a `<source>` may *declare*; it includes HLS and
 * DASH manifests because a customer's CDN legitimately serves those. This list
 * says what we will *store*, and a manifest is not a file — it is an index over
 * hundreds of segments, and accepting one as an upload would produce a playlist
 * pointing at objects that were never uploaded. Every uploadable video type here
 * is also in `MEDIA_MIME_TYPES`, so anything uploaded can always be used as a
 * source; `upload.test.ts` asserts that rather than trusting it.
 *
 * Pure — no I/O, no clock, no randomness. The unpredictable part of an object
 * name is an argument.
 */

/** What the file is for. Decides both the accepted types and the size ceiling. */
export type UploadPurpose = "video" | "captions" | "poster" | "material";

export interface AcceptedUploadType {
  readonly mimeType: string;
  /** Without a dot. Chosen by us, never taken from the uploaded filename. */
  readonly extension: string;
}

/**
 * The closed list, by purpose.
 *
 * Narrow on purpose: every accepted type is a format some parser somewhere will
 * open, and a course needs four of them. `text/vtt` is the only text format, and
 * it is captions — WCAG 1.2.2 is Level A, so it is not optional.
 */
export const UPLOAD_TYPES: Readonly<
  Record<UploadPurpose, readonly AcceptedUploadType[]>
> = {
  video: [
    { mimeType: "video/mp4", extension: "mp4" },
    { mimeType: "video/webm", extension: "webm" },
    { mimeType: "audio/mpeg", extension: "mp3" },
    { mimeType: "audio/mp4", extension: "m4a" },
  ],
  captions: [{ mimeType: "text/vtt", extension: "vtt" }],
  poster: [
    { mimeType: "image/jpeg", extension: "jpg" },
    { mimeType: "image/png", extension: "png" },
    { mimeType: "image/webp", extension: "webp" },
  ],
  // Mediathek downloads. PDF only: a Word document or a spreadsheet handed to a
  // physician from a CME platform is a macro target, and every handout MEDICE
  // has supplied so far is a PDF anyway.
  material: [{ mimeType: "application/pdf", extension: "pdf" }],
};

const MiB = 1024 * 1024;

/**
 * The ceiling per purpose.
 *
 * `video` was 2 GiB because that is where a **single** PUT stops being
 * sensible: an upload that fails at 90 % started again from zero, which is
 * tolerable for the 300–800 MB a 25-minute lecture weighs and is not tolerable
 * much beyond it. That comment ended *"the day multipart is built the limit
 * moves with it"*, and P129-01 is that day — 5 GiB, at the client's request,
 * because they have 3 GB lectures.
 *
 * The number moved **because the failure mode changed**, not because somebody
 * needed a bigger one. Raising it without multipart would have been the worst
 * of both: the same all-or-nothing upload, now failing after forty minutes
 * instead of fifteen.
 */
export const UPLOAD_MAX_BYTES: Readonly<Record<UploadPurpose, number>> = {
  video: 5120 * MiB,
  captions: 2 * MiB,
  poster: 10 * MiB,
  material: 200 * MiB,
};

/**
 * The ceiling as a person reads it — "5 GB", "200 MB" (P133-01).
 *
 * ## Why this is in the domain and not in a locale file
 *
 * It was in the locale files, four times, as the literal text "2 GB". P129-01
 * raised `UPLOAD_MAX_BYTES.video` to 5 GiB and every one of those sentences went
 * on saying 2 GB — so the console told an author their 3 GB lecture would be
 * refused by a server that would have accepted it, and the client found it by
 * reading the screen.
 *
 * That is CLAUDE.md §9.3 in its plainest form: the rule moved and the sentence
 * stating the rule did not, because nothing connected them. The connection is
 * this function. A hint is now derived from the same constant the API enforces,
 * so the two cannot disagree again without somebody deliberately unpicking it.
 *
 * Binary units, decimal label — 5120 MiB reads as "5 GB", the way every file
 * manager has always shown it. The alternative is telling a physician's editor
 * "5.37 GB", which is more accurate and less true.
 */
export function uploadLimitLabel(purpose: UploadPurpose): string {
  const bytes = UPLOAD_MAX_BYTES[purpose];
  const mib = bytes / MiB;
  // No fractions on purpose: every ceiling here is a whole number of MiB or GiB,
  // and a hint reading "0.5 GB" would be a worse answer than "512 MB".
  return mib >= 1024 ? `${mib / 1024} GB` : `${mib} MB`;
}

export type UploadRejection =
  /** Not one of the four purposes. A client that invented a fifth. */
  | "unknown_purpose"
  /** Not in the list for this purpose. */
  | "unsupported_type"
  /** Zero bytes. Nothing to sign, and a browser that offered it is confused. */
  | "empty"
  /** Over the ceiling for this purpose. */
  | "too_large";

export type UploadPlan =
  | {
      readonly ok: true;
      readonly purpose: UploadPurpose;
      /** Normalised, and the value that will be bound into the signature. */
      readonly mimeType: string;
      readonly extension: string;
      readonly sizeBytes: number;
    }
  | { readonly ok: false; readonly reason: UploadRejection };

function purposeOf(value: string): UploadPurpose | undefined {
  return value === "video" ||
    value === "captions" ||
    value === "poster" ||
    value === "material"
    ? value
    : undefined;
}

/**
 * Decide whether this upload may proceed, before anything is signed.
 *
 * Order matters for the message the author sees: an unsupported type is
 * reported before a size problem, because "we do not take .mov" is actionable
 * and "too large" on a file we would have refused anyway is not.
 *
 * A `sizeBytes` that is not a non-negative integer is `empty` rather than a
 * separate rejection. The caller has already parsed it as a number; the only
 * ways to arrive here with a fraction or a negative are a hand-made request, and
 * they all mean the same thing — there is no file.
 */
export function planUpload(input: {
  readonly purpose: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
}): UploadPlan {
  const purpose = purposeOf(input.purpose.trim().toLowerCase());
  if (purpose === undefined) return { ok: false, reason: "unknown_purpose" };

  // Browsers append parameters — `text/vtt; charset=utf-8` is what a file picker
  // reports for a caption file. The parameter is dropped rather than refused,
  // and the signature binds the bare type we chose.
  const declared = (input.mimeType.split(";")[0] ?? "").trim().toLowerCase();
  const accepted = UPLOAD_TYPES[purpose].find((type) => type.mimeType === declared);
  if (accepted === undefined) return { ok: false, reason: "unsupported_type" };

  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes <= 0) {
    return { ok: false, reason: "empty" };
  }
  if (input.sizeBytes > UPLOAD_MAX_BYTES[purpose]) {
    return { ok: false, reason: "too_large" };
  }

  return {
    ok: true,
    purpose,
    mimeType: accepted.mimeType,
    extension: accepted.extension,
    sizeBytes: input.sizeBytes,
  };
}

/** The token shape `uploadObjectName` will accept. Hex or base32-ish, no case games. */
const TOKEN = /^[a-z0-9]{8,64}$/;

export class InvalidUploadTokenError extends Error {
  constructor() {
    super("upload token must be 8-64 lowercase alphanumerics");
    this.name = "InvalidUploadTokenError";
  }
}

/**
 * The object's filename — ours, never the uploader's.
 *
 * The name a file picker reports is attacker-influenced, may carry a patient
 * name or a working title nobody meant to publish, and would have to be
 * sanitised into `SAFE_SEGMENT` anyway. Generating it removes the entire class:
 * no collisions, no escapes, no `..`, nothing to leak, and the extension is the
 * one we approved rather than the one the file claimed.
 *
 * The purpose is kept in the name because an operator looking at a bucket
 * listing during an incident should be able to tell a poster from a lecture
 * without joining against the database.
 */
export function uploadObjectName(
  purpose: UploadPurpose,
  token: string,
  extension: string,
): string {
  if (!TOKEN.test(token)) throw new InvalidUploadTokenError();
  return `${purpose}-${token}.${extension}`;
}

/*
 * ---------------------------------------------------------------------------
 * Multipart (P129-01)
 * ---------------------------------------------------------------------------
 */

/**
 * How big one part is.
 *
 * Bounded on both sides by things that are not preferences:
 *
 * - **S3 requires every part except the last to be at least 5 MiB**, and allows
 *   at most **10,000 parts**. At 5 MiB the ceiling would be 48 GiB, so the
 *   minimum is not the binding constraint here; the part *count* is what a
 *   small part size would cost.
 * - A failed part is re-uploaded whole, so the part size is also the unit of
 *   wasted work. 32 MiB is about eight seconds on a 32 Mbit/s clinic
 *   connection — small enough that losing one is unremarkable.
 *
 * 32 MiB puts a 5 GiB file at 160 parts, comfortably inside the limit, and a
 * 3 GB lecture at 96.
 */
export const MULTIPART_PART_BYTES = 32 * MiB;

/** S3's own ceiling. Not ours to raise, and worth failing on explicitly. */
export const MULTIPART_MAX_PARTS = 10_000;

/**
 * Where a single PUT stops being worth it.
 *
 * Below this a file is one request and one signature — cheaper than three API
 * calls and a part loop, and the failure it risks costs seconds. The threshold
 * is the part size itself: a file that would be one part has nothing to gain.
 */
export const MULTIPART_THRESHOLD_BYTES = MULTIPART_PART_BYTES;

export interface MultipartPlan {
  readonly partCount: number;
  readonly partBytes: number;
}

/**
 * How a file of this size is split, or why it is not.
 *
 * Pure, exhaustively testable, and the single place the arithmetic lives — the
 * server signs `partCount` URLs and the browser slices on the same boundaries,
 * so a disagreement between them is a corrupt object that verifies as the right
 * *size*. One function, called by both.
 */
export function planMultipart(sizeBytes: number): MultipartPlan | undefined {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) return undefined;
  if (sizeBytes < MULTIPART_THRESHOLD_BYTES) return undefined;

  const partCount = Math.ceil(sizeBytes / MULTIPART_PART_BYTES);
  if (partCount > MULTIPART_MAX_PARTS) return undefined;

  return { partCount, partBytes: MULTIPART_PART_BYTES };
}

/** The byte range of one part, zero-based and end-exclusive, as `Blob.slice` wants. */
export function partRange(
  plan: MultipartPlan,
  sizeBytes: number,
  partNumber: number,
): { readonly start: number; readonly end: number } | undefined {
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > plan.partCount) {
    return undefined;
  }
  const start = (partNumber - 1) * plan.partBytes;
  return { start, end: Math.min(start + plan.partBytes, sizeBytes) };
}
