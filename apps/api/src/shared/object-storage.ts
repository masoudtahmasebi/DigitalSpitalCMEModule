/**
 * Minting and verifying direct-to-storage uploads (P23-01). Infrastructure — ADR-0006.
 *
 * ## Why the bytes do not come through the API
 *
 * A 700 MB lecture through a Node process is a request that outlives every
 * proxy timeout in the path, a memory profile that depends on how many authors
 * upload at once, and a body-size limit somebody has to raise everywhere from
 * Caddy down. Handing the browser a signed URL and letting it talk to the
 * bucket removes all of it — the API's part is a few hundred bytes of JSON.
 *
 * What the API keeps is the part that matters: **it decides the key**. The
 * customer id comes from the validated session, the course id from a row RLS
 * already agreed the caller can see, and the filename is generated. A client
 * never names a prefix, so there is no request an author can craft that writes
 * into another customer's space. That is the object-storage half of ADR-0002 —
 * a bucket has no row-level security to fall back on, so the guarantee has to
 * be in the key.
 *
 * ## Trust, and where it is repaid
 *
 * A signed PUT is a capability, so the signature carries everything we are
 * willing to allow: one key, one content type, one exact length, for a few
 * minutes. What it cannot carry is what the bytes *are* — the API never sees
 * them (see `packages/domain/src/upload.ts` for why that is acceptable).
 *
 * So the upload is checked afterwards. `verifyUpload` HEADs the object and
 * compares the stored length and content type against what was approved, and
 * **deletes the object when they disagree**. Three things make that worth
 * doing rather than trusting the signature alone:
 *
 * - not every S3-compatible implementation enforces a signed `content-length`
 *   with the same rigour, and we deploy against Hetzner rather than Amazon;
 * - "the browser reported success" and "the bytes are in the bucket" are
 *   different claims, and only the second one should produce a course that
 *   points at an object;
 * - an object we refused still costs storage, still lands in every backup, and
 *   still has to be explained by whoever reads a bucket listing during an
 *   incident.
 *
 * Nothing here is ever logged with a credential in it. The signing key stays in
 * `S3Presigner`; this module only ever handles URLs it produced.
 */

import { courseAssetKey, planUpload, uploadObjectName } from "@ds/domain";
import type { UploadPlan, UploadPurpose } from "@ds/domain";
import { randomBytes } from "node:crypto";
import type { Presigner } from "./s3-presigner.js";

export interface UploadTicket {
  /** The storage key. Built here; never supplied by a client. */
  readonly key: string;
  /** What the course row will hold once the upload verifies: `s3://<key>`. */
  readonly reference: string;
  /** Where the browser PUTs the bytes. Short-lived. */
  readonly url: string;
  /**
   * The headers the browser must send, verbatim.
   *
   * Only `Content-Type`: `Content-Length` is signed too, but a browser computes
   * it from the body and forbids script from setting it — which is precisely
   * what makes signing it a real constraint rather than a request the client
   * fills in.
   */
  readonly headers: Readonly<Record<string, string>>;
  readonly expiresAt: Date;
  readonly maxBytes: number;
}

export type UploadRefusal =
  /** `planUpload` said no — wrong type, wrong size, unknown purpose. */
  | { readonly kind: "rejected"; readonly reason: string }
  /** The object is not there. The browser's PUT did not actually land. */
  | { readonly kind: "missing" }
  /** It is there and is not what we approved. Deleted. */
  | { readonly kind: "mismatch"; readonly reason: string }
  /** The bucket could not be reached, or answered something unusable. */
  | { readonly kind: "unreachable"; readonly reason: string };

export interface VerifiedUpload {
  readonly key: string;
  readonly reference: string;
  readonly sizeBytes: number;
  readonly contentType: string;
}

