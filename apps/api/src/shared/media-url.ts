/**
 * Turning a stored media reference into something a browser can fetch (P10-09).
 *
 * A `contents.video_url` or `contents.file_url` holds one of two things:
 *
 * - `https://…` — the customer serves this from their own CDN. Passed through
 *   untouched, which is what lets an existing customer migrate to this platform
 *   without moving their media first.
 * - `s3://<key>` — the object lives in our storage. The API mints a short-lived
 *   presigned URL for exactly that object.
 *
 * ## The two checks, and why both are here
 *
 * 1. **The key must belong to the caller's customer.** `keyBelongsToCustomer`
 *    compares on a segment boundary, so `…0001` cannot read `…00012`'s objects.
 *    The customer id comes from the validated token; the key comes from a
 *    database row. A mis-seeded or tampered row is therefore refused rather
 *    than signed — the bucket has no RLS to fall back on.
 *
 * 2. **The caller has already passed the sequence gate.** Not checked here, and
 *    that is deliberate: this function is only ever called from inside
 *    `getLesson` and `getMaterials`, after `requireReachableContent` or the
 *    module rollup has agreed. Re-deriving the gate here would be a second
 *    implementation of it, which CLAUDE.md §4 invariant 6 exists to prevent.
 *
 * A refusal returns `null`, the same value the caller already uses for "locked"
 * — so a bad key degrades to a padlock rather than to an error page.
 */

import { keyBelongsToCustomer, storageKeyOf } from "@ds/domain";
import type { Presigner } from "./s3-presigner.js";

export interface MediaResolver {
  /** A fetchable URL, or null when there is nothing safe to hand out. */
  resolve(stored: string | null, customerId: string, now: Date): string | null;
}

/**
 * The resolver a deployment with object storage configured uses.
 *
 * `ttlSec` is short by design: a presigned URL is a capability, and one copied
 * out of a browser's network tab keeps working until it expires.
 */
export class PresigningMediaResolver implements MediaResolver {
  constructor(
    private readonly presigner: Presigner,
    private readonly ttlSec: number,
  ) {}

  resolve(stored: string | null, customerId: string, now: Date): string | null {
    if (stored === null || stored === "") return null;

    const key = storageKeyOf(stored);
    // Not an s3:// reference: an ordinary URL the customer already serves.
    if (key === undefined) return stored;

    if (!keyBelongsToCustomer(key, customerId)) {
      // Deliberately silent to the caller and indistinguishable from "no
      // media". Telling a client that an object exists but is not theirs is
      // more information than the refusal needs to convey.
      return null;
    }

    return this.presigner.presignGet(key, this.ttlSec, now);
  }
}

/**
 * The resolver for a deployment with no object storage.
 *
 * Passes plain URLs through and refuses `s3://` references, because it has no
 * way to sign one. That combination is the honest behaviour for a course
 * configured for storage on a system that has none: the padlock stays shut
 * rather than the URL leaking unsigned.
 */
export class PassthroughMediaResolver implements MediaResolver {
  resolve(stored: string | null): string | null {
    if (stored === null || stored === "") return null;
    return storageKeyOf(stored) === undefined ? stored : null;
  }
}
