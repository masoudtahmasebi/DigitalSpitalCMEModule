/**
 * Course media uploads (P23-01, P23-02). Application layer — ADR-0006.
 *
 * ## The two calls, and why the second one cannot be skipped
 *
 *   POST /admin/courses/{slug}/uploads            → a signed PUT, and a key
 *   (the browser uploads straight to the bucket)
 *   POST /admin/courses/{slug}/uploads/complete   → the reference to store
 *
 * A client that skips `complete` gets no reference, and a course cannot be
 * pointed at an object nobody confirmed. That is the whole reason it exists:
 * "the browser's PUT returned 200" is the client's word for it, and the
 * database row that decides what a physician watches should rest on the
 * bucket's.
 *
 * ## Where the tenant boundary is enforced
 *
 * Three times, in three different places, on purpose — object storage has no
 * row-level security underneath to catch what application code misses:
 *
 * 1. **Minting.** The key is built from `principal.customerId` and a course id
 *    RLS already agreed the caller can see. Nothing in the request contributes
 *    to it. There is no request shape that writes into another prefix.
 * 2. **Completing.** The client names a key, because it must say which upload.
 *    It has to sit under the caller's own prefix *and* match a mint this tenant
 *    recorded — and the mint lookup runs under RLS, so another customer's key
 *    has nothing to find regardless.
 * 3. **Storing the reference.** `authoring.service.ts` refuses an `s3://` value
 *    outside the caller's prefix, and `media-url.ts` refuses it again at read
 *    time.
 *
 * ## What is not checked, stated plainly
 *
 * Nobody here knows what the bytes are. The API never sees them — see
 * `packages/domain/src/upload.ts` for why that is an acceptable trade and what
 * carries the weight instead: the content type is bound into the signature, the
 * bucket is a different origin from the app, and the stored object is verified
 * against what was approved before any course points at it.
 */

import { AppError } from "../../shared/problem-details.js";
import type { ObjectStorage, UploadRefusal } from "../../shared/object-storage.js";
import { keyBelongsToCustomer } from "@ds/domain";
import type { StorageAuditPort, UploadRepositoryPort } from "./upload.repository.js";
import type {
  UploadBegin,
  UploadComplete,
  UploadConfirmedResponse,
  UploadTicketResponse,
} from "./upload.dto.js";

export interface UploadActor {
  readonly customerId: string;
  readonly userId: string | undefined;
}

/** German for the four ways `planUpload` can say no. */
const PLAN_MESSAGES: Readonly<Record<string, string>> = {
  unknown_purpose: "Für diesen Verwendungszweck können keine Dateien hochgeladen werden.",
  unsupported_type: "Dieses Dateiformat wird nicht unterstützt.",
  empty: "Die Datei ist leer.",
  too_large: "Die Datei ist zu groß.",
};

export class UploadService {
  constructor(
    private readonly repository: UploadRepositoryPort,
    private readonly audit: StorageAuditPort,
    /** Undefined when the deployment has no object storage configured. */
    private readonly storage: ObjectStorage | undefined,
  ) {}

  async begin(
    courseSlug: string,
    input: UploadBegin,
    actor: UploadActor,
    now: Date,
  ): Promise<UploadTicketResponse> {
    const storage = this.requireStorage();
    const courseId = await this.requireCourse(courseSlug);

    const plan = storage.plan(input);
    if (!plan.ok) {
      // Recorded even though nothing was signed. A rejected upload is a fact
      // about what somebody tried, and the object key it would have had does
      // not exist — so the key column names the course instead of inventing one.
      await this.record(actor, courseId, {
        action: "refuse",
        objectKey: `${actor.customerId}/courses/${courseId}/`,
        sizeBytes: input.sizeBytes,
        mimeType: input.mimeType,
        succeeded: false,
        detail: plan.reason,
      });

      throw new AppError(
        "validation",
        `upload refused: ${plan.reason}`,
        PLAN_MESSAGES[plan.reason] ?? "Diese Datei kann nicht hochgeladen werden.",
      );
    }

    const ticket = storage.mint(plan, { customerId: actor.customerId, courseId }, now);

    // Written **before** the URL is returned, and the size and type recorded
    // here are what `complete` will measure the stored object against. If this
    // insert fails the author gets an error instead of a signature, which is
    // the right way round: a capability nobody wrote down is one nobody can
    // account for afterwards.
    await this.record(actor, courseId, {
      action: "mint",
      objectKey: ticket.key,
      sizeBytes: plan.sizeBytes,
      mimeType: plan.mimeType,
      succeeded: true,
      detail: null,
    });

    return {
      key: ticket.key,
      url: ticket.url,
      method: "PUT",
      headers: ticket.headers,
      expiresAt: ticket.expiresAt.toISOString(),
    };
  }

