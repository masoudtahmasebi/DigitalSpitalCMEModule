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
import {
  customerPrefix,
  keyBelongsToCustomer,
  planMultipart,
  storageKeyOf,
} from "@ds/domain";
import type { StorageAuditPort, UploadRepositoryPort } from "./upload.repository.js";
import type {
  MultipartBegin,
  MultipartComplete,
  MultipartSign,
  MultipartSignResponse,
  MultipartTicketResponse,
  MediaAssetResponse,
  MediaDescribe,
  MediaList,
  UploadBegin,
  UploadComplete,
  UploadConfirmedResponse,
  UploadTicketResponse,
  UploadView,
  UploadViewResponse,
} from "./upload.dto.js";

/**
 * How long a console read signature lives (P74-02).
 *
 * Ten minutes rather than the sixty seconds a learner's lesson URL gets: an
 * author uploads a lecture, then scrubs through it, fills the length, edits the
 * title and saves — one page visit, several minutes, and a signature that
 * expires under a playing `<video>` looks like a broken upload. It is still
 * short enough that a URL copied out of a network tab is worth little, and it
 * is one object, read-only, inside one course.
 */
const VIEW_TTL_SEC = 600;

/** Where this course's objects live. Lower-cased to match `courseAssetKey`. */
function coursePrefix(customerId: string, courseId: string): string {
  return `${customerId.toLowerCase()}/courses/${courseId.toLowerCase()}/`;
}

export interface UploadActor {
  readonly customerId: string;
  readonly userId: string | undefined;
}

/**
 * What to call a file in the library.
 *
 * The author's own filename when the console sent one, because the whole point
 * of the library is that somebody recognises their own file in a list. The
 * generated key's last segment otherwise — `video-9f2c….mp4`, which is not
 * friendly but is at least the truth, and is what an older console that does
 * not send the name will produce.
 *
 * Never used to build a key, a path or a header. `uploadObjectName` generates
 * the key and this value never reaches it, so an author's `../../etc/passwd`
 * is a silly label in one list and nothing else.
 */
function libraryName(supplied: string | undefined, key: string): string {
  const trimmed = (supplied ?? "").trim();
  if (trimmed !== "") return trimmed;
  const segments = key.split("/");
  return segments[segments.length - 1] ?? key;
}

/** German for the four ways `planUpload` can say no. */
const PLAN_MESSAGES: Readonly<Record<string, string>> = {
  unknown_purpose: "Für diesen Verwendungszweck können keine Dateien hochgeladen werden.",
  unsupported_type: "Dieses Dateiformat wird nicht unterstützt.",
  empty: "Die Datei ist leer.",
  too_large: "Die Datei ist zu groß.",
};

/**
 * `warn`, which is what `JsonLogger` (a Nest `LoggerService`) has.
 *
 * Injected rather than reached for, so a test can assert the one thing this
 * service does quietly: failing to index a file must be visible somewhere, and
 * a `catch {}` would make "the library is empty" indistinguishable from "no
 * uploads yet".
 */
export interface UploadLogger {
  warn(message: string): void;
}

export class UploadService {
  constructor(
    private readonly repository: UploadRepositoryPort,
    private readonly audit: StorageAuditPort,
    /** Undefined when the deployment has no object storage configured. */
    private readonly storage: ObjectStorage | undefined,
    private readonly logger: UploadLogger = { warn: () => undefined },
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

    /*
     * And remember it in the customer's library (P81-02).
     *
     * Here rather than anywhere else because this is the only moment the
     * platform knows an object exists *and* what is in it: `begin` knows what
     * was promised, and the content form knows only a reference somebody may
     * or may not go on to save. An entry written earlier would list files that
     * were never uploaded; one written when a course is saved would miss every
     * file uploaded and then not used, which is exactly the file somebody wants
     * to find again later.
     *
     * Deliberately after the audit row and deliberately not fatal. The audit
     * log is the compliance record and must be written; the library is a
     * convenience, and a failure to index a file must not fail the upload that
     * succeeded — the object is in the bucket and the reference in the response
     * is valid either way.
     */
    try {
      await this.repository.rememberAsset({
        customerId: actor.customerId,
        storageKey: verified.upload.reference,
        fileName: libraryName(input.fileName, input.key),
        mimeType: verified.upload.contentType,
        byteSize: verified.upload.sizeBytes,
        uploadedBy: actor.userId ?? null,
      });
    } catch (error) {
      this.logger.warn(
        `media library: could not index ${input.key}: ${
          error instanceof Error ? error.message : "unknown"
        }`,
      );
    }

    return {
      reference: verified.upload.reference,
      sizeBytes: verified.upload.sizeBytes,
      mimeType: verified.upload.contentType,
    };
  }

