/**
 * Putting a file into object storage (P23-04, extracted in P90-01).
 *
 * ## Why this is a module of its own now
 *
 * It lived in `UploadField.tsx` and had two consumers there: the field itself
 * and the video sources editor. P90-01 added a third — the media dialog — and
 * the dialog is *rendered by* the field, so importing the upload out of it
 * would have made a cycle between two component modules. The plumbing is not a
 * component and does not belong in one.
 *
 * ## What it is not
 *
 * It is not a file input that posts to the API. The bytes go **straight to
 * object storage** over a short-lived signed URL: the console asks the API for
 * permission, uploads, and then asks the API to confirm the object landed.
 * `@ds/sdk`'s `uploadToTicket` is the only part that talks to the bucket, and it
 * deliberately sends no cookie, no bearer token and no tenant header — the
 * signature is the authorisation, and a shared request helper is how a
 * credential eventually ends up at a third-party host.
 */

import { srtToVtt } from "@ds/domain";
import type { ApiClient, UploadPurpose } from "@ds/sdk";
import { uploadToTicket } from "@ds/sdk";
import { de } from "./locale/de.js";
import type { MediaKind } from "./media-library.js";

/**
 * Which family of the library a purpose should offer (P88-02).
 *
 * A field asks for the kind it could actually accept, because offering a PDF
 * where a poster belongs is a choice that ends in a refusal (§9.2). Mirrors
 * `ACCEPT`.
 */
export const LIBRARY_KIND: Readonly<Record<UploadPurpose, MediaKind>> = {
  video: "video",
  poster: "image",
  material: "application",
  // WebVTT is `text/vtt`, so the library's own first-token filter is `text` —
  // the same rule the API indexes on rather than a second opinion here.
  captions: "text",
};

/**
 * What a file picker should offer per purpose. Mirrors `UPLOAD_TYPES`.
 *
 * `captions` offers `.srt` as well, and that is not a widening of what the
 * platform stores (P74-05). An SRT is converted to WebVTT here, before the
 * upload, so the object in the bucket is `text/vtt` exactly as before — see
 * `prepare`. Offering it is the point: SRT is what comes out of every
 * transcription service, and `<track>` takes WebVTT and nothing else.
 */
export const ACCEPT: Readonly<Record<UploadPurpose, string>> = {
  video: "video/mp4,video/webm,audio/mpeg,audio/mp4",
  captions: "text/vtt,.vtt,.srt,application/x-subrip",
  poster: "image/jpeg,image/png,image/webp",
  material: "application/pdf",
};

export function isUploadedReference(value: string): boolean {
  return value.startsWith("s3://");
}

/** The object's own filename, for a chip a human can recognise. */
export function referenceName(value: string): string {
  return value.split("/").at(-1) ?? value;
}

/** Run the three-step upload and report the reference. */
export async function runUpload(
  client: ApiClient,
  courseSlug: string,
  purpose: UploadPurpose,
  chosen: File,
  onProgress: (percent: number) => void,
  signal: AbortSignal,
): Promise<{ reference: string; mimeType: string }> {
  const file = await prepare(purpose, chosen);

  const ticket = await client.adminBeginUpload(courseSlug, {
    purpose,
    // `file.type` is empty for some files on some platforms — a `.vtt` picked
    // in Safari is the usual one. Falling back to the purpose's own type lets
    // the server decide rather than failing here with nothing to say.
    mimeType: file.type === "" ? fallbackType(purpose) : file.type,
    sizeBytes: file.size,
  });

  await uploadToTicket(ticket, file, { onProgress, signal });

  // Not optional. Without it there is no reference, and the server has not
  // checked that the bucket holds what it approved.
  const confirmed = await client.adminCompleteUpload(courseSlug, ticket.key);
  return { reference: confirmed.reference, mimeType: confirmed.mimeType };
}

/**
 * The file as it should reach the bucket (P74-05).
 *
 * Only captions have anything to do here, and only when the author picked an
 * SRT. `<track src>` takes **WebVTT and nothing else**: a browser handed an
 * `.srt` fires `error` on the track and shows no captions at all, silently,
 * with the video playing perfectly. So an author who uploaded subtitles and saw
 * no complaint would have a course without them, and would find out from a
 * physician who could not follow it.
 *
 * Converting here rather than at play time means the stored object is genuinely
 * `text/vtt`: the API's upload rules do not learn a second format, nothing
 * converts on the learner's path, and a file downloaded from the Mediathek is
 * what its name says.
 *
 * A file that is already WebVTT, or that is not subtitles at all, is passed
 * through untouched. The second is deliberate: the server refuses it with a
 * German message written for this screen, which is a better refusal than
 * anything this function could invent, and a converter that repaired its input
 * would produce plausible nonsense.
 */
async function prepare(purpose: UploadPurpose, file: File): Promise<File> {
  if (purpose !== "captions") return file;

  const converted = srtToVtt(await readText(file));
  if (!converted.ok) return file;

  return new File([converted.vtt], toVttName(file.name), { type: "text/vtt" });
}

/**
 * The file's text, from whichever API this browser has.
 *
 * `Blob.prototype.text()` is the modern one and is what nearly every visitor
 * uses. `FileReader` is the fallback, and it is not hypothetical: Safari gained
 * `text()` only in 14, and jsdom — which is what the console's own tests run
 * in — does not implement it at all. Without this the conversion threw in a
 * `try` that reported it as "the upload failed", which is a message about the
 * wrong thing.
 */
async function readText(file: File): Promise<string> {
  if (typeof file.text === "function") return file.text();

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result ?? "")));
    reader.addEventListener("error", () =>
      reject(reader.error ?? new Error("the file could not be read")),
    );
    reader.readAsText(file);
  });
}

/**
 * `untertitel.srt` → `untertitel.vtt`. The extension is a lie otherwise.
 *
 * `lastIndexOf` rather than a regular expression anchored at the end: a
 * repetition before `$` backtracks quadratically, and the input here is a
 * filename somebody chose.
 */
function toVttName(name: string): string {
  const dot = name.lastIndexOf(".");
  const stem = dot <= 0 ? name : name.slice(0, dot);
  return `${stem}.vtt`;
}

function fallbackType(purpose: UploadPurpose): string {
  return purpose === "captions"
    ? "text/vtt"
    : purpose === "material"
      ? "application/pdf"
      : purpose === "poster"
        ? "image/jpeg"
        : "video/mp4";
}

/**
 * What to tell the author when an upload fails.
 *
 * The API's problem details already carry a German `detail` written for this
 * screen — "die Datei ist zu groß", "dieses Dateiformat wird nicht
 * unterstützt". Preferring it over a generic string is the difference between
 * an author fixing the file and an author filing a ticket.
 *
 * `uploadToTicket` throws its own plain-English strings for transport failures,
 * which are replaced here because an author should never see one.
 */
export function describeUploadFailure(error: unknown): string {
  if (error instanceof Error && error.message !== "") {
    if (error.message.includes("cancelled")) return de.uploads.cancelled;
    if (
      error.message.includes("object storage") ||
      error.message.includes("connection")
    ) {
      return de.uploads.transportFailed;
    }
    return error.message;
  }
  return de.uploads.failed;
}
