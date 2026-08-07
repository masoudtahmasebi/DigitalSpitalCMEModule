/**
 * The upload contract (P23-01). Interface layer — ADR-0006.
 *
 * Two requests, deliberately. `begin` asks for permission and gets a signature;
 * `complete` says the bytes are there and gets back the reference to store.
 * A single call cannot do both, because between them the browser talks to a
 * bucket this API is not part of.
 *
 * ## What the client is allowed to say
 *
 * Very little. It names a purpose, a type and a size — and every one of those
 * is a *claim* that is checked (`planUpload`) rather than a setting. It never
 * names a key, a prefix, a bucket or a filename: those are derived server-side
 * from the validated session, which is what makes the tenant boundary hold in a
 * store that has no row-level security.
 *
 * On `complete` it names the key, because it has to say *which* upload. That is
 * the one client-supplied identifier here, and it is checked twice: it must sit
 * under the caller's own customer prefix, and it must match a `mint` this
 * tenant actually recorded. The expected size and type are then read from that
 * recorded mint, never from this request — see `upload.service.ts`.
 */

import { z } from "zod";

export const uploadBeginSchema = z.object({
  /** Decides both the accepted types and the size ceiling (`UPLOAD_TYPES`). */
  purpose: z.enum(["video", "captions", "poster", "material"]),
  /** As the file picker reported it. A `; charset=…` parameter is tolerated. */
  mimeType: z.string().trim().min(1).max(200),
  /**
   * The exact byte length, which becomes a **signed** header.
   *
   * Bounded here only to keep an absurd number out of the arithmetic; the real
   * ceiling is per purpose and lives in `@ds/domain`, so there is one place that
   * knows how large a lecture may be. 8 GiB is comfortably above every ceiling
   * and comfortably below `Number.MAX_SAFE_INTEGER`.
   */
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(8 * 1024 * 1024 * 1024),
});

export const uploadCompleteSchema = z.object({
  /**
   * The key `begin` issued. Not a URL: a URL would carry a signature, and a
   * signature in a request body ends up in a log.
   */
  key: z.string().trim().min(1).max(1024),
});

export type UploadBegin = z.infer<typeof uploadBeginSchema>;
export type UploadComplete = z.infer<typeof uploadCompleteSchema>;

/** What `begin` answers with. The URL is short-lived and never logged. */
export interface UploadTicketResponse {
  readonly key: string;
  readonly url: string;
  readonly method: "PUT";
  readonly headers: Readonly<Record<string, string>>;
  readonly expiresAt: string;
}

/** What `complete` answers with once the bucket has confirmed the object. */
export interface UploadConfirmedResponse {
  /** The value to store in a content's `videoUrl`, `fileUrl` or `posterUrl`. */
  readonly reference: string;
  /** As the **bucket** reports them, not as the client declared them. */
  readonly sizeBytes: number;
  readonly mimeType: string;
}
