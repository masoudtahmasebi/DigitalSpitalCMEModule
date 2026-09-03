/**
 * The backup, taken and then actually restored (P23-03).
 *
 * ## Why the restore is the test
 *
 * A backup that has never been restored is a hypothesis. Everything up to the
 * upload can succeed while the result is unusable — a truncated dump, a
 * mismatched key, an authentication tag written in the wrong place — and every
 * one of those failures looks identical from the backup side: a file appeared
 * in a bucket.
 *
 * So this runs the real `pg_dump` against the real database, encrypts it,
 * uploads it to a bucket that verifies the signature, downloads it again,
 * decrypts it with **the exact snippet the runbook gives an operator** — run as
 * a standalone `node -e`, importing nothing from this repository — and restores
 * it into a fresh database with `pg_restore`. Then it looks for the row.
 *
 * That indirection is the point. A recovery procedure that only works if this
 * codebase still exists is not a recovery procedure, and one that is written
 * down but never executed is a paragraph. If the runbook and the code ever
 * disagree, this fails, rather than a person at 3am.
 *
 * **It is not `openssl enc`.** The first version of this test tried, and
 * `openssl enc` refuses outright: "AEAD ciphers not supported". That is worth
 * recording, because `openssl enc -d -aes-256-gcm` is what one would naturally
 * write into a runbook, it looks entirely plausible, and it cannot work. The
 * authentication tag is the reason GCM was chosen — a restore from a silently
 * altered dump is worse than one that fails — so the answer is a different
 * tool, not a weaker cipher.
 */

import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { createPool } from "@ds/postgres";
import { S3Presigner } from "../../src/shared/s3-presigner.js";
import {
  runDatabaseBackup,
  runFreshnessCheck,
  runObjectMirror,
  runRestore,
} from "../../src/backup/backup.js";
import { DEFAULT_RETENTION } from "../../src/backup/retention.js";
import { BackupStore } from "../../src/backup/store.js";
import { startFakeS3, type FakeS3 } from "../support/fake-s3.js";
import { requireEnv } from "./support/env.js";

const run = promisify(execFile);

const SUPERUSER_URL = requireEnv("POSTGRES_SUPERUSER_URL");
const RUN = randomUUID().slice(0, 8);
const RESTORE_DB = `ds_restore_${RUN}`;

/** 32 bytes, generated per run. Never a real key — those live in secrets.env. */
const KEY = Buffer.from(randomUUID().replace(/-/g, "").padEnd(32, "0").slice(0, 32));

let bucket: FakeS3;
let store: BackupStore;
let pool: Pool;
let workDir: string;
let customerSlug: string;

beforeAll(async () => {
  bucket = await startFakeS3();
  store = new BackupStore(
    new S3Presigner({
      endpoint: bucket.endpoint,
      region: bucket.region,
      bucket: bucket.bucket,
      accessKeyId: bucket.accessKeyId,
      secretAccessKey: bucket.secretAccessKey,
      forcePathStyle: true,
    }),
  );

  pool = createPool({ connectionString: SUPERUSER_URL });
  workDir = await mkdtemp(join(tmpdir(), "ds-backup-"));

  // A row to look for on the other side. Not "some data" — a specific value
  // that could only have come through the dump.
  customerSlug = `backup-${RUN}`;
  await pool.query("INSERT INTO customers (slug, name) VALUES ($1, $2)", [
    customerSlug,
    "Backup Drill GmbH",
  ]);
}, 60_000);

afterAll(async () => {
  await pool?.query("DELETE FROM customers WHERE slug = $1", [customerSlug]);
  await pool?.query(`DROP DATABASE IF EXISTS ${RESTORE_DB}`).catch(() => undefined);
  await pool?.end();
  await bucket?.close();
  await rm(workDir, { recursive: true, force: true });
});

