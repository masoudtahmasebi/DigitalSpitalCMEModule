/**
 * Object-storage keys, and the tenant isolation they carry (P10-06).
 *
 * Course media — videos and Mediathek downloads — is too large for the
 * database and must not be public. It lives in S3-compatible object storage,
 * and this module decides what a key may look like.
 *
 * ## Isolation is the first path segment, and it is not the client's to choose
 *
 * Every key is `<customerId>/courses/<courseId>/<filename>`. The customer id
 * comes from the **validated token**, server-side, and is prepended here —
 * never read from a request, never taken from the stored value. A stored key
 * that claims another customer's prefix is refused rather than trusted, so a
 * mis-seeded row cannot become a cross-tenant read.
 *
 * That is the object-storage counterpart of ADR-0002. Postgres has RLS to fall
 * back on; a bucket does not, so the guarantee has to be in the key, and the
 * key has to be built somewhere pure and exhaustively tested.
 *
 * ## Why keys and not URLs
 *
 * A stored URL is a capability: anyone who reads the row, a log or a backup can
 * fetch the object forever. A stored *key* is not — it names an object in a
 * private bucket, and the API mints a short-lived signature only after the
 * sequence gate agrees. That is what makes the Mediathek padlock mean something
 * beyond "we chose not to tell you the URL".
 *
 * ## Where the bucket lives
 *
 * Hosting is Hetzner, in Germany, deliberately (CLAUDE.md §4). The object store
 * is S3-**compatible**, not Amazon S3: participation media for German
 * physicians sitting in a US-controlled bucket is a transfer question nobody
 * wants to answer. Everything here is plain SigV4, which Hetzner Object
 * Storage, MinIO and Amazon all speak.
 *
 * Pure — no I/O, no clock. Signing lives in the API.
 */

/** Anything that could escape the prefix, confuse a signer, or break a URL. */
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** UUIDs, as the ids actually are. Loose enough for any version. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class InvalidStorageKeyError extends Error {
  constructor(reason: string) {
    super(`invalid storage key: ${reason}`);
    this.name = "InvalidStorageKeyError";
  }
}

/**
 * Build the key for a course asset.
 *
 * Throws rather than sanitising. A filename that needs repairing is a filename
 * somebody has to reason about later, and the caller is an admin upload path
 * that can simply be told no.
 */
export function courseAssetKey(input: {
  customerId: string;
  courseId: string;
  filename: string;
}): string {
  if (!UUID.test(input.customerId)) {
    throw new InvalidStorageKeyError("customerId is not a uuid");
  }
  if (!UUID.test(input.courseId)) {
    throw new InvalidStorageKeyError("courseId is not a uuid");
  }
  if (!SAFE_SEGMENT.test(input.filename)) {
    // Rejects `..`, `/`, a leading dot, spaces, and anything non-ASCII. A
    // filename is not a place to be generous.
    throw new InvalidStorageKeyError("filename has characters that are not allowed");
  }

  // No length check: two UUIDs, a fixed infix and a filename `SAFE_SEGMENT`
  // already caps at 128 characters cannot exceed 210, well inside S3's 1024-byte
  // key limit. A check here could never fire, and an unreachable guard is worse
  // than none — it implies a case somebody has thought about.
  return `${input.customerId.toLowerCase()}/courses/${input.courseId.toLowerCase()}/${input.filename}`;
}

/**
 * Is this stored value an object-storage key, or an ordinary URL?
 *
 * Both are supported on purpose. A customer who already serves their media
 * from their own CDN keeps doing that — the column holds `https://…` and the
 * API passes it through. A customer on our storage holds `s3://<key>`, and the
 * API signs it. Migrating from one to the other is a data change, not a code
 * change.
 */
export function isStorageReference(value: string): boolean {
  return value.startsWith("s3://");
}

/** The key inside an `s3://` reference, or undefined if it is not one. */
export function storageKeyOf(value: string): string | undefined {
  if (!isStorageReference(value)) return undefined;
  const key = value.slice("s3://".length);
  return key === "" ? undefined : key;
}

/**
 * Refuse a key that does not belong to this customer.
 *
 * The check that makes a mis-seeded row harmless instead of a cross-tenant
 * read. It is deliberately a prefix comparison on a segment boundary: a plain
 * `startsWith` would let customer `abc…` read `abcd…`'s objects, which is a
 * real and easy mistake.
 */
export function keyBelongsToCustomer(key: string, customerId: string): boolean {
  if (!UUID.test(customerId)) return false;
  if (key.includes("..") || key.startsWith("/")) return false;

  const prefix = `${customerId.toLowerCase()}/`;
  return key.toLowerCase().startsWith(prefix);
}

/**
 * The prefix a customer's objects live under.
 *
 * Useful for a bucket policy or a lifecycle rule scoped to one customer, and
 * for the deletion path when a customer leaves — "everything under this
 * prefix" is a complete answer.
 */
export function customerPrefix(customerId: string): string {
  if (!UUID.test(customerId)) {
    throw new InvalidStorageKeyError("customerId is not a uuid");
  }
  return `${customerId.toLowerCase()}/`;
}