  /**
   * Everything this customer has uploaded (P81-02).
   *
   * ## Why it is not scoped to a course
   *
   * Because the report was that it should not be: *"we should also have a
   * mediathek-library section for all of the files a customer have uploaded"*,
   * and the concrete cost of the course-scoped world was an introduction video
   * that could not be used in a second course without uploading it twice.
   *
   * The tenant is still the boundary. Rows come back under RLS in the caller's
   * customer, and the roles are the same two that may author — reading the list
   * of a customer's own files is an authoring capability, not a reporting one.
   *
   * ## What it deliberately does not return
   *
   * No signed URLs. A list of two hundred capabilities that leave the building
   * would be minted whether or not anybody looked at a single one, and each
   * would be an audited `read` for a file nobody opened. The console asks for a
   * URL per file it actually shows, through the route that already exists for
   * that and already audits it.
   */
  async list(input: MediaList): Promise<readonly MediaAssetResponse[]> {
    const rows = await this.repository.listAssets({
      kind: input.kind,
      limit: input.limit,
    });

    /*
     * How many contents point at each file, in one query (P88-01).
     *
     * The library screen shows this so that removing a file is a decision
     * somebody makes **before** pressing the button rather than a 409
     * afterwards — §9.4, at the point they look. One query for the page rather
     * than one per row: fifty files would otherwise be fifty round trips, which
     * is how a useful column becomes a slow screen somebody removes again.
     */
    const uses = await this.repository.countUsesFor(rows.map((row) => row.storageKey));

    return rows.map((row) => this.asAsset(row, uses.get(row.storageKey) ?? 0));
  }

  /**
   * A short-lived read URL for a library entry (P88-01).
   *
   * `view` above authorises by the course whose prefix the key sits under. The
   * Mediathek screen is not inside a course and has no slug to check against —
   * so this authorises by the **asset row**, which is under FORCE ROW LEVEL
   * SECURITY. That is the tighter answer rather than the looser one: a file
   * belonging to another customer is not visible to name in the first place,
   * where the course route has to compare two prefixes and get both right.
   *
   * Audited as a `read` in the same way. A signed GET is a capability that
   * leaves the building however it was asked for, and a second route that did
   * not write the row would be a hole in an append-only log.
   */
  async viewAsset(
    id: string,
    actor: UploadActor,
    now: Date,
  ): Promise<UploadViewResponse> {
    const storage = this.requireStorage();

    const row = await this.repository.findAsset(id);
    if (row === undefined) throw this.unknownAsset();

    const key = storageKeyOf(row.storageKey);
    if (key === undefined || !keyBelongsToCustomer(key, actor.customerId)) {
      /*
       * Unreachable through RLS, and checked anyway.
       *
       * The row is this customer's or it is not visible; a key inside it that
       * belongs to somebody else would mean the library and the bucket disagree
       * about who owns what, which is worth refusing loudly rather than
       * signing. Defence in depth, never the only defence (ADR-0002).
       */
      await this.record(actor, null, {
        action: "refuse",
        objectKey: customerPrefix(actor.customerId),
        sizeBytes: null,
        mimeType: null,
        succeeded: false,
        detail: "library entry points outside this customer's prefix",
      });
      throw this.unknownAsset();
    }

    await this.record(actor, null, {
      action: "read",
      objectKey: key,
      sizeBytes: null,
      mimeType: null,
      succeeded: true,
      detail: null,
    });

    return {
      url: storage.readUrl(key, VIEW_TTL_SEC, now),
      expiresAt: new Date(now.getTime() + VIEW_TTL_SEC * 1000).toISOString(),
    };
  }

