/**
 * What a stored media field may contain (P211-01).
 *
 * Two forms, and both are legitimate:
 *
 * - `https://…` (never `http:`, P247-02) — the customer serves the file from their own CDN. This is
 *   what lets an existing customer migrate to the platform without moving
 *   their media first, and it is what the client is using today: *"I have
 *   pasted an URL of a plattform image. At least it is working."*
 * - `s3://<key>` — the object lives in our storage, uploaded through the
 *   Mediathek. `shared/media-url.ts` signs it on the way out and refuses a key
 *   belonging to another customer.
 *
 * ## Why this moved out of `authoring.dto.ts`
 *
 * It lived there, private, while the only fields that could hold a reference
 * were a lesson's video, poster, captions and material. The course hero image
 * and a Referent's photograph are edited through `admin.dto.ts` and were
 * `z.string().url()` — correct for a field whose only affordance was a text
 * box, and wrong the moment those fields started offering the Mediathek.
 *
 * Two modules validating the same thing is exactly the shape §9.10b is about:
 * copying the refinement into `admin.dto.ts` would have been three lines and a
 * second opinion that can drift. So it has one home, and both import it.
 *
 * ## What it deliberately does not check
 *
 * That the key belongs to the caller. A DTO sees a string, not a tenant, and a
 * check that looks like the real one but is not is worse than none —
 * `media-url.ts` does it where the customer id is actually known.
 */

import { z } from "zod";

export const mediaReference = z
  .string()
  .trim()
  .max(2000)
  .refine(
    (value) => value.startsWith("s3://") || isHttpsUrl(value),
    "must be an https:// URL or an s3:// reference",
  );

/**
 * `https:` only, since P247-02.
 *
 * It was any absolute URL, and the media check fetches what is stored here —
 * so `http://127.0.0.1:5432/` and `http://169.254.169.254/` were valid media
 * and the check reported what answered (SEC-2). A customer's CDN serves
 * `https://` anyway: a browser on the portal refuses mixed content, so an
 * `http:` video never played for a learner either. Applies on write; rows
 * stored earlier are read as they are and the media check still vets their
 * host.
 */
function isHttpsUrl(value: string): boolean {
  if (!URL.canParse(value)) return false;
  return new URL(value).protocol === "https:";
}
