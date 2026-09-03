/**
 * Taking the backups (P23-03).
 *
 * ## What a backup has to survive
 *
 * Three failures, and they want different things:
 *
 * - **A bad migration or a wrong DELETE.** Wanted: yesterday's database, and
 *   the day before. Answered by `runDatabaseBackup`.
 * - **A deleted or corrupted object.** Wanted: the video back. Answered by
 *   `runObjectMirror` — a *second bucket*, not versioning, because versioning
 *   protects against a mistake and not against the credential that made it.
 * - **The backup job quietly stopping.** Wanted: to find out before the
 *   restore. Answered by `runFreshnessCheck`, which is meant to run separately
 *   and to page.
 *
 * The third is not a nicety. A cron that stopped firing three weeks ago is
 * indistinguishable from one that is working, and every backup horror story has
 * that sentence in it somewhere.
 *
 * ## Encrypted before it leaves the host
 *
 * The dump contains every participant's name, e-mail and EFN, every quiz
 * answer, every free-text evaluation response — the whole of `docs/gdpr.md` §2
 * in one file. AES-256-GCM with a key that lives only in the deployment's
 * secrets, so the copy in object storage is ciphertext and a bucket
 * misconfiguration is not a data breach.
 *
 * GCM rather than CBC because a backup must be *authenticated*: a restore from
 * a silently-altered dump is worse than a restore that fails, and only an AEAD
 * tells you which one you have. The nonce is random per file and stored in the
 * first 12 bytes; the tag is appended. `restore.md` documents the inverse in
 * plain `openssl`, so recovery does not depend on this code still existing.
 *
 * ## Why the key is not `SECRETS_KMS_KEY`
 *
 * That key decrypts the VNR password and the SMTP credentials *inside* the
 * database. Using it here would mean the backup and the thing it protects share
 * a secret: an attacker with the backup key could read the encrypted columns in
 * the dump they just decrypted. They are separate on purpose, and the runbook
 * says to store them apart.
 */