  /** One shape for a library entry, so the three routes cannot drift. */
  private asAsset(
    row: {
      id: string;
      storageKey: string;
      fileName: string;
      mimeType: string | null;
      byteSize: number | null;
      title: string | null;
      altText: string | null;
      createdAt: Date;
    },
    usedByCount: number,
  ): MediaAssetResponse {
    return {
      id: row.id,
      reference: row.storageKey,
      fileName: row.fileName,
      mimeType: row.mimeType,
      byteSize: row.byteSize,
      title: row.title,
      altText: row.altText,
      createdAt: row.createdAt.toISOString(),
      usedByCount,
    };
  }

  /**
   * Give a file a human title and alt text (P81-03).
   *
   * The two are separate fields on purpose and the console says so: a title
   * names the file for whoever is filing it ("Intro Modul 1"), alt text
   * describes the image for somebody who cannot see it. Using one for the other
   * produces alt text that reads like a filing label, which passes an automated
   * check and helps nobody.
   *
   * Blank means **not set**, stored as null rather than `""`. An empty `alt`
   * attribute is a claim that the image is decorative, and that is a statement
   * an author has to make deliberately rather than by leaving a box empty.
   */
  async describe(
    id: string,
    input: MediaDescribe,
    actor: UploadActor,
  ): Promise<MediaAssetResponse> {
    const blankToNull = (value: string | undefined): string | null => {
      const trimmed = (value ?? "").trim();
      return trimmed === "" ? null : trimmed;
    };

    const found = await this.repository.describeAsset(
      id,
      blankToNull(input.title),
      blankToNull(input.altText),
    );
    if (!found) throw this.unknownAsset();

    const row = await this.repository.findAsset(id);
    if (row === undefined) throw this.unknownAsset();
    void actor;

    return this.asAsset(row, await this.repository.countAssetUses(row.storageKey));
  }

  /**
   * Remove a file from the library (P81-03).
   *
   * ## Refused while anything still points at it
   *
   * A course content holding this reference would keep rendering it — the
   * object is still in the bucket — but the operator would have lost the only
   * place the file is listed, described and findable. Worse, they would have
   * been told it was deleted. So the count is checked first and the refusal
   * names how many contents are involved, which is what somebody needs to go
   * and unpick it.
   *
   * ## Why the object itself is not deleted
   *
   * This forgets the library entry, not the bytes. Two reasons, and the second
   * decides it: an object may be referenced by a course this tenant can see and
   * by an archived certificate it cannot, and object deletion on this platform
   * goes through `object_erasures` with its own audit trail and its own
   * retention rules (P23-02, ADR-0004). A convenience screen must not become a
   * second, quieter path to destroying a physician's course material.
   *
   * The console says so rather than implying the file is gone.
   */
  async forget(id: string, actor: UploadActor): Promise<void> {
    const row = await this.repository.findAsset(id);
    if (row === undefined) throw this.unknownAsset();

    const uses = await this.repository.countAssetUses(row.storageKey);
    if (uses > 0) {
      throw new AppError(
        "conflict",
        `media asset=${id} still referenced by ${uses} content(s)`,
        `Diese Datei wird noch in ${uses} ${
          uses === 1 ? "Inhalt" : "Inhalten"
        } verwendet. Bitte entfernen Sie sie dort zuerst.`,
      );
    }

    await this.repository.forgetAsset(id);
    void actor;
  }

  private unknownAsset(): AppError {
    /*
     * The same answer for "no such id" and "belongs to another customer"
     * (§9.5). Distinguishing them would confirm that somebody else's file
     * exists, which is more than the refusal needs to say.
     */
    return AppError.notFound("media asset not visible in tenant");
  }

