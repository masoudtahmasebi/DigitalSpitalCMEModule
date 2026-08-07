# Runbook — backup and restore

What runs, what to check, and how to get the data back. Written to be usable by
somebody who did not build this, at three in the morning, possibly from a
different machine than usual.

Introduced by **P23-03**.

---

## 1. What runs, and when

| When            | What              | Fails how                                    |
| --------------- | ----------------- | -------------------------------------------- |
| 02:15 daily     | `backup database` | non-zero exit → `ds-backup.service` goes red |
| 02:15 daily     | `backup objects`  | same unit, after the database job            |
| 08:00 and 16:00 | `backup verify`   | non-zero exit when no backup is < 26 h old   |

Units are in `infra/deploy/backup.timer` — copy them into
`/etc/systemd/system/`, wire `OnFailure=` to whatever pages you, then
`systemctl enable --now ds-backup.timer ds-backup-verify.timer`.

**`verify` is the one that matters.** A timer that stopped firing three weeks
ago is indistinguishable from one that is working, right up until a restore.
Nothing inside the backup job can report a run that never happened, which is why
this is a second unit on a second schedule.

### Checking by hand

```bash
cd ~/ds-education/repo/infra/deploy

systemctl status ds-backup.service          # did last night work?
journalctl -u ds-backup.service --since -7d # one JSON line per run
./dsc run --rm backup verify                # exits 1 if there is no recent copy
```

Each run prints one line of JSON: the key, the byte count, the SHA-256, what
was pruned. No credential and no URL appears in it — a presigned URL in a log is
a live capability written down.

---

## 2. What is stored, and where

```
<backup bucket>/
  backups/database/2026-08-07T02-15-00Z.dump.enc    pg_dump -Fc, AES-256-GCM
  backups/objects/<customerId>/courses/<id>/…       server-side copies of media
```

The database file is: **12-byte nonce · ciphertext · 16-byte tag**.

Retention is 7 daily, then 4 weekly, then 6 monthly. An unrecognised name in the
prefix is never deleted — it is reported instead, because a name this code did
not write means somebody put something there by hand, and deleting it is the one
action that cannot be undone.

---

## 3. Restoring the database

### 3.1 Get the file

List what exists, then fetch one. Any S3 client with the backup bucket's
credentials will do — the Hetzner console, `s3cmd`, `rclone`. The file is
ciphertext, so getting it onto a laptop is not itself a disclosure.

```bash
# The names sort by the moment the backup was taken, so the last line is the
# newest copy — which is also what `backup verify` reports.
s3cmd ls s3://<backup-bucket>/backups/database/

BACKUP_FILE=2026-08-07T02-15-00Z.dump.enc
s3cmd get "s3://<backup-bucket>/backups/database/${BACKUP_FILE}"
```

The credentials are `BACKUP_S3_ACCESS_KEY_ID` / `BACKUP_S3_SECRET_ACCESS_KEY`
in `~/ds-education/secrets.env`, falling back to `S3_ACCESS_KEY_ID` when the
backup bucket is not separately configured.

### 3.2 Decrypt

**Not with `openssl enc`.** It refuses AES-GCM outright — _"AEAD ciphers not
supported"_ — and `-aes-256-gcm` on that command line looks entirely plausible
right up to the error. Use this instead; it needs nothing but a Node runtime,
and `backup.integration.test.ts` executes this exact snippet on every CI run so
it cannot drift from the code that wrote the file.

```bash
cat > decrypt.cjs <<'EOF'
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
EOF

# BACKUP_ENCRYPTION_KEY is base64 in secrets.env; this wants hex.
KEY_HEX=$(printf '%s' "$BACKUP_ENCRYPTION_KEY" | base64 -d | xxd -p -c 256)

node decrypt.cjs 2026-08-07T02-15-00Z.dump.enc restore.dump "$KEY_HEX"
```

If it throws `Unsupported state or unable to authenticate data`, **stop**. That
is the authentication tag refusing: either the key is wrong or the file has been
altered. It is not a reason to try harder — it is the reason GCM was chosen.
Take the previous backup.

