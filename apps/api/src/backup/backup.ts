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
import { createCipheriv, randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { rm, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { applyRetention, backupKey, isFresh, type RetentionPolicy } from "./retention.js";
import { fileDigest, type BackupStore } from "./store.js";

/** AES-256-GCM: 12-byte nonce, 16-byte tag. Both are the standard sizes. */
const NONCE_BYTES = 12;

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
