/**
 * Rows the upload path reads and writes (P23-01, P23-02). Infrastructure — ADR-0006.
 *
 * Two responsibilities, and the second is the interesting one.
 *
 * ## The audit log is not only a log
 *
 * `recordMint` writes the size and type the API approved. `findMint` reads them
 * back when the client says the upload finished. That is deliberate, and it is
 * what makes verification mean anything: if `complete` took the expected size
 * and type from its own request body, a client could declare 11 bytes at
 * `begin`, upload something else, and then declare *that* at `complete` — the
 * comparison would pass against numbers the client chose on both sides.
 *
 * Reading them from the mint closes it. The row is append-only in the database
 * (`ds_app` holds INSERT and SELECT and nothing else, migration 0029), so the
 * application cannot revise its own record of what it agreed to — not even by
 * mistake, because an UPDATE is a permission error rather than a silent no-op.
 *
 * Every read here is under RLS in the caller's tenant, so a key belonging to
 * another customer simply has no mint to find.
 */

import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import type { Pool } from "pg";
import { courses, mediaAssets, storageAuditLog } from "../../db/schema.js";
import { runInTenant, type Db, type TenantContext } from "../../db/tenant-db.js";

export interface RecordedMint {
  readonly courseId: string;
  readonly sizeBytes: number;
  readonly mimeType: string;
}

export interface StorageEvent {
  readonly customerId: string;
  readonly courseId: string | null;
  readonly actorKind: "staff" | "learner" | "system";
  readonly actorId: string | null;
  readonly action: "mint" | "store" | "refuse" | "read" | "delete";
  readonly objectKey: string;
  readonly sizeBytes: number | null;
  readonly mimeType: string | null;
  readonly succeeded: boolean;
  /** A short technical reason written by us. Never a value from a request. */
  readonly detail: string | null;
}

/**
 * How the library screen narrows a list.
 *
 * `kind` is the first token of the MIME type — "show me the videos" — and the
 * migration indexes `split_part(mime_type, '/', 1)` for exactly this. Rows with
 * no MIME type are excluded when a kind is asked for rather than included as a
 * courtesy: "the videos" must not contain a file nobody could describe.
 */
export interface LibraryFilter {
  readonly kind?: string | undefined;
  readonly limit: number;
}

export interface LibraryRow {
  readonly id: string;
  readonly storageKey: string;
  readonly fileName: string;
  readonly mimeType: string | null;
  readonly byteSize: number | null;
  readonly title: string | null;
  readonly altText: string | null;
  readonly createdAt: Date;
}

/** A file to remember, once the bucket has confirmed it holds it. */
export interface LibraryEntry {
  readonly customerId: string;
  readonly storageKey: string;
  readonly fileName: string;
  readonly mimeType: string | null;
  readonly byteSize: number | null;
  readonly uploadedBy: string | null;
}

export interface UploadRepositoryPort {
  /** The course's id, or undefined when this tenant cannot see that slug. */
  findCourseId(slug: string): Promise<string | undefined>;
  /** What was approved for this key, if this tenant approved anything. */
  findMint(objectKey: string): Promise<RecordedMint | undefined>;
  /** Everything this customer has uploaded, newest first. */
  listAssets(filter: LibraryFilter): Promise<readonly LibraryRow[]>;
  /**
   * Remember a stored object in the customer's library (P81-02).
   *
   * Idempotent on `(customer_id, storage_key)`: `complete` can legitimately be
   * called twice for one upload — a retried request, a double-clicked button —
   * and the second must not produce a second library entry for one file.
   */
  rememberAsset(entry: LibraryEntry): Promise<void>;
}

/**
 * Writes an audit row that survives the request failing.
 *
 * Separated from `UploadRepositoryPort` because it must **not** run in the
 * request's transaction, and a single interface would hide that. Every route
 * here runs inside `TenantTransactionInterceptor`'s transaction, which rolls
 * back when the handler throws — and a refusal *is* the handler throwing. An
 * audit row written on that connection would be rolled back with it, so the log
 * would faithfully record every upload that worked and nothing else, which is
 * the opposite of what it is for (CLAUDE.md §4 invariant 8).
 *
 * It also matches the facts. These events describe something that happened in a
 * bucket, and a bucket does not participate in a Postgres transaction: the
 * object exists whether or not the request that made it succeeds.
 */
export interface StorageAuditPort {
  record(event: StorageEvent): Promise<void>;
}

export class UploadRepository implements UploadRepositoryPort {
  constructor(private readonly db: Db) {}

  async findCourseId(slug: string): Promise<string | undefined> {
    // Its own query rather than a call into the authoring repository: a
    // repository that depended on another module's repository would make the
    // two modules one, and this is four lines of SQL under the same RLS policy.
    const [row] = await this.db
      .select({ id: courses.id })
      .from(courses)
      .where(eq(courses.slug, slug))
      .limit(1);

    return row?.id;
  }