  /**
   * A short-lived URL for an object this course already owns (P74-02).
   *
   * ## What it is for
   *
   * Two things the console could not do at all, both reported by the client on
   * the content form: see the video or image that was just uploaded, and read
   * a video's length out of its own header. The second is not cosmetic —
   * `durationSec` is a compliance input, the watch gate is a percentage of it,
   * and the one control that gets it right (`Aus Video ermitteln`) disappeared
   * exactly when the author used this console to put the file there, because an
   * `s3://` reference is a key and not something a browser can fetch.
   *
   * ## Why the course is in the path and checked
   *
   * Three checks, and each rules out a different mistake:
   *
   * 1. **The reference must be ours.** A plain `https://` URL needs no
   *    signature and is refused here rather than echoed back, so this route can
   *    never be used to have the API fetch or bless an arbitrary address.
   * 2. **The key must sit under the caller's customer prefix.** The same
   *    `keyBelongsToCustomer` boundary as `complete`, on a store with no RLS
   *    beneath it.
   * 3. **The key must be one the customer owns** — under *this course's*
   *    prefix, or a row in this customer's Mediathek. Either way it is a file
   *    somebody uploaded through this console, never a key a caller named.
   *
   * ### Why (3) is not "this course's prefix" alone (P161-01)
   *
   * It was, until the Mediathek's whole point caught up with it. A key is
   * minted once, under the course being edited at the time, and the object is
   * never copied — so a video uploaded for course A keeps A's prefix for ever.
   * Pick it again from the library while building course B, which is the reuse
   * P88-02 put a button beside every upload field for, and the course-prefix
   * rule refuses it. The console then showed *"Die Vorschau konnte nicht
   * geladen werden"* and, worse, *"Die Länge konnte nicht aus der Datei gelesen
   * werden … Server ohne CORS-Regel"* — a confident explanation of a cause that
   * was not the cause (§11).
   *
   * The rule it replaces claimed to stop "an author who may edit one course
   * reading every object their customer owns by naming a key from another
   * course". That threat does not exist on this controller and never did:
   * `AUTHOR_ROLES` here is `customer_admin` and `super_admin`, both
   * customer-wide, and both can already list every asset through
   * `GET /admin/media` and mint a read URL for any of them through
   * `POST /admin/media/{id}/view` — same roles, same objects, one route along.
   * A comment is a claim, not a fact (§11 rule 9), and this one is why nobody
   * looked again when the picker shipped.
   *
   * So the library membership check is not a relaxation to "any key under the
   * customer prefix": a key that is in the bucket but has no `media_assets`
   * row — a mint nobody completed, a path somebody guessed — is still refused.
   * It is *exactly* the authorisation `viewAsset` already applies, which is the
   * point: two routes handing out read URLs for the same objects must not
   * disagree about who may have one.
   *
   * The refusal for all three is the same `notFound` as an unknown upload —
   * telling a caller that an object exists but is not reachable from here is
   * more than the refusal needs to say (§9.5).
   *
   * ## Why it is audited
   *
   * `read` is in `storage_action` and this is the first thing to write one. A
   * signed GET is a capability that leaves the building: whoever holds the URL
   * can read that object until it expires, so the fact that one was issued, to
   * whom and for which key belongs in the append-only log with the mints.
   */
  async view(
    courseSlug: string,
    input: UploadView,
    actor: UploadActor,
    now: Date,
  ): Promise<UploadViewResponse> {
    const storage = this.requireStorage();
    const courseId = await this.requireCourse(courseSlug);

    const key = storageKeyOf(input.reference);
    const ours = key !== undefined && keyBelongsToCustomer(key, actor.customerId);
    const withinCourse =
      ours && key.toLowerCase().startsWith(coursePrefix(actor.customerId, courseId));
    /*
     * Only asked when the cheap test has already failed, so the ordinary path
     * — a course showing its own files — costs no extra query.
     */
    const inLibrary =
      !withinCourse &&
      ours &&
      (await this.repository.findAssetByKey(input.reference)) !== undefined;

    if (!withinCourse && !inLibrary) {
      await this.record(actor, courseId, {
        action: "refuse",
        // The reference is not echoed: it is client-supplied and this row is
        // read by an operator. The course's own prefix says where it was aimed.
        objectKey: coursePrefix(actor.customerId, courseId),
        sizeBytes: null,
        mimeType: null,
        succeeded: false,
        detail:
          key === undefined
            ? "not a storage reference"
            : !ours
              ? "key is outside this customer's prefix"
              : "key is outside this course and not in this customer's library",
      });
      throw this.unknownUpload();
    }

    await this.record(actor, courseId, {
      action: "read",
      objectKey: key,
      sizeBytes: null,
      mimeType: null,
      succeeded: true,
      detail: null,
    });

    return {
      url: storage.readUrl(key, VIEW_TTL_SEC, now),
      expiresAt: new Date(now.getTime() + VIEW_TTL_SEC * 1000).toISOString(),
    };
  }

