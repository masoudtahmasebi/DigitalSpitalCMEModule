/**
 * What a stored media field may contain (P211-01).
 *
 * Two forms, and both are legitimate:
 *
 * - `https://…` — the customer serves the file from their own CDN. This is
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
    (value) => value.startsWith("s3://") || z.string().url().safeParse(value).success,
    "must be an absolute URL or an s3:// reference",
  );