  async findMint(objectKey: string): Promise<RecordedMint | undefined> {
    // The most recent mint for this key. There is normally exactly one — keys
    // carry 16 random bytes — but "most recent" is the right answer rather than
    // "the only one": a re-mint after a failed upload should be what a later
    // `complete` is measured against.
    const [row] = await this.db
      .select({
        courseId: storageAuditLog.courseId,
        sizeBytes: storageAuditLog.sizeBytes,
        mimeType: storageAuditLog.mimeType,
      })
      .from(storageAuditLog)
      .where(
        and(
          eq(storageAuditLog.objectKey, objectKey),
          eq(storageAuditLog.action, "mint"),
          eq(storageAuditLog.succeeded, true),
        ),
      )
      .orderBy(desc(storageAuditLog.at))
      .limit(1);

    // A mint always carries all three. A row missing one is a mint this code
    // did not write, and treating it as absent is safer than filling in a
    // default that verification would then compare against.
    if (
      row === undefined ||
      row.courseId === null ||
      row.sizeBytes === null ||
      row.mimeType === null
    ) {
      return undefined;
    }

    return {
      courseId: row.courseId,
      sizeBytes: row.sizeBytes,
      mimeType: row.mimeType,
    };
  }

  async listAssets(filter: LibraryFilter): Promise<readonly LibraryRow[]> {
    /*
     * No `where customer_id = …` here, and that is not an oversight.
     *
     * `media_assets` is under FORCE ROW LEVEL SECURITY and `this.db` carries
     * the tenant context, so the database decides what this query can see
     * (ADR-0002). An application-level filter would be defence in depth and is
     * welcome elsewhere; what it must never be is the only defence.
     */
    const kind = (filter.kind ?? "").trim().toLowerCase();

    return this.db
      .select({
        id: mediaAssets.id,
        storageKey: mediaAssets.storageKey,
        fileName: mediaAssets.fileName,
        mimeType: mediaAssets.mimeType,
        byteSize: mediaAssets.byteSize,
        title: mediaAssets.title,
        altText: mediaAssets.altText,
        createdAt: mediaAssets.createdAt,
      })
      .from(mediaAssets)
      .where(
        kind === ""
          ? undefined
          : and(
              isNotNull(mediaAssets.mimeType),
              sql`split_part(${mediaAssets.mimeType}, '/', 1) = ${kind}`,
            ),
      )
      .orderBy(desc(mediaAssets.createdAt))
      .limit(filter.limit);
  }

  async rememberAsset(entry: LibraryEntry): Promise<void> {
    /*
     * `this.db` is the request's tenant-scoped connection, the same one every
     * other method here uses — so `app.customer_id` is set and the RLS policy
     * on `media_assets` admits the row.
     *
     * Worth saying explicitly because the table is under FORCE ROW LEVEL
     * SECURITY: written on a bare pool this INSERT would be refused, and a read
     * would match nothing and look like "no files" rather than like a missing
     * tenant context (§9.6, and the P40-03 instance).
     */
    await this.db
      .insert(mediaAssets)
      .values({
        customerId: entry.customerId,
        storageKey: entry.storageKey,
        fileName: entry.fileName,
        mimeType: entry.mimeType,
        byteSize: entry.byteSize,
        uploadedBy: entry.uploadedBy,
      })
      /*
       * Uploading the same file again refreshes what we know about it rather
       * than adding a twin. The title and alt text are deliberately **not**
       * touched: those are the author's words about the file, and a re-upload
       * of the same object is not a reason to discard them.
       */
      .onConflictDoUpdate({
        target: [mediaAssets.customerId, mediaAssets.storageKey],
        set: {
          fileName: entry.fileName,
          mimeType: entry.mimeType,
          byteSize: entry.byteSize,
          updatedAt: sql`now()`,
        },
      });
  }
}

/**
 * Records storage events on their own connection, in their own transaction.
 *
 * Takes the pool rather than the request's `Db`, which is the whole point — see
 * `StorageAuditPort`. It opens a second connection while the request still
 * holds one, so the pool must have room for two per in-flight upload; uploads
 * are rare and the pool is sized in tens, but a pool of one would deadlock and
 * that is worth knowing before somebody tunes it down.
 *
 * `runInTenant` rather than a raw INSERT, so the row is written under the same
 * RLS policy as everything else and a customer id that does not match the
 * event's is refused by the database rather than trusted.
 */
export class StorageAuditRecorder implements StorageAuditPort {
  constructor(
    private readonly pool: Pool,
    private readonly tenant: TenantContext,
  ) {}

  async record(event: StorageEvent): Promise<void> {
    await runInTenant(this.pool, this.tenant, async (db) => {
      await db.insert(storageAuditLog).values({
        customerId: event.customerId,
        courseId: event.courseId,
        actorKind: event.actorKind,
        actorId: event.actorId,
        action: event.action,
        objectKey: event.objectKey,
        sizeBytes: event.sizeBytes,
        mimeType: event.mimeType,
        succeeded: event.succeeded,
        detail: event.detail,
      });
    });
  }
}

/**
 * The append-only guarantee, asserted from the application's own connection.
 *
 * Exported for the integration suite: migration 0029 checks the privilege at
 * migration time, and this checks it as `ds_app` actually connects — which is
 * the state that matters after a restore, a role change, or a hand-run grant.
 */
export async function storageLogIsAppendOnly(db: Db): Promise<boolean> {
  const result = await db.execute<{ writable: boolean }>(sql`
    SELECT has_table_privilege(current_user, 'storage_audit_log', 'UPDATE')
        OR has_table_privilege(current_user, 'storage_audit_log', 'DELETE')
        AS writable
  `);

  return result.rows[0]?.writable === false;
}
