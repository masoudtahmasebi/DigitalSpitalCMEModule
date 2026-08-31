/**
 * Reclaiming what abandoned uploads hold (P129-03).
 *
 * ## The cost nobody can see
 *
 * A multipart upload that is never completed or aborted keeps every part the
 * bucket received. Those parts are stored, are billed, and appear in **no
 * object listing** — so a browser closed at 80 % of a 3 GB lecture leaves
 * 2.4 GB behind that nothing in any console will ever show you. Repeat that
 * across a few authors and a few weeks and the only symptom is an invoice.
 *
 * `abortMultipart` is the polite path and it covers the cases the API learns
 * about. It cannot cover the ones it does not: a closed laptop, a lost
 * connection, a tab that crashed. Only the bucket can, and only if it is told.
 *
 * ## Why this is applied rather than documented
 *
 * CLAUDE.md §9.9a, in its strongest form: *documentation instructing a human to
 * apply a setting is a setting that is not applied.* The bucket's CORS rule sat
 * in `config.env.example` under "you have to do this once, by hand" from P23-04
 * until P70 — with the exact policy to paste — and on every installation the
 * platform has ever had, nobody did it. Every video upload was refused by the
 * browser for months, with a clean API log.
 *
 * So this runs on every deploy, like `bucket-cors.ts` beside it, and is
 * idempotent: applying a rule the bucket already has is the same request.
 *
 * ## Why it warns where CORS fails
 *
 * A bucket without a CORS rule means nobody can upload — the product is broken
 * and the deploy should say so. A bucket without a lifecycle rule works
 * perfectly and slowly wastes money. Those deserve different exit codes, and
 * conflating them would make an S3-compatible store that does not implement
 * lifecycle at all into a failed deployment of a working platform.
 */

import { createHash } from "node:crypto";

export interface BucketLifecyclePresigner {
  presignBucketLifecycle(
    method: "GET" | "PUT",
    expiresInSec: number,
    now: Date,
    contentMd5?: string,
  ): string;
}

/**
 * One day.
 *
 * Long enough that a genuinely slow upload — a 5 GiB file on a bad connection,
 * paused overnight by a closed laptop — is not cut off underneath somebody who
 * would have resumed it. Short enough that abandoned parts are not a standing
 * cost. S3 measures this from the upload's *initiation*, not from its last
 * activity, which is the reason not to make it shorter: a resumable upload that
 * is still being resumed at hour 23 would lose its parts at hour 24 either way,
 * and a day is the smallest value where that is unlikely rather than routine.
 */
export const ABORT_INCOMPLETE_AFTER_DAYS = 1;

/** The rule, as the bucket wants it. Applies to every key: uploads have prefixes, waste does not. */
export function lifecycleConfigurationXml(days: number): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<LifecycleConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">' +
    "<Rule>" +
    "<ID>ds-abort-incomplete-multipart</ID>" +
    "<Filter><Prefix></Prefix></Filter>" +
    "<Status>Enabled</Status>" +
    `<AbortIncompleteMultipartUpload><DaysAfterInitiation>${String(days)}` +
    "</DaysAfterInitiation></AbortIncompleteMultipartUpload>" +
    "</Rule>" +
    "</LifecycleConfiguration>"
  );
}

export function contentMd5(body: string): string {
  return createHash("md5").update(body, "utf8").digest("base64");
}

export type LifecycleOutcome =
  { readonly ok: true } | { readonly ok: false; readonly reason: string };

/**
 * Apply the rule. Reports rather than throws — the caller decides what a
 * failure is worth, and here it is a warning rather than a dead deploy.
 */
export async function applyBucketLifecycle(
  presigner: BucketLifecyclePresigner,
  days: number,
  now: Date,
  fetchImpl: typeof fetch = fetch,
): Promise<LifecycleOutcome> {
  const body = lifecycleConfigurationXml(days);
  const md5 = contentMd5(body);

  try {
    const response = await fetchImpl(
      presigner.presignBucketLifecycle("PUT", 300, now, md5),
      {
        method: "PUT",
        body,
        headers: { "Content-MD5": md5, "Content-Type": "application/xml" },
      },
    );

    return response.ok
      ? { ok: true }
      : { ok: false, reason: `the bucket answered ${response.status}` };
  } catch (error) {
    // The message, never the URL: it carries a signature.
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "unknown transport failure",
    };
  }
}