export class ObjectStorage {
  constructor(
    private readonly presigner: Presigner,
    private readonly uploadTtlSec: number,
    /** Injected so tests are not at the mercy of a real network. */
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /**
   * Plan an upload, or say why not.
   *
   * Separate from `mint` so the rules can be exercised without a presigner and
   * so a caller can report a refusal before anything is signed. A signature
   * that is minted and then discarded is a capability that briefly existed for
   * no reason.
   */
  plan(input: {
    readonly purpose: string;
    readonly mimeType: string;
    readonly sizeBytes: number;
  }): UploadPlan {
    return planUpload(input);
  }

  /**
   * Turn an accepted plan into a signed PUT for exactly one object.
   *
   * The random token is 16 bytes of `randomBytes`, not a counter and not a
   * hash of anything: two authors uploading the same file to the same course
   * must not collide, and a predictable name in a bucket whose listing is not
   * public is still a name somebody could guess at.
   */
  mint(
    plan: Extract<UploadPlan, { ok: true }>,
    scope: { readonly customerId: string; readonly courseId: string },
    now: Date,
  ): UploadTicket {
    const key = courseAssetKey({
      customerId: scope.customerId,
      courseId: scope.courseId,
      filename: uploadObjectName(
        plan.purpose,
        randomBytes(16).toString("hex"),
        plan.extension,
      ),
    });

    return {
      key,
      reference: `s3://${key}`,
      url: this.presigner.presignPut(key, this.uploadTtlSec, now, {
        contentType: plan.mimeType,
        contentLength: plan.sizeBytes,
      }),
      headers: { "Content-Type": plan.mimeType },
      expiresAt: new Date(now.getTime() + this.uploadTtlSec * 1000),
      maxBytes: plan.sizeBytes,
    };
  }

  /**
   * A short-lived URL a browser can read one object from (P74-02).
   *
   * The console needs this for two things a filename cannot do: show the author
   * what they just uploaded, and let the browser read a video's own header to
   * fill `durationSec` — which is a compliance input, because the watch gate is
   * a percentage of it.
   *
   * `presignGet` and nothing else. The caller has already established that the
   * key is inside the course it named, and a read signature must not be
   * reachable from a code path that could also write or delete: this is the
   * same reason `media-url.ts` takes a `ReadPresigner`.
   */
  readUrl(key: string, ttlSec: number, now: Date): string {
    return this.presigner.presignGet(key, ttlSec, now);
  }

  /**
   * Confirm the bytes arrived and are what we approved.
   *
   * Returns the verified facts on success so the caller records the size and
   * type the **bucket** reports rather than the ones the client declared — the
   * two agreeing is the point of the check, and storing the client's numbers
   * afterwards would quietly discard it.
   */
  async verifyUpload(
    key: string,
    expected: { readonly contentType: string; readonly sizeBytes: number },
    now: Date,
  ): Promise<
    { ok: true; upload: VerifiedUpload } | { ok: false; refusal: UploadRefusal }
  > {
    let response: Response;
    try {
      response = await this.fetchImpl(this.presigner.presignHead(key, 60, now), {
        method: "HEAD",
      });
    } catch (error) {
      // The message, never the URL: it carries a signature.
      return {
        ok: false,
        refusal: { kind: "unreachable", reason: describe(error) },
      };
    }

    if (response.status === 404) return { ok: false, refusal: { kind: "missing" } };
    if (!response.ok) {
      return {
        ok: false,
        refusal: { kind: "unreachable", reason: `bucket answered ${response.status}` },
      };
    }

    const declaredLength = response.headers.get("content-length");
    const sizeBytes = Number(declaredLength);
    // `content-type` may carry a parameter the store added; compare the type.
    const contentType = (response.headers.get("content-type") ?? "")
      .split(";")[0]
      ?.trim()
      .toLowerCase();

    if (declaredLength === null || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
      return this.discard(key, now, "the stored object has no usable length");
    }
    if (sizeBytes !== expected.sizeBytes) {
      // Not "larger than" — *different*. A shorter object is a truncated upload
      // and a longer one is a size that was not the one we signed; both are
      // reasons to refuse rather than to store a reference to a file whose
      // provenance we can no longer describe.
      return this.discard(
        key,
        now,
        `stored ${sizeBytes} bytes, approved ${expected.sizeBytes}`,
      );
    }
    if (contentType !== expected.contentType) {
      return this.discard(
        key,
        now,
        `stored as ${contentType === "" ? "no type" : contentType}, approved ${expected.contentType}`,
      );
    }

    return {
      ok: true,
      upload: { key, reference: `s3://${key}`, sizeBytes, contentType },
    };
  }

  /**
   * Remove an object we will not accept, and report the mismatch either way.
   *
   * A failed delete does not change the answer — the upload is still refused —
   * so it is folded into the reason rather than thrown. The alternative is an
   * exception that turns "your file was the wrong size" into a 500.
   */
  private async discard(
    key: string,
    now: Date,
    reason: string,
  ): Promise<{ ok: false; refusal: UploadRefusal }> {
    let note = "";
    try {
      const response = await this.fetchImpl(this.presigner.presignDelete(key, 60, now), {
        method: "DELETE",
      });
      if (!response.ok && response.status !== 404) {
        note = `; the object could not be removed (${response.status})`;
      }
    } catch (error) {
      note = `; the object could not be removed (${describe(error)})`;
    }

    return { ok: false, refusal: { kind: "mismatch", reason: `${reason}${note}` } };
  }
}

/** An error's message, with no chance of an object stringifying to a URL. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

/** Narrowing helper for callers that hold a purpose as a string. */
export function isUploadPurpose(value: string): value is UploadPurpose {
  return (
    value === "video" ||
    value === "captions" ||
    value === "poster" ||
    value === "material"
  );
}