  // -------------------------------------------------------------------------

  /*
   * =====================================================================
   * Multipart (P129-04)
   * =====================================================================
   *
   * Three calls where the single PUT has two. The extra one is `signParts`,
   * and it is where the security of the whole path sits: it is the only
   * endpoint that mints capabilities repeatedly for an upload that is already
   * in flight, so every call re-establishes the same three facts rather than
   * trusting that `beginMultipart` established them once.
   */

  /**
   * Begin a large upload.
   *
   * Everything `begin` does, plus a split. The key is minted from the caller's
   * own customer and a course RLS has agreed they can see, and the **mint is
   * recorded before the client is told anything** — the recorded size and type
   * are what `completeMultipart` measures the assembled object against, and a
   * capability nobody wrote down is one nobody can account for.
   */
  async beginMultipart(
    courseSlug: string,
    input: MultipartBegin,
    actor: UploadActor,
    now: Date,
  ): Promise<MultipartTicketResponse> {
    const storage = this.requireStorage();
    const courseId = await this.requireCourse(courseSlug);

    const plan = storage.plan(input);
    if (!plan.ok) {
      await this.record(actor, courseId, {
        action: "refuse",
        objectKey: `${actor.customerId}/courses/${courseId}/`,
        sizeBytes: input.sizeBytes,
        mimeType: input.mimeType,
        succeeded: false,
        detail: plan.reason,
      });
      throw new AppError("validation", `upload refused: ${plan.reason}`);
    }

    const split = planMultipart(plan.sizeBytes);
    if (split === undefined) {
      // Below the threshold, or beyond what 10,000 parts can carry. Both are
      // "use the other endpoint", and saying which is not the client's business.
      throw new AppError(
        "validation",
        "size outside the multipart range",
        "this size is not uploaded in parts — use the single upload",
      );
    }

    const begun = await storage.beginMultipart(
      plan,
      { customerId: actor.customerId, courseId },
      split,
      now,
    );

    if (!begun.ok) {
      await this.record(actor, courseId, {
        action: "refuse",
        objectKey: `${actor.customerId}/courses/${courseId}/`,
        sizeBytes: plan.sizeBytes,
        mimeType: plan.mimeType,
        succeeded: false,
        detail: `bucket refused the upload: ${begun.refusal.kind}`,
      });
      throw new AppError("upstream_unavailable", "bucket refused CreateMultipartUpload");
    }

    await this.record(actor, courseId, {
      action: "mint",
      objectKey: begun.upload.key,
      sizeBytes: plan.sizeBytes,
      mimeType: plan.mimeType,
      succeeded: true,
      detail: null,
    });

    return {
      key: begun.upload.key,
      uploadId: begun.upload.uploadId,
      partCount: begun.upload.partCount,
      partBytes: begun.upload.partBytes,
      expiresAt: begun.upload.expiresAt.toISOString(),
    };
  }