  async complete(
    courseSlug: string,
    input: UploadComplete,
    actor: UploadActor,
    now: Date,
  ): Promise<UploadConfirmedResponse> {
    const storage = this.requireStorage();
    const courseId = await this.requireCourse(courseSlug);

    // Cheap and first: a key outside the caller's prefix is answered without a
    // database round trip and without a request to the bucket.
    if (!keyBelongsToCustomer(input.key, actor.customerId)) {
      await this.record(actor, courseId, {
        action: "refuse",
        objectKey: input.key,
        sizeBytes: null,
        mimeType: null,
        succeeded: false,
        detail: "key is outside this customer's prefix",
      });
      throw this.unknownUpload();
    }

    // The expected size and type come from the recorded mint, never from this
    // request. Taking them from the body would let a client choose both sides
    // of the comparison and make verification decorative.
    const mint = await this.repository.findMint(input.key);
    if (mint === undefined || mint.courseId !== courseId) {
      await this.record(actor, courseId, {
        action: "refuse",
        objectKey: input.key,
        sizeBytes: null,
        mimeType: null,
        succeeded: false,
        detail:
          mint === undefined
            ? "no matching upload was issued"
            : "the upload was issued for a different course",
      });
      throw this.unknownUpload();
    }

    const verified = await storage.verifyUpload(
      input.key,
      { contentType: mint.mimeType, sizeBytes: mint.sizeBytes },
      now,
    );

    if (!verified.ok) {
      await this.record(actor, courseId, {
        // A mismatch means `verifyUpload` deleted the object, which is a second
        // event and is recorded as one — an operator reading the log should not
        // have to know that "refuse" implies "and it was removed".
        action: "refuse",
        objectKey: input.key,
        sizeBytes: mint.sizeBytes,
        mimeType: mint.mimeType,
        succeeded: false,
        detail: refusalDetail(verified.refusal),
      });

      if (verified.refusal.kind === "mismatch") {
        await this.record(actor, courseId, {
          action: "delete",
          objectKey: input.key,
          sizeBytes: null,
          mimeType: null,
          succeeded: true,
          detail: "removed after failing verification",
        });
      }

      throw uploadFailed(verified.refusal);
    }

    await this.record(actor, courseId, {
      action: "store",
      objectKey: input.key,
      sizeBytes: verified.upload.sizeBytes,
      mimeType: verified.upload.contentType,
      succeeded: true,
      detail: null,
    });

    return {
      reference: verified.upload.reference,
      sizeBytes: verified.upload.sizeBytes,
      mimeType: verified.upload.contentType,
    };
  }

  // -------------------------------------------------------------------------

  private requireStorage(): ObjectStorage {
    if (this.storage !== undefined) return this.storage;

    // No degraded mode. An upload that appears to work against a bucket that
    // does not exist produces a course pointing at nothing, discovered by a
    // learner. Saying so here costs an author one clear message.
    throw new AppError(
      "conflict",
      "object storage is not configured on this deployment",
      "Auf diesem System ist kein Dateispeicher eingerichtet. Bitte hinterlegen Sie die Medien vorerst als URL.",
    );
  }

  private async requireCourse(slug: string): Promise<string> {
    const id = await this.repository.findCourseId(slug);
    if (id === undefined) {
      throw AppError.notFound(`course slug=${slug} not visible in this tenant`);
    }
    return id;
  }

  /**
   * One refusal for "no such upload", whatever the real reason.
   *
   * A key belonging to another customer and a key that was never issued get the
   * same answer. Distinguishing them would confirm that an object exists
   * somewhere else, which is exactly the fact the prefix check is protecting.
   */
  private unknownUpload(): AppError {
    return AppError.notFound("no matching upload for this key in this tenant");
  }

  private async record(
    actor: UploadActor,
    courseId: string,
    event: {
      action: "mint" | "store" | "refuse" | "delete";
      objectKey: string;
      sizeBytes: number | null;
      mimeType: string | null;
      succeeded: boolean;
      detail: string | null;
    },
  ): Promise<void> {
    await this.audit.record({
      customerId: actor.customerId,
      courseId,
      // Uploads are a staff-plane action by construction: the routes are behind
      // the author roles, and a learner has no way to reach them (ADR-0012).
      actorKind: "staff",
      actorId: actor.userId ?? null,
      ...event,
    });
  }
}

/** A short technical reason for the log. Never a URL — it would carry a signature. */
function refusalDetail(refusal: UploadRefusal): string {
  switch (refusal.kind) {
    case "missing":
      return "the object was not found in the bucket";
    case "mismatch":
      return `stored object does not match what was approved: ${refusal.reason}`;
    case "unreachable":
      return `object storage could not be reached: ${refusal.reason}`;
    case "rejected":
      return refusal.reason;
  }
}

/**
 * The right status for each way an upload can fail.
 *
 * `unreachable` is a 500 rather than a 422, because it is not the author's
 * fault and "try again" is the correct advice — while for a mismatch it is not,
 * and telling somebody to retry an upload that will fail identically is how a
 * support ticket becomes an afternoon. It is also the one of these that should
 * raise the error rate an operator watches; a 4xx would hide a storage outage
 * inside the ordinary noise of people uploading the wrong thing.
 */
function uploadFailed(refusal: UploadRefusal): AppError {
  if (refusal.kind === "unreachable") {
    return new AppError(
      "internal",
      "object storage is unreachable",
      "Der Dateispeicher ist im Moment nicht erreichbar. Bitte versuchen Sie es in einigen Minuten erneut.",
    );
  }

  if (refusal.kind === "missing") {
    return new AppError(
      "validation",
      "the upload did not reach the bucket",
      "Die Datei ist nicht vollständig angekommen. Bitte laden Sie sie erneut hoch.",
    );
  }

  return new AppError(
    "validation",
    "the stored object does not match what was approved",
    "Die hochgeladene Datei stimmt nicht mit der Anmeldung überein und wurde verworfen. Bitte laden Sie sie erneut hoch.",
  );
}
