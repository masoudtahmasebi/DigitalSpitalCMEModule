/**
 * `node dist/backup/cli.js <command>` (P23-03). The operator's entrypoint.
 *
 * ## Why this is a separate process and not a route
 *
 * `pg_dump` has to read **every row**, and `ds_app` cannot: `FORCE ROW LEVEL
 * SECURITY` applies to it like anyone else, so a logical dump taken with the
 * API's credentials would be silently partial — one customer's rows, or none,
 * depending on what `app.customer_id` happened to be. It would exit 0.
 *
 * So the backup needs a credential the API deliberately does not hold, which
 * means it cannot live in the API container. That is the whole reason this is
 * its own service with its own environment.
 *
 * ## Exit codes, because something else is watching
 *
 *   0  the command did what it said
 *   1  it did not
 *
 * There is no third code and no partial success. A backup job that exits 0
 * having half worked is the failure mode `verify` exists to catch, and it would
 * be perverse for the job itself to have it.
 *
 * ## Commands
 *
 *   database   dump, encrypt, upload, confirm, prune
 *   objects    mirror course media into the backup bucket
 *   verify     is there a recent database backup? — run this separately
 *
 * `verify` is deliberately not folded into `database`. A freshness check that
 * runs inside the job it checks can only ever report on a run that happened,
 * which is the one case that needed no checking.
 */

import { S3Presigner } from "../shared/s3-presigner.js";
import { runDatabaseBackup, runFreshnessCheck, runObjectMirror } from "./backup.js";
import { DEFAULT_RETENTION } from "./retention.js";
import { BackupStore } from "./store.js";

interface Env {
  readonly databaseUrl: string;
  readonly encryptionKey: Buffer;
  readonly prefix: string;
  readonly workDir: string;
  readonly maxAgeHours: number;
  readonly primary: S3Presigner;
  readonly primaryBucket: string;
  readonly backup: S3Presigner;
  readonly backupPrefix: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    // Named, so the operator fixes the right variable rather than reading a
    // stack trace about `undefined`.
    throw new Error(`${name} is not set`);
  }
  return value;
}

function readEnv(): Env {
  const key = Buffer.from(required("BACKUP_ENCRYPTION_KEY"), "base64");
  if (key.byteLength !== 32) {
    throw new Error(
      `BACKUP_ENCRYPTION_KEY must decode to 32 bytes, got ${key.byteLength}`,
    );
  }

  const primaryBucket = required("S3_BUCKET");
  const pathStyle = (process.env["S3_FORCE_PATH_STYLE"] ?? "yes") !== "no";
  const s3 = {
    endpoint: required("S3_ENDPOINT"),
    region: required("S3_REGION"),
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
    forcePathStyle: pathStyle,
  };

  return {
    // The superuser or another role that is not subject to RLS. See the header.
    databaseUrl: required("BACKUP_DATABASE_URL"),
    encryptionKey: key,
    prefix: process.env["BACKUP_PREFIX"] ?? "backups/",
    workDir: process.env["BACKUP_WORK_DIR"] ?? "/tmp",
    maxAgeHours: Number(process.env["BACKUP_MAX_AGE_HOURS"] ?? "26"),
    primary: new S3Presigner({ ...s3, bucket: primaryBucket }),
    primaryBucket,
    // Its own bucket, and ideally its own credentials with no delete on the
    // primary — see infra/deploy/README.md. A "backup" in the same bucket is a
    // copy of the thing that is going to be deleted.
    backup: new S3Presigner({
      ...s3,
      bucket: process.env["BACKUP_BUCKET"] ?? primaryBucket,
      ...(process.env["BACKUP_S3_ACCESS_KEY_ID"] === undefined
        ? {}
        : {
            accessKeyId: process.env["BACKUP_S3_ACCESS_KEY_ID"],
            secretAccessKey: required("BACKUP_S3_SECRET_ACCESS_KEY"),
          }),
    }),
    backupPrefix: process.env["BACKUP_OBJECT_PREFIX"] ?? "backups/objects/",
  };
}

async function main(): Promise<number> {
  const command = process.argv[2] ?? "";
  const env = readEnv();
  const now = new Date();
  const backupStore = new BackupStore(env.backup);

  switch (command) {
    case "database": {
      const report = await runDatabaseBackup({
        store: backupStore,
        prefix: env.prefix,
        databaseUrl: env.databaseUrl,
        encryptionKey: env.encryptionKey,
        workDir: env.workDir,
        retention: DEFAULT_RETENTION,
        now,
      });
      // One line of JSON: greppable, and the digest is what a restore is
      // checked against. No credential and no URL appears in it.
      log({ event: "backup.database", ...report });
      return 0;
    }

    case "objects": {
      const report = await runObjectMirror({
        source: new BackupStore(env.primary),
        destination: backupStore,
        sourceBucket: env.primaryBucket,
        destinationPrefix: env.backupPrefix,
        now,
      });
      log({ event: "backup.objects", ...report });
      // Copies that failed are reported and are still a failure. Exiting 0 with
      // a `failed` array nobody reads is how a gap goes unnoticed for months.
      return report.failed.length === 0 ? 0 : 1;
    }

    case "verify": {
      const { fresh, newest } = await runFreshnessCheck({
        store: backupStore,
        prefix: env.prefix,
        maxAgeHours: env.maxAgeHours,
        now,
      });
      log({ event: "backup.verify", fresh, newest, maxAgeHours: env.maxAgeHours });
      return fresh ? 0 : 1;
    }

    default:
      process.stderr.write("usage: backup <database|objects|verify>\n");
      return 1;
  }
}

function log(record: Record<string, unknown>): void {
  process.stdout.write(
    `${JSON.stringify({ at: new Date().toISOString(), ...record })}\n`,
  );
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    // The message only. An error from `fetch` can stringify to include the URL,
    // and a presigned URL in a log is a live capability written down.
    log({
      event: "backup.failed",
      reason: error instanceof Error ? error.message : "unknown error",
    });
    process.exit(1);
  });
