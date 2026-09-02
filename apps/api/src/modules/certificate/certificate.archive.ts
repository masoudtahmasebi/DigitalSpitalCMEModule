/**
 * Keeping the Teilnahmebescheinigung, not only rendering it (P60-01).
 *
 * ## What this is for, and what it is not
 *
 * The download and the e-mail render the PDF from the record every time, and
 * that stays true — it is what keeps the emailed document and the downloaded
 * one the same document. This writes a **copy of the bytes as issued** to
 * object storage, under `<customer>/certificates/<course>/<certificate>.pdf`,
 * and records the key and a SHA-256 on the row.
 *
 * The two answer different questions:
 *
 *   "show me my certificate"              → the render, always current
 *   "prove what was issued on 12.08.2026" → the archive, as it was
 *
 * A re-render years later cannot answer the second. Fonts change, the layout
 * changes, a course's stamp is replaced, an accreditation lapses. The digest is
 * what makes the archive evidence rather than a copy: an object whose bytes do
 * not hash to the stored value has been altered, and that is answerable without
 * having to trust the bucket.
 *
 * ## Why a failure here is not an error
 *
 * The physician has earned the document and can already download it. A bucket
 * that is unreachable, misconfigured or absent must not fail their completion,
 * so every path answers `undefined` and records why. What it must never do is
 * *look* archived when it is not — the row is written only after the bucket has
 * confirmed the object, and `certificates_archive_all_or_nothing` refuses a
 * half-written record.
 *
 * ## Why not the presigned-upload path
 *
 * `ObjectStorage.mint` exists for a browser: it signs a URL, hands it to a
 * client and verifies afterwards what arrived. Here the API has the bytes in
 * memory and is the only party involved, so it signs a PUT for its own key and
 * performs it. Nothing is handed out, so nothing needs verifying against a
 * declaration.
 */

import { createHash } from "node:crypto";
import { withDeadline } from "../../shared/deadline-fetch.js";
import { certificateArchiveKey } from "@ds/domain";
import type { AppConfig } from "../../config/config.js";
import { hasObjectStorage } from "../../shared/object-storage.factory.js";
import { S3Presigner, type Presigner } from "../../shared/s3-presigner.js";

/** Long enough for a slow bucket, short enough that a stuck PUT cannot pin a sweep. */
const PUT_TTL_SEC = 120;

export interface ArchivedCertificate {
  readonly objectKey: string;
  readonly sha256: string;
  readonly sizeBytes: number;
}

export interface ArchiveLogger {
  warn(message: string): void;
}

/** What the archive needs recorded, so the caller owns the transaction. */
export interface CertificateArchivePort {
  store(input: {
    readonly customerId: string;
    readonly courseId: string;
    readonly certificateId: string;
    readonly bytes: Uint8Array;
  }): Promise<ArchivedCertificate | undefined>;
}

export class CertificateArchive implements CertificateArchivePort {
  constructor(
    private readonly presigner: Presigner,
    private readonly logger: ArchiveLogger,
    // A deadline by default (P144-01): a bucket that never answers must
    // not hold the delivery sweep open until the next tick.
    private readonly fetchImpl: typeof fetch = withDeadline(),
  ) {}

  async store(input: {
    readonly customerId: string;
    readonly courseId: string;
    readonly certificateId: string;
    readonly bytes: Uint8Array;
  }): Promise<ArchivedCertificate | undefined> {
    let objectKey: string;
    try {
      // Throws on anything that is not a uuid, so a malformed id cannot become
      // a key outside the customer's prefix. The check is in `@ds/domain`
      // because that is where it can be tested exhaustively.
      objectKey = certificateArchiveKey({
        customerId: input.customerId,
        courseId: input.courseId,
        certificateId: input.certificateId,
      });
    } catch (error) {
      this.logger.warn(
        `certificate ${input.certificateId}: not archived, ` +
          `key refused (${error instanceof Error ? error.name : "unknown"})`,
      );
      return undefined;
    }

    const sha256 = createHash("sha256").update(input.bytes).digest("hex");
    const url = this.presigner.presignPut(objectKey, PUT_TTL_SEC, new Date(), {
      contentType: "application/pdf",
      contentLength: input.bytes.length,
    });

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "PUT",
        // The same two headers the signature covers. A mismatch is a 403 from
        // the bucket rather than an object stored under a different type.
        headers: {
          "content-type": "application/pdf",
          "content-length": String(input.bytes.length),
        },
        body: input.bytes,
      });
    } catch (error) {
      // The message, never the URL: it carries a signature.
      this.logger.warn(
        `certificate ${input.certificateId}: archive PUT failed ` +
          `(${error instanceof Error ? error.name : "unknown"})`,
      );
      return undefined;
    }

    if (!response.ok) {
      // The status, not the body: an S3 error document echoes the key, which
      // names a customer and a course.
      this.logger.warn(
        `certificate ${input.certificateId}: archive PUT refused ` +
          `(bucket answered ${String(response.status)})`,
      );
      return undefined;
    }

    return { objectKey, sha256, sizeBytes: input.bytes.length };
  }
}

/**
 * The certificate archive, or `undefined` when there is no bucket (P60-01).
 *
 * Same predicate as `objectStorageFor`, deliberately: a deployment either has
 * object storage or it does not, and a platform that archived certificates but
 * refused course uploads (or the reverse) would be a state nobody configured
 * on purpose.
 *
 * It takes the presigner directly rather than an `ObjectStorage`, because
 * `ObjectStorage` is about handing signed URLs to a *browser* — plan, mint,
 * verify what arrived. The archive has the bytes in hand and is the only party
 * involved, so it signs its own PUT and performs it.
 */
export function certificateArchiveFor(
  config: AppConfig,
  logger: ArchiveLogger,
): CertificateArchive | undefined {
  if (!hasObjectStorage(config)) return undefined;

  return new CertificateArchive(
    new S3Presigner({
      endpoint: config.S3_ENDPOINT,
      region: config.S3_REGION,
      bucket: config.S3_BUCKET,
      accessKeyId: config.S3_ACCESS_KEY_ID,
      secretAccessKey: config.S3_SECRET_ACCESS_KEY,
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
    }),
    logger,
  );
}
