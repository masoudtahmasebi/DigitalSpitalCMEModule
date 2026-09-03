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
 *   list       what is in the bucket, newest first, with sizes
 *   restore    fetch one, decrypt it, and load it into RESTORE_DATABASE_URL
 *
 * `list` and `restore` were added in P182-01, and their absence was the gap
 * that mattered: the backup had been taken, encrypted, uploaded, pruned and
 * freshness-checked nightly since P23-03, and the only way to *use* one was to
 * read the integration test and reproduce it by hand. A procedure that exists
 * as a test file is not a procedure at 22:00 (§9.9a).
 *
 * `verify` is deliberately not folded into `database`. A freshness check that
 * runs inside the job it checks can only ever report on a run that happened,
 * which is the one case that needed no checking.
 */

import { S3Presigner } from "../shared/s3-presigner.js";
import {
  runDatabaseBackup,
  runFreshnessCheck,
  runObjectMirror,
  runRestore,
  sameDatabase,
} from "./backup.js";
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

    case "list": {
      /*
       * What is actually there, newest first (P182-01).
       *
       * The first thing anybody needs in an incident, and there was no way to
       * get it: the keys were visible only to whoever could reach the bucket
       * with an S3 client and the right credentials. An operator restoring at
       * 22:00 should not have to install one.
       *
       * Sizes come from a HEAD each, which is one request per object and fine
       * for a retention window of a few dozen. `verify` already answers "is
       * there a recent one" without any of this.
       */
      const keys = (await backupStore.list(env.prefix, now)).sort().reverse();

      for (const key of keys) {
        const bytes = await backupStore.size(key, now);
        log({ event: "backup.item", key, bytes: bytes ?? null });
      }

      log({ event: "backup.list", prefix: env.prefix, count: keys.length });
      // Zero backups is not an error here — `verify` is the check with an
      // opinion, and this command answers a question.
      return 0;
    }

    case "restore": {
      const key = process.argv[3] ?? "";
      if (key === "") {
        process.stderr.write(
          "usage: backup restore <key>\n\n" +
            "  The key is one of the lines `backup list` prints.\n" +
            "  RESTORE_DATABASE_URL says where it goes, and must not be the\n" +
            "  database BACKUP_DATABASE_URL names.\n",
        );
        return 1;
      }

      const target = required("RESTORE_DATABASE_URL");

      /*
       * The guard, and the reason `restore` takes its own variable rather than
       * a `--into` flag.
       *
       * A restore is the one operation in this CLI that **writes** to a
       * database, and the database this container already has a superuser URL
       * for is production. A flag would put the difference between "recover
       * into a scratch database" and "overwrite everything" one keystroke
       * apart, at the moment somebody is least able to afford it.
       *
       * So the destination is a separate variable that has to be set
       * deliberately, and pointing it at the source is refused. That refusal is
       * not the whole safety — `pg_restore` without `--clean` will fail on the
       * existing objects anyway — it is the one that gives a person a sentence
       * instead of a wall of constraint violations.
       *
       * Compared on the parsed connection, not the string: `postgres://…/ds`
       * and `postgres://…/ds?sslmode=require` are the same database.
       */
      if (sameDatabase(target, env.databaseUrl)) {
        process.stderr.write(
          "refusing to restore into the database being backed up.\n\n" +
            "  RESTORE_DATABASE_URL points at the same database as\n" +
            "  BACKUP_DATABASE_URL. Restore into a new database instead:\n\n" +
            "      createdb ds_restore_check\n" +
            "      RESTORE_DATABASE_URL=…/ds_restore_check backup restore <key>\n\n" +
            "  and promote it once you have looked at what came back.\n",
        );
        return 1;
      }

      const report = await runRestore({
        store: backupStore,
        key,
        encryptionKey: env.encryptionKey,
        targetDatabaseUrl: target,
        workDir: env.workDir,
        now,
      });

      // The warnings are printed, not swallowed. A restore across differing
      // roles is rarely silent, and an operator has to be able to tell an
      // ownership complaint from a missing table.
      for (const warning of report.warnings) {
        log({ event: "backup.restore.warning", message: warning });
      }
      log({
        event: "backup.restore",
        key: report.key,
        bytes: report.bytes,
        digest: report.digest,
        warnings: report.warnings.length,
      });
      return 0;
    }

    default:
      process.stderr.write(
        "usage: backup <database|objects|verify|list|restore <key>>\n",
      );
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
