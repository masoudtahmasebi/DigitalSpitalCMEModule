# Deployment

One Hetzner host, in Germany. Everything is a container, TLS is automatic, and
`deploy.sh` is the whole deployment.

```
infra/deploy/
  docker-compose.prod.yml   the stack
  Caddyfile                 TLS termination and routing
  deploy.sh                 the deployment, runnable by CI or by a human
  env.production.example    template for the PRODUCTION_ENV secret
```

---

## Setting this up for the first time

**[`docs/deployment.md`](../../docs/deployment.md) is the runbook** — the
server, DNS, the SSH key, the GitHub secrets and variables, the first deploy
and the first administrator, in order.

It is not repeated here. Two documents describing the same procedure drift, and
the one that drifts is always the one somebody is following at the time. This
file is the reference for what is _in this directory_ and what to do when a
deployment misbehaves.

---

## Deploying

Automatic: merge to `main`. The `Deploy` workflow waits for **CI to pass on
that same commit** — it triggers on `workflow_run`, not on `push`, so a red
build cannot reach production.

Manually, from a laptop with SSH access:

```bash
ssh deploy@host
cd ~/ds-education/infra/deploy
./deploy.sh
```

Same script, same steps. A deployment path only CI can execute is one nobody
can debug at 22:00.

### What it does, in order

1. **Preflight.** Refuses on a missing variable, a world-readable env file, or
   a live EIV endpoint without `EIV_ALLOW_LIVE=yes`. Nothing has changed yet.
2. **Pull.** A registry hiccup must not disturb the running site.
3. **Back up.** `pg_dump` to `/var/backups/ds-education`, before any migration.
   Fourteen kept.
4. **Ensure roles.** Re-applies `infra/postgres/init-roles.sql`, which is
   idempotent. Postgres runs `docker-entrypoint-initdb.d` **only on an empty
   data directory**, so a role introduced by a later commit would otherwise
   never exist on a database that is already running — and the migration that
   grants to it would fail. This step also applies `DS_APP_PASSWORD` and
   `DS_MIGRATOR_PASSWORD` from the env file; the passwords in the SQL are
   development values and are in the repository.
5. **Migrate**, as `ds_migrator` — never the superuser. `ALTER DEFAULT
PRIVILEGES FOR ROLE ds_migrator` only grants `ds_app` on objects
   _ds_migrator_ creates, so migrating as `postgres` leaves `ds_app` with no
   grants at all. That presents as "permission denied" rather than as RLS
   filtering, and looks like isolation working until you read the error.
6. **Start**, and wait for the API's health check.
7. **Verify** over public TLS. An internal health check passing while the
   certificate is broken is a deploy that looks green and serves nothing.

Any failure exits non-zero with the previous version still running.

### Checking the configuration without deploying

```bash
./deploy.sh --check
```

Runs the whole preflight and stops. Nothing is pulled, migrated or restarted —
for a freshly edited `.env.production`, when the alternative is finding out
halfway through.

### The first administrator, once

A freshly deployed platform has an empty `admin_users` table and no way into
the console: accounts are created by invitation, and there is nobody to issue
one. This closes that, exactly once:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml \
  run --rm --entrypoint node api dist/bootstrap-admin.js \
  --email technik@digitalspital.de --name "Technik"
```

It prints a generated password once and stores it nowhere; the row holds an
Argon2id hash. It refuses to run again while any staff account exists, because
a bootstrap that stayed available would be a second way to mint a super
administrator, reachable by anyone who can start a container here. `--force`
exists for a genuine lockout and records itself in `admin_audit_log`.

---

## Rolling back

```bash
./deploy.sh --rollback 1a2b3c4
```

or run the Deploy workflow manually with `rollback_tag` set. Every commit is
published as its own tag, so a rollback is a tag change, not a rebuild.

**Migrations are not rolled back, ever.** They are additive by convention, so
an older image keeps working against a newer schema — which is what makes a
rollback safe. If a migration ever genuinely has to be reverted, that is a
forward migration, written and reviewed like any other, not a flag on this
script.

---

## Backups

`pg_dump` before every migration, fourteen retained locally. **That is not a
backup strategy on its own** — it lives on the same disk as the database it
protects, so it survives a bad migration but not a lost host.

Before launch, either enable Hetzner's volume snapshots or ship these
off-host. This is deliberately called out rather than quietly assumed: the
database holds CME participation records, and reconstructing them is not
possible from anywhere else.

---

## What to check when something is wrong

```bash
cd ~/ds-education/infra/deploy
docker compose -f docker-compose.prod.yml --env-file .env.production ps
docker compose -f docker-compose.prod.yml --env-file .env.production logs -f api
docker compose -f docker-compose.prod.yml --env-file .env.production logs caddy | grep -i "certificate\|acme"
```

| Symptom                                        | Usually                                                                       |
| ---------------------------------------------- | ----------------------------------------------------------------------------- |
| Browser TLS warning                            | DNS does not point here yet, or `acme_ca` staging is still uncommented        |
| API healthy, site unreachable                  | Caddy could not get a certificate — check the ACME lines in its log           |
| Every request 401s                             | `KEYCLOAK_ISSUER` / `KEYCLOAK_AUDIENCE` do not match the realm                |
| Widget blocked in the browser                  | The WordPress origin is missing from `CORS_ALLOWED_ORIGINS`                   |
| Videos 403 after a while                       | `S3_URL_TTL_SEC` shorter than a lesson; presigned URLs expire                 |
| Submissions stuck queued                       | `EIV_ALLOW_LIVE` unset while `EIV_BASE_URL` points live — by design           |
| API cannot authenticate to PG                  | `DS_APP_PASSWORD` changed in the env file but the deploy was skipped          |
| Staff sign-in succeeds, then "session expired" | `STAFF_COOKIE_DOMAIN` missing or not a parent of both the console and the API |
| Console loads, every request fails             | `API_DOMAIN_URL` unset, so the CSP's `connect-src` is `'self'` only           |
| Console loads, requests are CORS-refused       | `https://verwaltung.…` missing from `CORS_ALLOWED_ORIGINS`                    |
| Portal has no certificate                      | `PORTAL_DOMAIN` unset, so Caddy has a site block with an empty address        |

---

## Erasing a data subject

GDPR Art. 17. The reasoning, and what "erasure" means for a CME record, is in
[`docs/gdpr.md`](../../docs/gdpr.md) — in short, the participation record is
retained under a legal obligation while every identifier is removed.

```bash
cd ~/ds-education/infra/deploy
set -a && . ./.env.production && set +a

# Dry run. Prints counts, never names. Changes nothing.
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm \
  -e MIGRATION_DATABASE_URL="postgres://ds_migrator:${DS_MIGRATOR_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  --entrypoint node api dist/subject-erasure.js \
  --subject "<keycloak-sub>" --reason "Antrag vom <date>"

# Then, once the printed plan is the right person, add --confirm.
```

It refuses while a Punktemeldung is still open — erasing the EFN mid-report
leaves one that can neither be completed nor corrected — and it is idempotent.
Afterwards the **customer** deletes the Keycloak account; their IdP is theirs.

Note the role: erasure runs as `ds_migrator`. `ds_app`, which every HTTP request
uses, cannot execute the function at all.