import { spawn } from "node:child_process";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { open, rm, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { applyRetention, backupKey, isFresh, type RetentionPolicy } from "./retention.js";
import { fileDigest, type BackupStore } from "./store.js";

/** AES-256-GCM: 12-byte nonce, 16-byte tag. Both are the standard sizes. */
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export interface BackupReport {
  readonly kind: string;
  readonly key?: string;
  readonly bytes?: number;
  readonly digest?: string;
  readonly removed: readonly string[];
  readonly unrecognised: readonly string[];
  readonly copied?: number;
  readonly skipped?: number;
}

export interface DatabaseBackupOptions {
  readonly store: BackupStore;
  readonly prefix: string;
  /** The connection string `pg_dump` runs with. Must be able to read every row. */
  readonly databaseUrl: string;
  /** 32 bytes. Not `SECRETS_KMS_KEY` — see the header. */
  readonly encryptionKey: Buffer;
  readonly workDir: string;
  readonly retention: RetentionPolicy;
  readonly now: Date;
}

/**
 * Dump, encrypt, upload, verify, prune.
 *
 * To a file first, then uploaded. Streaming `pg_dump` straight into a PUT is
 * tempting and wrong: S3 needs a `Content-Length` for a plain PUT, and nobody
 * knows the length of a compressed encrypted dump until it exists. Writing it
 * out also makes the digest cheap and gives the upload something to retry from
 * — which streaming would not.
 */
export async function runDatabaseBackup(
  options: DatabaseBackupOptions,
): Promise<BackupReport> {
  const key = backupKey(options.prefix, "database", options.now);
  const path = `${options.workDir}/ds-backup-${options.now.getTime()}.dump.enc`;

  try {
    await dumpAndEncrypt(options.databaseUrl, options.encryptionKey, path);

    // `path` is built above from a configured directory and a timestamp; no
    // request value reaches it.
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- see above
    const { size } = await stat(path);
    // `pg_dump` can exit 0 having written nothing if it is pointed somewhere
    // empty. A zero-length "backup" uploaded and pruned against is the failure
    // this whole file exists to prevent.
    if (size <= NONCE_BYTES) {
      throw new Error(`the dump is ${size} bytes — that is not a database`);
    }

    const digest = await fileDigest(path);
    await options.store.putFile(key, path, options.now);

    // Ask the bucket what it has, rather than trusting a 200. The upload is the
    // one step between "we made a backup" and "there is a backup".
    const stored = await options.store.size(key, options.now);
    if (stored !== size) {
      throw new Error(
        `uploaded ${size} bytes and the bucket reports ${stored ?? "nothing"}`,
      );
    }

    // Only now. Pruning before the new copy is confirmed is how a retention
    // policy turns a bad night into an empty bucket.
    const { removed, unrecognised } = await prune(
      options.store,
      `${options.prefix}database/`,
      options.now,
      options.retention,
    );

    return { kind: "database", key, bytes: size, digest, removed, unrecognised };
  } finally {
    // The plaintext never touched the disk — this file is ciphertext — but it
    // is still a complete copy of the database sitting in a container, and
    // leaving it there would grow without bound.
    await rm(path, { force: true });
  }
}

function dumpAndEncrypt(
  databaseUrl: string,
  encryptionKey: Buffer,
  path: string,
): Promise<void> {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, nonce);

  // `-Fc` is the custom format: compressed, and `pg_restore` can read a single
  // table out of it. A plain SQL dump would be larger and restorable only whole.
  //
  // The connection goes in the environment as libpq's own variables rather than
  // as `--dbname=postgres://user:password@…`, because a command line is visible
  // in `ps` to every other process on the host. `PGURI` is not a libpq variable
  // and passing one silently connects to the wrong place — the defaults — which
  // is a backup of an empty database that exits 0.
  const dump = spawn(
    "pg_dump",
    ["--format=custom", "--no-owner", "--no-privileges", "--compress=6"],
    {
      env: { ...process.env, ...libpqEnv(databaseUrl) },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let stderr = "";
  dump.stderr.on("data", (chunk: Buffer) => {
    // Bounded: a pg_dump that fails per-table could otherwise fill memory with
    // its own complaints.
    if (stderr.length < 8192) stderr += chunk.toString("utf8");
  });

  // As above: the caller builds this path, and no request value reaches it.
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- see above
  const out = createWriteStream(path);
  out.write(nonce);

  const finished = new Promise<void>((resolve, reject) => {
    dump.on("error", reject);
    dump.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pg_dump exited ${code}: ${stderr.trim()}`));
    });
  });

  return Promise.all([
    pipeline(dump.stdout, cipher, out).then(async () => {
      // The tag authenticates everything before it, so it can only be written
      // once the cipher has seen the last byte.
      const { appendFile } = await import("node:fs/promises");
      await appendFile(path, cipher.getAuthTag());
    }),
    finished,
  ]).then(() => undefined);
}

/**
 * Do two connection strings name the same database on the same server?
 *
 * The guard `backup restore` uses before it writes anything. Host, port and
 * database name; user and query parameters ignored, because `?sslmode=require`
 * and a different role do not make it a different database.
 *
 * A URL that will not parse counts as **the same**, which is the safe answer
 * when the question being asked is "am I about to overwrite production". A
 * typo in `RESTORE_DATABASE_URL` costs a refusal and a second attempt; the
 * other failure mode costs the database.
 *
 * Exported for its tests rather than because anything else calls it: it is the
 * one line standing between a recovery and an overwrite, and CLAUDE.md §9.3 is
 * about rules that are correct, untested where it counts, and therefore
 * believed.
 */
export function sameDatabase(a: string, b: string): boolean {
  try {
    const left = new URL(a);
    const right = new URL(b);
    return (
      left.hostname === right.hostname &&
      (left.port || "5432") === (right.port || "5432") &&
      left.pathname === right.pathname
    );
  } catch {
    return true;
  }
}

export interface RestoreOptions {
  readonly store: BackupStore;
  /** The exact object key, as `list` prints it. */
  readonly key: string;
  readonly encryptionKey: Buffer;
  /** Where the dump is restored **into**. Never the live database — see below. */
  readonly targetDatabaseUrl: string;
  readonly workDir: string;
  readonly now: Date;
}

export interface RestoreReport {
  readonly key: string;
  readonly bytes: number;
  readonly digest: string;
  /** `pg_restore`'s own complaints, kept — a restore is rarely perfectly clean. */
  readonly warnings: readonly string[];
}

/**
 * Fetch one backup and restore it into a database (P182-01).
 *
 * ## Why this exists, having not existed
 *
 * The backup has been taken nightly, encrypted, uploaded, pruned and
 * freshness-checked since P23-03, and the integration suite has restored one on
 * every CI run since — *"a backup that has never been restored is a
 * hypothesis"*. What there was no way to do was restore one **as an operator**.
 * The procedure existed as a test file to read at 22:00 on the worst night of
 * the year, which is CLAUDE.md §9.9a's shape: a documented procedure is not a
 * procedure.
 *
 * ## The three things it refuses
 *
 * **A wrong key.** The dump is AES-256-GCM and the tag authenticates every
 * byte. `decipher.final()` throws on a mismatch, so a corrupted or
 * wrong-keyed archive fails here rather than half-restoring — the property
 * `backup.ts`'s header says GCM was chosen for, now with a caller that relies
 * on it.
 *
 * **A missing object.** Named, with the key, because the most likely reason is
 * a typo in a key copied off a listing.
 *
 * **Restoring over the source.** The caller enforces that (see `cli.ts`): this
 * function restores wherever it is pointed, and the guard belongs where the two
 * URLs are both in view.
 *
 * ## What it does not do
 *
 * Create the database, or drop what is there. `--clean --if-exists` would make
 * "restore into the wrong place" silently destructive, and the operator running
 * this is one `psql -c "CREATE DATABASE"` away from an empty target. A restore
 * into a database that already has these tables fails loudly on the conflicts,
 * which is the right outcome.
 */
export async function runRestore(options: RestoreOptions): Promise<RestoreReport> {
  const stamp = options.now.toISOString().replace(/[:.]/gu, "-");
  const encrypted = `${options.workDir}/ds-restore-${stamp}.enc`;
  const plain = `${options.workDir}/ds-restore-${stamp}.dump`;

  try {
    await options.store.getFile(options.key, encrypted, options.now);

    const digest = await fileDigest(encrypted);
    const bytes = await decryptToFile(encrypted, plain, options.encryptionKey);
    const warnings = await pgRestore(options.targetDatabaseUrl, plain);

    return { key: options.key, bytes, digest, warnings };
  } finally {
    // Both, always. The plaintext is a complete copy of the database and must
    // not outlive the command that needed it; the ciphertext is one too, to
    // anybody who also has the key.
    await rm(encrypted, { force: true });
    await rm(plain, { force: true });
  }
}

/**
 * Reverse `dumpAndEncrypt`: nonce, ciphertext, tag.
 *
 * Read in the same layout it was written — 12 bytes of nonce at the front, 16
 * bytes of tag at the end — and the tag is set **before** the final block is
 * flushed, which is what makes `final()` the authentication check rather than a
 * formality.
 */
async function decryptToFile(
  source: string,
  destination: string,
  encryptionKey: Buffer,
): Promise<number> {
  // Paths this module built from its own work directory.
  /* eslint-disable security/detect-non-literal-fs-filename -- see above */
  const total = (await stat(source)).size;

  if (total <= NONCE_BYTES + TAG_BYTES) {
    throw new Error(`${source} is too small to be an encrypted dump`);
  }

  const handle = await open(source, "r");
  try {
    const nonce = Buffer.alloc(NONCE_BYTES);
    await handle.read(nonce, 0, NONCE_BYTES, 0);

    const tag = Buffer.alloc(TAG_BYTES);
    await handle.read(tag, 0, TAG_BYTES, total - TAG_BYTES);

    const decipher = createDecipheriv("aes-256-gcm", encryptionKey, nonce);
    decipher.setAuthTag(tag);

    await pipeline(
      handle.createReadStream({
        start: NONCE_BYTES,
        end: total - TAG_BYTES - 1,
        autoClose: false,
      }),
      decipher,
      createWriteStream(destination),
    );

    return total;
  } catch (error) {
    // The one failure worth naming precisely: an operator who reads
    // "unsupported state or unable to authenticate data" will look at the
    // database, and the answer is the key or the file.
    throw new Error(
      `could not decrypt ${source}: the archive is corrupt or BACKUP_ENCRYPTION_KEY ` +
        `is not the key it was written with (${
          error instanceof Error ? error.message : "unknown error"
        })`,
    );
  } finally {
    await handle.close();
  }
  /* eslint-enable security/detect-non-literal-fs-filename */
}

function pgRestore(databaseUrl: string, path: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    /*
     * `--no-owner --no-privileges` because the dump was taken that way, and
     * `--exit-on-error` is deliberately **absent**: a restore into a database
     * whose roles differ from the source produces per-object complaints that
     * are not failures, and stopping on the first would leave a half-restored
     * database and no report. The warnings are returned instead, so a person
     * decides.
     *
     * The connection goes in the environment, not on the command line: `ps` is
     * readable by every process on the host.
     */
    const env = libpqEnv(databaseUrl);

    /*
     * `--dbname` carries the **name only**, and it has to be there.
     *
     * Unlike `pg_dump`, `pg_restore` refuses without one — "one of -d/--dbname
     * and -f/--file must be specified" — so the libpq environment alone is not
     * enough. Passing the name and nothing else keeps the rule the dump path
     * documents: the host, the user and above all the password stay in the
     * environment, because a command line is readable in `ps` by every other
     * process on the host.
     */
    const restore = spawn(
      "pg_restore",
      [
        "--no-owner",
        "--no-privileges",
        "--single-transaction",
        "--dbname",
        env["PGDATABASE"] ?? "",
        path,
      ],
      {
        env: { ...process.env, ...env },
        stdio: ["ignore", "ignore", "pipe"],
      },
    );

    let stderr = "";
    restore.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 64_000) stderr += chunk.toString("utf8");
    });

    restore.on("error", reject);
    restore.on("close", (code) => {
      const warnings = stderr
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "");

      /*
       * `--single-transaction`, so a non-zero exit means **nothing** was
       * restored rather than some of it. That is the property that makes a
       * failed restore safe to retry, and it is why this rejects with the
       * complaints attached instead of returning them.
       */
      if (code === 0) resolve(warnings);
      else reject(new Error(`pg_restore exited ${code}: ${warnings.join(" | ")}`));
    });
  });
}

/**
 * A connection string as the variables libpq reads.
 *
 * Throws rather than falling back to defaults. A malformed URL that quietly
 * became "connect to localhost as the current user" is the exact shape of the
 * failure this function exists to avoid: it succeeds, and it backs up nothing.
 */
export function libpqEnv(databaseUrl: string): Record<string, string> {
  const url = new URL(databaseUrl);
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error(`not a postgres connection string: ${url.protocol}`);
  }

  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (database === "") throw new Error("the connection string names no database");

  return {
    PGHOST: url.hostname,
    PGPORT: url.port === "" ? "5432" : url.port,
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: database,
    // Never a value from the URL's query string: `options=-c…` would let a
    // connection string set server parameters for the dump.
    PGCONNECT_TIMEOUT: "10",
  };
}

export interface ObjectMirrorOptions {
  readonly source: BackupStore;
  readonly destination: BackupStore;
  readonly sourceBucket: string;
  /** Where the copies land in the backup bucket. Keeps them apart from dumps. */
  readonly destinationPrefix: string;
  readonly now: Date;
}

/**
 * Copy every course object into the backup bucket, once.
 *
 * Incremental by key: an object already present is skipped. That is right for
 * this data — course media is written once and never edited, because an author
 * replacing a video uploads a new object with a new random name rather than
 * overwriting one. If that ever stops being true this needs an etag comparison,
 * and the assumption is written here so the change is obvious rather than
 * silent.
 *
 * One failed copy does not abandon the run. A single unreadable object should
 * not cost the other four hundred their backup — so failures are counted,
 * reported, and the process exits non-zero at the end.
 */
export async function runObjectMirror(
  options: ObjectMirrorOptions,
): Promise<BackupReport & { failed: readonly string[] }> {
  const existing = new Set(
    (await options.destination.list(options.destinationPrefix, options.now)).map((key) =>
      key.slice(options.destinationPrefix.length),
    ),
  );

  // Everything, from the root: the mirror is not tenant-scoped, and skipping
  // the backup prefix is what keeps it from copying its own copies.
  const source = (await options.source.list("", options.now)).filter(
    (key) => !key.startsWith(options.destinationPrefix) && !key.startsWith("backups/"),
  );

  const failed: string[] = [];
  let copied = 0;
  let skipped = 0;

  for (const key of source) {
    if (existing.has(key)) {
      skipped += 1;
      continue;
    }
    try {
      await options.destination.copyFrom(
        options.sourceBucket,
        key,
        `${options.destinationPrefix}${key}`,
        options.now,
      );
      copied += 1;
    } catch {
      // The key, never the error: a copy failure's message can carry a URL.
      failed.push(key);
    }
  }

  return { kind: "objects", removed: [], unrecognised: [], copied, skipped, failed };
}

/**
 * Is there a recent backup? Meant to run on its own schedule, and to page.
 *
 * Separate from the backup itself on purpose. A check that runs inside the job
 * it is checking can only ever report on a run that happened.
 */
export async function runFreshnessCheck(options: {
  readonly store: BackupStore;
  readonly prefix: string;
  readonly maxAgeHours: number;
  readonly now: Date;
}): Promise<{ fresh: boolean; newest: string | undefined }> {
  const keys = await options.store.list(`${options.prefix}database/`, options.now);
  const newest = [...keys].sort().at(-1);

  return {
    fresh: isFresh(keys, options.now, options.maxAgeHours),
    newest,
  };
}

async function prune(
  store: BackupStore,
  prefix: string,
  now: Date,
  retention: RetentionPolicy,
): Promise<{ removed: string[]; unrecognised: readonly string[] }> {
  const decision = applyRetention(await store.list(prefix, now), now, retention);

  const removed: string[] = [];
  for (const key of decision.remove) {
    await store.remove(key, now);
    removed.push(key);
  }

  return { removed, unrecognised: decision.unrecognised };
}
