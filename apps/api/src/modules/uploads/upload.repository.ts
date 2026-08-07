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

import { and, desc, eq, sql } from "drizzle-orm";
import type { Pool } from "pg";
import { courses, storageAuditLog } from "../../db/schema.js";
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

export interface UploadRepositoryPort {
  /** The course's id, or undefined when this tenant cannot see that slug. */
  findCourseId(slug: string): Promise<string | undefined>;
  /** What was approved for this key, if this tenant approved anything. */
  findMint(objectKey: string): Promise<RecordedMint | undefined>;
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