  /**
   * Sign a bounded batch of part URLs.
   *
   * Three checks, cheapest first, and none of them is skippable because the
   * client holds the `uploadId` between calls:
   *
   * 1. **The key is inside the caller's prefix.** Answered without touching the
   *    database or the bucket, exactly as `complete` does.
   * 2. **We minted this key, for this tenant.** `findMint` runs under RLS, so
   *    another customer's key finds nothing regardless of what the prefix check
   *    thought. This is what stops a caller signing parts against a key they
   *    guessed rather than one they were given.
   * 3. **The part number is inside the plan.** Derived from the *recorded*
   *    size, never from this request — a client that asks for part 9,000 of a
   *    96-part upload is asking for a capability that should not exist, and the
   *    bucket would happily create it.
   */
  async signParts(
    courseSlug: string,
    input: MultipartSign,
    actor: UploadActor,
    now: Date,
  ): Promise<MultipartSignResponse> {
    const storage = this.requireStorage();
    const courseId = await this.requireCourse(courseSlug);

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

    const mint = await this.repository.findMint(input.key);
    if (mint === undefined) throw this.unknownUpload();

    const split = planMultipart(mint.sizeBytes);
    if (split === undefined) throw this.unknownUpload();

    const outOfRange = input.partNumbers.filter((part) => part > split.partCount);
    if (outOfRange.length > 0) {
      await this.record(actor, courseId, {
        action: "refuse",
        objectKey: input.key,
        sizeBytes: null,
        mimeType: null,
        // The count, not the numbers: a detail is written by us and is not a
        // place to echo a request back (§9.5).
        succeeded: false,
        detail: `${String(outOfRange.length)} part number(s) outside the plan`,
      });
      throw new AppError("validation", "part number outside the recorded plan");
    }

    const signed = storage.signParts(input.key, input.uploadId, input.partNumbers, now);

    return {
      parts: signed.parts,
      expiresAt: signed.expiresAt.toISOString(),
    };
  }

  /**
   * Assemble, then verify — in that order, and both.
   *
   * The parts come from the **bucket's** own listing rather than from the
   * client, and once assembled the object is measured against the recorded mint
   * by the same `verifyUpload` a single PUT goes through. A multipart upload
   * that assembles into the wrong size is discarded exactly like a single one
   * that arrives at the wrong size, and for the same reason: the reference this
   * returns is what a course will point at.
   */
  async completeMultipart(
    courseSlug: string,
    input: MultipartComplete,
    actor: UploadActor,
    now: Date,
  ): Promise<UploadConfirmedResponse> {
    const storage = this.requireStorage();
    const courseId = await this.requireCourse(courseSlug);

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

    const mint = await this.repository.findMint(input.key);
    if (mint === undefined) throw this.unknownUpload();

    const listed = await storage.listParts(input.key, input.uploadId, now);
    if (!listed.ok) {
      throw new AppError("upstream_unavailable", "bucket refused ListParts");
    }

    const assembled = await storage.completeMultipart(
      input.key,
      input.uploadId,
      listed.parts,
      now,
    );

    if (!assembled.ok) {
      /*
       * Give the storage back before answering.
       *
       * A failed assembly leaves every part behind, and they are billed and
       * invisible (P129-03). The lifecycle rule would reach them in a day; this
       * reaches them now, and its own failure does not change the answer.
       */
      await storage.abortMultipart(input.key, input.uploadId, now);
      await this.record(actor, courseId, {
        action: "refuse",
        objectKey: input.key,
        sizeBytes: null,
        mimeType: null,
        succeeded: false,
        detail: `assembly failed: ${assembled.refusal.kind}`,
      });
      throw new AppError(
        "upstream_unavailable",
        "bucket refused CompleteMultipartUpload",
      );
    }

    const verified = await storage.verifyUpload(
      input.key,
      { contentType: mint.mimeType, sizeBytes: mint.sizeBytes },
      now,
    );

    if (!verified.ok) {
      await this.record(actor, courseId, {
        action: "refuse",
        objectKey: input.key,
        sizeBytes: null,
        mimeType: null,
        succeeded: false,
        detail: `stored object refused: ${verified.refusal.kind}`,
      });
      throw new AppError("validation", "stored object failed verification");
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
    /**
     * Null for an operation that is not about one course (P88-01).
     *
     * The library is the customer's index and outlives any course, so a read
     * minted from the Mediathek genuinely has no course to name. `StorageEvent`
     * has allowed null since P23-02; this parameter simply did not, which made
     * every audited action look course-scoped by construction.
     */
    courseId: string | null,
    event: {
      action: "mint" | "store" | "refuse" | "read" | "delete";
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
