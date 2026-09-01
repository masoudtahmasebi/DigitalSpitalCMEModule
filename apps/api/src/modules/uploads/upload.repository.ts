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
import { contents, courses, mediaAssets, storageAuditLog } from "../../db/schema.js";
import { runInTenant, type Db, type TenantContext } from "../../db/tenant-db.js";
import type { TenantRunner } from "../../db/tenant-runner.js";

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
  /** One entry, or undefined when this tenant cannot see it. */
  findAsset(id: string): Promise<LibraryRow | undefined>;
  /** Set the human title and the alt text. Answers false if it is not ours. */
  describeAsset(
    id: string,
    title: string | null,
    altText: string | null,
  ): Promise<boolean>;
  /** How many course contents still point at this object. */
  countAssetUses(reference: string): Promise<number>;
  /**
   * The same count for a whole page of references, in one query (P88-01).
   *
   * The library screen shows the count on every row so that removing a file is
   * a decision somebody can make **before** pressing the button rather than a
   * 409 afterwards. Calling `countAssetUses` per row would be one query per
   * file — fifty files, fifty round trips — which is the shape that turns a
   * useful column into a slow screen somebody removes again.
   *
   * References absent from the result have no uses; the caller reads a missing
   * key as zero rather than as unknown, because "unknown" has no rendering.
   */
  countUsesFor(references: readonly string[]): Promise<ReadonlyMap<string, number>>;
  /** Forget the library entry. The object itself is untouched — see the service. */
  forgetAsset(id: string): Promise<boolean>;
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

  /**
   * How many contents point at each of these references, in one query.
   *
   * The predicate is the same one `countAssetUses` uses, applied to a set —
   * written once as a lateral over the references rather than four separate
   * scans, so a file referenced as both a poster and a source counts once.
   *
   * No `customer_id` filter, for the reason `listAssets` states: `contents` is
   * under RLS and the connection carries the tenant. A count that reached
   * across tenants would tell an operator how popular another customer's file
   * is, which is the §9.5 shape in a number.
   */
  async countUsesFor(
    references: readonly string[],
  ): Promise<ReadonlyMap<string, number>> {
    if (references.length === 0) return new Map();

    /*
     * Every reference is a **bound parameter**, never interpolated.
     *
     * `sql.join` over `sql`${value}`` produces one placeholder per entry, so a
     * storage key is data on the way to Postgres and cannot become syntax. The
     * values here are server-generated keys rather than anything a caller
     * typed, which is a reason to be calm and not a reason to concatenate: the
     * next person to reuse this helper will pass it something else.
     */
    const list = sql.join(
      references.map((reference) => sql`${reference}`),
      sql`, `,
    );

    const result = await this.db.execute<{ reference: string; n: string }>(sql`
      SELECT r.reference, count(c.id)::text AS n
        FROM unnest(ARRAY[${list}]::text[]) AS r(reference)
        LEFT JOIN contents c
          ON c.poster_url = r.reference
          OR c.captions_url = r.reference
          OR c.file_url = r.reference
          OR c.media_sources @> jsonb_build_array(jsonb_build_object('url', r.reference))
       GROUP BY r.reference
    `);

    return new Map(result.rows.map((row) => [row.reference, Number(row.n)] as const));
  }

  async findAsset(id: string): Promise<LibraryRow | undefined> {
    const [row] = await this.db
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
      .where(eq(mediaAssets.id, id))
      .limit(1);
    return row;
  }

  async describeAsset(
    id: string,
    title: string | null,
    altText: string | null,
  ): Promise<boolean> {
    const updated = await this.db
      .update(mediaAssets)
      .set({ title, altText, updatedAt: sql`now()` })
      .where(eq(mediaAssets.id, id))
      .returning({ id: mediaAssets.id });
    return updated.length > 0;
  }

  /**
   * How many course contents still point at this object.
   *
   * Four places a reference can sit, and all four are checked: a poster, a
   * caption track, a material's file, and any rendition inside `media_sources`.
   * Missing one would let the library forget a file that is still on a screen,
   * and the learner-facing failure of that is a video with no poster and
   * nothing anywhere saying why.
   *
   * `media_sources` is jsonb, so the containment test goes through it rather
   * than a column comparison — `@>` on an array of objects asks "is there an
   * element with this url", which is exactly the question.
   */
  async countAssetUses(reference: string): Promise<number> {
    const [row] = await this.db
      .select({ n: sql<string>`count(*)::text` })
      .from(contents)
      .where(
        sql`${contents.posterUrl} = ${reference}
         OR ${contents.captionsUrl} = ${reference}
         OR ${contents.fileUrl} = ${reference}
         OR ${contents.mediaSources} @> ${JSON.stringify([{ url: reference }])}::jsonb`,
      );
    return Number(row?.n ?? "0");
  }

  async forgetAsset(id: string): Promise<boolean> {
    const removed = await this.db
      .delete(mediaAssets)
      .where(eq(mediaAssets.id, id))
      .returning({ id: mediaAssets.id });
    return removed.length > 0;
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
 * The same repository, one short transaction per call (P145-01).
 *
 * ## Why this exists rather than a change to `UploadRepository`
 *
 * Every upload handler has the same shape:
 *
 *     read some rows → **talk to the object store** → write one row
 *
 * Under the ambient transaction the connection is held for all three, so the
 * middle step — a call to somebody else's server — occupies one of ten pooled
 * connections for as long as that server takes. P144 bounded that wait; a bound
 * is not a fix, and "it is only fifteen seconds" is the same shape of answer as
 * "a pool of one would deadlock" (§9.10a).
 *
 * With this, the connection is held for the reads and for the write, and
 * **released while the bucket is thinking**. A bucket that is slow, or gone,
 * costs the uploads and nothing else.
 *
 * It delegates to `UploadRepository` rather than reimplementing it, because two
 * copies of a query under RLS is exactly how one of them quietly stops matching
 * the policy. Every method here is the same SQL, in its own transaction, with
 * the same tenant context — `TenantRun` opens `runInTenant` with the request's
 * own principal.
 *
 * ## What is given up
 *
 * The handler is no longer one atomic transaction. Nothing on these routes
 * spans the gap that atomicity protected: by the time `rememberAsset` runs the
 * object is already in the bucket, `rememberAsset` is idempotent on
 * `(customer_id, storage_key)` by design, and no invariant relates the mint
 * that was read to the row that is written. A route where that is not true
 * keeps the ambient transaction — which is why `@NoAmbientTransaction()` is
 * per-route and not a new default.
 */
export class RunnerUploadRepository implements UploadRepositoryPort {
  constructor(private readonly run: TenantRunner) {}

  findCourseId(slug: string): Promise<string | undefined> {
    return this.run((db) => new UploadRepository(db).findCourseId(slug));
  }

  findMint(objectKey: string): Promise<RecordedMint | undefined> {
    return this.run((db) => new UploadRepository(db).findMint(objectKey));
  }

  listAssets(filter: LibraryFilter): Promise<readonly LibraryRow[]> {
    return this.run((db) => new UploadRepository(db).listAssets(filter));
  }

  findAsset(id: string): Promise<LibraryRow | undefined> {
    return this.run((db) => new UploadRepository(db).findAsset(id));
  }

  describeAsset(
    id: string,
    title: string | null,
    altText: string | null,
  ): Promise<boolean> {
    return this.run((db) => new UploadRepository(db).describeAsset(id, title, altText));
  }

  countAssetUses(reference: string): Promise<number> {
    return this.run((db) => new UploadRepository(db).countAssetUses(reference));
  }

  countUsesFor(references: readonly string[]): Promise<ReadonlyMap<string, number>> {
    return this.run((db) => new UploadRepository(db).countUsesFor(references));
  }

  forgetAsset(id: string): Promise<boolean> {
    return this.run((db) => new UploadRepository(db).forgetAsset(id));
  }

  rememberAsset(entry: LibraryEntry): Promise<void> {
    return this.run((db) => new UploadRepository(db).rememberAsset(entry));
  }
}

/**
 * Records storage events on their own connection, in their own transaction.
 *
 * Takes a pool rather than the request's `Db`, which is the whole point — see
 * `StorageAuditPort`. It opens a second connection while the request still
 * holds one.
 *
 * ## The bound this comment used to state, and got wrong (P142-01)
 *
 * It said "a pool of one would deadlock", which sounds like a warning about
 * tuning and is not one. The real bound is a pool of **N** with **N concurrent
 * requests**: each holds its first connection and waits for a second that only
 * another of the N can release. With `max: 10` that is ten people — or one
 * person opening the Mediathek, which asks for a signed URL per tile. It
 * happened, twice, and the API stopped answering until somebody restarted it.
 *
 * So the pool passed here must be `PG_SIDE_POOL`, which the request path never
 * holds. `guardReentry` refuses it if a caller ever passes the request's.
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
