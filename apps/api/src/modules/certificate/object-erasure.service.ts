/**
 * Deleting what SQL cannot reach (P60-01).
 *
 * ## Why this exists
 *
 * `erase_subject` can redact every column that names a physician, because they
 * are all in Postgres. The archived Teilnahmebescheinigung is not: it is an
 * object in a bucket carrying the name, the Anschrift and the EFN on its face.
 * A database function cannot delete it, so the function records the obligation
 * in `object_erasures` and this discharges it.
 *
 * Without this, an erasure would succeed, audit itself as complete, and leave
 * the document in storage indefinitely. That is not a gap that announces
 * itself — the request returns 200 and every table looks right.
 *
 * ## The one rule
 *
 * `deleted_at` is stamped **only** after the bucket has confirmed. A failure
 * leaves the row outstanding and it is claimed again; an obligation must not be
 * dischargeable by being forgotten. A 404 counts as gone — the object is not
 * there, which is the state being asked for.
 *
 * ## Where it runs
 *
 * Right after an erasure, in the same request, so the ordinary case completes
 * before the operator has finished reading the confirmation — and on API boot,
 * which is what picks up anything a bucket outage left behind. Neither is a
 * timer: erasures are rare, and a sweep that runs every five minutes to find
 * nothing is a sweep whose failures nobody reads.
 */

import type { Pool } from "pg";
import type { AppConfig } from "../../config/config.js";
import { hasObjectStorage } from "../../shared/object-storage.factory.js";
import { S3Presigner, type Presigner } from "../../shared/s3-presigner.js";

/** Long enough for a bucket round trip; short enough not to hold a request. */
const DELETE_TTL_SEC = 60;

/** One claim's worth. Erasures are individual, so a batch is already generous. */
const BATCH = 50;

/** `log` and `warn`, which is what `JsonLogger` (a Nest `LoggerService`) has. */
export interface ErasureLogger {
  log(message: string): void;
  warn(message: string): void;
}

export interface ObjectErasureResult {
  readonly claimed: number;
  readonly deleted: number;
  readonly failed: number;
}

export class ObjectErasureService {
  constructor(
    private readonly pool: Pool,
    private readonly presigner: Presigner,
    private readonly logger: ErasureLogger,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async drain(): Promise<ObjectErasureResult> {
    // The bare pool deliberately: `object_erasures` is tenant-scoped and an
    // erasure spans customers, so the claim is a SECURITY DEFINER function —
    // the same arrangement as `claim_due_certificate_deliveries`. A plain
    // SELECT here would match zero rows and read as "nothing owed"
    // (CLAUDE.md §9.6).
    const { rows } = await this.pool.query<{
      id: string;
      object_key: string;
      attempts: number;
    }>("SELECT id, object_key, attempts FROM claim_object_erasures($1)", [BATCH]);

    const result = { claimed: rows.length, deleted: 0, failed: 0 };

    for (const row of rows) {
      const error = await this.deleteObject(row.object_key);
      await this.pool.query("SELECT mark_object_erased($1, $2)", [row.id, error]);
      if (error === null) result.deleted += 1;
      else result.failed += 1;
    }

    if (result.claimed > 0) {
      // Counts, never keys: an object key names a customer, a course and a
      // certificate, which is the thing an erasure record must not carry.
      this.logger.log(
        `object erasure: claimed=${String(result.claimed)} ` +
          `deleted=${String(result.deleted)} failed=${String(result.failed)}`,
      );
    }

    return result;
  }

  /** `null` on success, or a short reason written by us. */
  private async deleteObject(objectKey: string): Promise<string | null> {
    let response: Response;
    try {
      response = await this.fetchImpl(
        this.presigner.presignDelete(objectKey, DELETE_TTL_SEC, new Date()),
        { method: "DELETE" },
      );
    } catch (error) {
      const reason = error instanceof Error ? error.name : "unknown";
      this.logger.warn(`object erasure: delete failed (${reason})`);
      return reason;
    }

    // 204 is the ordinary answer; 404 means it is already gone, which is the
    // state being asked for and must not keep the obligation open forever.
    if (response.ok || response.status === 404) return null;

    this.logger.warn(
      `object erasure: bucket refused the delete (${String(response.status)})`,
    );
    return `bucket_${String(response.status)}`;
  }
}

/**
 * The sweep, or `undefined` when there is no bucket (P60-01).
 *
 * Same predicate as the archive it cleans up after: nothing was archived
 * without object storage, so there is nothing owed. When storage is later
 * configured, the queued rows are still there and the next erasure drains them.
 */
export function objectErasureFor(
  pool: Pool,
  config: AppConfig,
  logger: ErasureLogger,
): ObjectErasureService | undefined {
  if (!hasObjectStorage(config)) return undefined;

  return new ObjectErasureService(
    pool,
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