A successful decrypt gives a file starting `PGDMP`:

```bash
head -c 5 restore.dump    # PGDMP
```

### 3.3 Restore

```bash
# Into a scratch database first, always. Restoring over a live database
# because "the backup is probably fine" is how a bad night becomes a bad week.
./dsc exec -T postgres createdb -U postgres ds_restore_check
./dsc exec -T postgres pg_restore --no-owner --no-privileges \
    --dbname ds_restore_check < restore.dump

# Does it hold what it should? Compare against the live database before you
# replace anything with it.
./dsc exec -T postgres psql -U postgres -d ds_restore_check -c \
  "SELECT (SELECT count(*) FROM customers)  AS customers,
          (SELECT count(*) FROM courses)    AS courses,
          (SELECT count(*) FROM enrolments) AS enrolments,
          (SELECT max(created_at) FROM enrolments) AS newest_enrolment"
```

`newest_enrolment` is the number that matters: it says how much has happened
since this copy was taken, which is what a restore is about to discard.

Only once that looks right, and only with the stack stopped:

```bash
./dsc down
./dsc up -d postgres
./dsc exec -T postgres dropdb -U postgres ds_education
./dsc exec -T postgres createdb -U postgres ds_education
./dsc exec -T postgres psql -U postgres -d ds_education \
    -f /docker-entrypoint-initdb.d/00-init-roles.sql
./dsc exec -T postgres pg_restore --no-owner --no-privileges \
    --dbname ds_education < restore.dump
./deploy.sh
```

`--no-owner --no-privileges` and then re-running `init-roles.sql` is deliberate:
the dump carries no grants, so the roles are recreated from the file that
defines them. That file is what makes `ds_app` **not** `BYPASSRLS`, and a
restore that quietly restored different grants would undo ADR-0002 without any
visible symptom.

### 3.4 Afterwards

- **Do not regenerate `SECRETS_KMS_KEY`.** The restored rows are encrypted with
  the old one. A new key does not rotate them; it makes them unreadable.
- Re-check `./dsc run --rm backup verify` — the restore does not create a
  backup, and the next scheduled one is up to 24 hours away.

---

## 4. Restoring a single object

Course media is mirrored key-for-key, so the copy of
`s3://<customerId>/courses/<id>/video-9f3b….mp4` is
`backups/objects/<customerId>/courses/<id>/video-9f3b….mp4` in the backup
bucket. Copy it back with any S3 client. Nothing in the database needs changing:
the row holds the key, and the key is the same.

---

## 5. Testing the restore, on purpose

**A backup that has never been restored is a hypothesis.** CI restores one on
every run of the integration suite — real `pg_dump`, real encryption, real
decrypt with the snippet above, real `pg_restore`, and then it looks for a row.

That covers the mechanism. It does not cover _this_ deployment's key, bucket and
credentials, so do §3 by hand into a scratch database:

- before go-live;
- after any change to `secrets.env`;
- and once a quarter, so the first time somebody runs it is not during an
  incident.

Write the date somewhere. "We think it works" and "we restored it in March" are
different states.

---

## 6. What this does not protect against

Named because an unstated limit is one somebody discovers at the wrong moment.

- **A wrong write nobody notices for months.** Retention keeps six monthly
  copies; past that the only record is the audit log.
- **Losing `BACKUP_ENCRYPTION_KEY`.** Every backup becomes noise. It belongs in
  the password manager, in a different entry from `SECRETS_KMS_KEY` — the two
  in one entry is one compromise away from both.
- **The primary and backup buckets sharing credentials.** If `BACKUP_BUCKET` is
  unset, backups land in the primary bucket and a stolen key deletes both. Set
  it, with its own credentials, before go-live.
- **Point-in-time recovery.** There is none: the granularity is the nightly
  dump, so up to 24 hours of participation records can be lost. WAL archiving
  would fix that and is not built. If the client needs a tighter RPO, that is a
  decision with a cost, and it is theirs to make — see `docs/show-stoppers.md`.