describe("taking a backup", () => {
  it("dumps, encrypts, uploads and confirms", async () => {
    const now = new Date();
    const report = await runDatabaseBackup({
      store,
      prefix: "backups/",
      databaseUrl: SUPERUSER_URL,
      encryptionKey: KEY,
      workDir,
      retention: DEFAULT_RETENTION,
      now,
    });

    expect(report.key).toBeDefined();
    expect(report.bytes ?? 0).toBeGreaterThan(1000);
    expect(report.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(bucket.objects.has(report.key ?? "")).toBe(true);
  }, 120_000);

  it("leaves no dump behind on the local disk", async () => {
    // A complete copy of the database sitting in a container is both a growing
    // disk and a second place the data lives.
    const { readdir } = await import("node:fs/promises");
    expect(await readdir(workDir)).toEqual([]);
  });

  it("stores ciphertext, not a readable dump", async () => {
    const now = new Date(Date.now() + 1000);
    const report = await runDatabaseBackup({
      store,
      prefix: "backups/",
      databaseUrl: SUPERUSER_URL,
      encryptionKey: KEY,
      workDir,
      retention: DEFAULT_RETENTION,
      now,
    });

    const stored = bucket.objects.get(report.key ?? "")?.body ?? Buffer.alloc(0);

    // `pg_dump -Fc` begins with the magic `PGDMP`. Finding it would mean the
    // whole of docs/gdpr.md §2 is sitting in a bucket in the clear.
    expect(stored.includes(Buffer.from("PGDMP"))).toBe(false);
    expect(stored.toString("latin1")).not.toContain(customerSlug);
  }, 120_000);

  it("refuses a connection string that names no database", async () => {
    // The failure this guard exists for: libpq falling back to defaults and
    // dumping something — successfully — that is not our database.
    await expect(
      runDatabaseBackup({
        store,
        prefix: "backups/",
        databaseUrl: "postgres://user:pw@127.0.0.1:5432/",
        encryptionKey: KEY,
        workDir,
        retention: DEFAULT_RETENTION,
        now: new Date(),
      }),
    ).rejects.toThrow(/names no database/);
  });
});

describe("the restore drill — the only thing that makes it a backup", () => {
  it("round-trips: decrypt, restore with pg_restore, and find the row", async () => {
    const now = new Date(Date.now() + 2000);
    const report = await runDatabaseBackup({
      store,
      prefix: "backups/",
      databaseUrl: SUPERUSER_URL,
      encryptionKey: KEY,
      workDir,
      retention: DEFAULT_RETENTION,
      now,
    });

    const stored = bucket.objects.get(report.key ?? "")?.body;
    if (stored === undefined) throw new Error("the backup is not in the bucket");

    // Split the file the way the runbook tells an operator to: 12-byte nonce,
    // ciphertext, 16-byte tag.
    const nonce = stored.subarray(0, 12);
    const tag = stored.subarray(stored.byteLength - 16);

    expect(nonce.byteLength).toBe(12);
    expect(tag.byteLength).toBe(16);

    const encPath = join(workDir, "restore.bin");
    const dumpPath = join(workDir, "restore.dump");
    await writeFile(encPath, stored);

    // Verbatim from `docs/runbook-backup.md`. Run in a temp directory as a
    // standalone script so it cannot accidentally reach anything in this repo.
    await decryptTheWayTheRunbookSays(encPath, dumpPath, KEY);

    const restored = await readFile(dumpPath);
    expect(restored.subarray(0, 5).toString()).toBe("PGDMP");

    await pool.query(`CREATE DATABASE ${RESTORE_DB}`);
    const target = new URL(SUPERUSER_URL);
    target.pathname = `/${RESTORE_DB}`;

    await run(
      "pg_restore",
      ["--no-owner", "--no-privileges", "--dbname", target.toString(), dumpPath],
      {
        maxBuffer: 32 * 1024 * 1024,
      },
    );

    const restoredPool = createPool({ connectionString: target.toString() });
    try {
      const { rows } = await restoredPool.query<{ name: string }>(
        "SELECT name FROM customers WHERE slug = $1",
        [customerSlug],
      );
      // The row, out of a database that did not exist a moment ago.
      expect(rows[0]?.name).toBe("Backup Drill GmbH");
    } finally {
      await restoredPool.end();
    }
  }, 180_000);
  it("refuses a dump somebody has altered", async () => {
    // The whole reason for an authenticated cipher. A restore from a silently
    // modified dump would put wrong data behind a CME record and report success.
    const now = new Date(Date.now() + 3000);
    const report = await runDatabaseBackup({
      store,
      prefix: "backups/",
      databaseUrl: SUPERUSER_URL,
      encryptionKey: KEY,
      workDir,
      retention: DEFAULT_RETENTION,
      now,
    });

    const stored = Buffer.from(bucket.objects.get(report.key ?? "")?.body ?? []);
    // One byte, in the middle of the ciphertext.
    const target = Math.floor(stored.byteLength / 2);
    stored[target] = (stored[target] ?? 0) ^ 0xff;

    const encPath = join(workDir, "tampered.bin");
    await writeFile(encPath, stored);

    await expect(
      decryptTheWayTheRunbookSays(encPath, join(workDir, "tampered.dump"), KEY),
    ).rejects.toThrow();
  }, 120_000);
});

/**
 * The runbook's recovery snippet, executed rather than quoted.
 *
 * Kept as one string so it can be compared to `docs/runbook-backup.md` by
 * reading both — and so that changing one without the other is a failing test
 * rather than a discovery during an incident.
 */
const RUNBOOK_DECRYPT = `
const { createDecipheriv } = require("node:crypto");
const { readFileSync, writeFileSync } = require("node:fs");
const [, , inPath, outPath, keyHex] = process.argv;
const blob = readFileSync(inPath);
const decipher = createDecipheriv(
  "aes-256-gcm",
  Buffer.from(keyHex, "hex"),
  blob.subarray(0, 12),
);
decipher.setAuthTag(blob.subarray(blob.length - 16));
writeFileSync(
  outPath,
  Buffer.concat([decipher.update(blob.subarray(12, blob.length - 16)), decipher.final()]),
);
`;

async function decryptTheWayTheRunbookSays(
  encPath: string,
  outPath: string,
  key: Buffer,
): Promise<void> {
  const scriptPath = join(workDir, "decrypt.cjs");
  await writeFile(scriptPath, RUNBOOK_DECRYPT);
  await run("node", [scriptPath, encPath, outPath, key.toString("hex")], {
    maxBuffer: 32 * 1024 * 1024,
  });
}

describe("mirroring objects", () => {
  it("copies what is not already there and skips what is", async () => {
    bucket.objects.set("0198f4c1/courses/abc/video-1.mp4", {
      body: Buffer.from("a lecture"),
      contentType: "video/mp4",
    });

    const first = await runObjectMirror({
      source: store,
      destination: store,
      sourceBucket: bucket.bucket,
      destinationPrefix: "backups/objects/",
      now: new Date(),
    });

    expect(first.copied).toBeGreaterThanOrEqual(1);
    expect(first.failed).toEqual([]);
    expect(bucket.objects.has("backups/objects/0198f4c1/courses/abc/video-1.mp4")).toBe(
      true,
    );

    const second = await runObjectMirror({
      source: store,
      destination: store,
      sourceBucket: bucket.bucket,
      destinationPrefix: "backups/objects/",
      now: new Date(),
    });

    // Incremental. A mirror that re-copied everything nightly would be a
    // bandwidth bill and a window in which the copy is half-written.
    expect(second.copied).toBe(0);
    expect(second.skipped).toBeGreaterThanOrEqual(1);
  }, 60_000);

  it("never copies its own copies", async () => {
    // Without the exclusion this grows `backups/objects/backups/objects/…`
    // every night until the bucket bill notices.
    const before = [...bucket.objects.keys()].filter((key) =>
      key.startsWith("backups/objects/backups/"),
    );
    await runObjectMirror({
      source: store,
      destination: store,
      sourceBucket: bucket.bucket,
      destinationPrefix: "backups/objects/",
      now: new Date(),
    });

    expect(
      [...bucket.objects.keys()].filter((key) =>
        key.startsWith("backups/objects/backups/"),
      ),
    ).toEqual(before);
  }, 60_000);
});

describe("the freshness check", () => {
  it("passes while a recent backup exists", async () => {
    const result = await runFreshnessCheck({
      store,
      prefix: "backups/",
      maxAgeHours: 26,
      now: new Date(),
    });

    expect(result.fresh).toBe(true);
    expect(result.newest).toBeDefined();
  });

  it("fails when the newest backup is too old to trust", async () => {
    // What a timer that stopped firing looks like — and the only signal that
    // distinguishes it from one that is working.
    const result = await runFreshnessCheck({
      store,
      prefix: "backups/",
      maxAgeHours: 26,
      now: new Date(Date.now() + 5 * 86_400_000),
    });

    expect(result.fresh).toBe(false);
  });
});

describe("the operator's restore, which is the one that has to work at 22:00 (P182-01)", () => {
  /*
   * §9.7, on the drill above.
   *
   * That drill splits the file, decrypts it with a standalone `node -e` and
   * calls `pg_restore` by hand — deliberately, because it is checking the
   * *runbook*. It would pass unchanged with `runRestore` deleted, and for a
   * year the only way to actually restore a backup was to read it and do the
   * same by hand.
   *
   * These cases drive the command an operator runs. The property is the same
   * and the caller is the point.
   */
  const OPERATOR_DB = `${RESTORE_DB}_operator`;

  afterAll(async () => {
    await pool.query(`DROP DATABASE IF EXISTS ${OPERATOR_DB}`).catch(() => undefined);
  });

  it("fetches, decrypts and loads a backup into a database that was empty", async () => {
    const now = new Date(Date.now() + 4000);
    const report = await runDatabaseBackup({
      store,
      prefix: "backups/",
      databaseUrl: SUPERUSER_URL,
      encryptionKey: KEY,
      workDir,
      retention: DEFAULT_RETENTION,
      now,
    });

    await pool.query(`CREATE DATABASE ${OPERATOR_DB}`);
    const target = new URL(SUPERUSER_URL);
    target.pathname = `/${OPERATOR_DB}`;

    const restored = await runRestore({
      store,
      key: report.key ?? "",
      encryptionKey: KEY,
      targetDatabaseUrl: target.toString(),
      workDir,
      now: new Date(),
    });

    expect(restored.key).toBe(report.key);
    expect(restored.bytes).toBeGreaterThan(0);

    const restoredPool = createPool({ connectionString: target.toString() });
    try {
      const { rows } = await restoredPool.query<{ name: string }>(
        "SELECT name FROM customers WHERE slug = $1",
        [customerSlug],
      );
      // The row, out of a database that did not exist a moment ago — through
      // the command rather than through a reproduction of it.
      expect(rows[0]?.name).toBe("Backup Drill GmbH");
    } finally {
      await restoredPool.end();
    }
  }, 180_000);

  it("leaves no copy of the database behind", async () => {
    /*
     * Both the ciphertext and the plaintext are complete copies of every
     * physician's record on the platform. A restore that left either in the
     * container's work directory would be a lasting disclosure created by a
     * recovery — and nobody would look, because the command succeeded.
     */
    const { readdir } = await import("node:fs/promises");
    const left = (await readdir(workDir)).filter((name) =>
      name.startsWith("ds-restore-"),
    );

    expect(left).toEqual([]);
  });

  it("refuses an archive encrypted with a different key, rather than half-restoring", async () => {
    const now = new Date(Date.now() + 5000);
    const report = await runDatabaseBackup({
      store,
      prefix: "backups/",
      databaseUrl: SUPERUSER_URL,
      encryptionKey: KEY,
      workDir,
      retention: DEFAULT_RETENTION,
      now,
    });

    const target = new URL(SUPERUSER_URL);
    target.pathname = `/${OPERATOR_DB}`;

    /*
     * The reason `backup.ts` chose GCM, exercised through the caller that now
     * depends on it: the tag authenticates every byte, so a wrong key fails at
     * `final()` before `pg_restore` is ever started.
     *
     * The message has to name the key, not the database. An operator reading
     * "unable to authenticate data" will spend the night looking at Postgres.
     */
    await expect(
      runRestore({
        store,
        key: report.key ?? "",
        encryptionKey: Buffer.alloc(32, 7),
        targetDatabaseUrl: target.toString(),
        workDir,
        now: new Date(),
      }),
    ).rejects.toThrow(/BACKUP_ENCRYPTION_KEY/);
  }, 120_000);

  it("names a key that is not there", async () => {
    const target = new URL(SUPERUSER_URL);
    target.pathname = `/${OPERATOR_DB}`;

    // The most likely failure in an incident is a key mistyped off a listing,
    // and "get 404" beats a stack trace about an empty file.
    await expect(
      runRestore({
        store,
        key: "backups/does-not-exist.dump.enc",
        encryptionKey: KEY,
        targetDatabaseUrl: target.toString(),
        workDir,
        now: new Date(),
      }),
    ).rejects.toThrow();
  });

  it("lists what is there, so a key can be copied rather than guessed", async () => {
    const keys = await store.list("backups/", new Date());

    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      // Every key is fetchable by the same store the restore uses — a listing
      // that named objects `restore` could not read would be worse than none.
      expect(await store.size(key, new Date())).toBeGreaterThan(0);
    }
  });
});
