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

## First-time host setup

Once, on a fresh Hetzner box. Debian 12 or Ubuntu 24.04.

```bash
# 1. Docker, from Docker's own repository — the distro package lags.
curl -fsSL https://get.docker.com | sh

# 2. A deploy user that is not root. It needs docker, and nothing else.
adduser --disabled-password --gecos "" deploy
usermod -aG docker deploy

# 3. The CI key. Generate the pair locally; only the public half goes here.
mkdir -p /home/deploy/.ssh && chmod 700 /home/deploy/.ssh
echo "<the public key>" >> /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /home/deploy/.ssh

# 4. Firewall. 80 and 443 for Caddy, 22 for deployment. Nothing else — in
#    particular not 5432: the database is on an internal Docker network and
#    publishing it "just for migrations" is how a database ends up on Shodan.
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable

# 5. Unattended security updates. A host nobody logs into still needs patching.
apt-get install -y unattended-upgrades && dpkg-reconfigure -plow unattended-upgrades
```

**DNS before the first deploy.** `API_DOMAIN`, `ADMIN_DOMAIN` and
`WIDGET_DOMAIN` each need an A (and ideally AAAA) record pointing at this host
**before** Caddy starts. Certificates are issued via an HTTP-01 challenge that
Caddy answers on port 80; a domain that does not resolve here never gets one.

Let's Encrypt rate-limits duplicate certificates to five per week, so while DNS
is still settling, uncomment `acme_ca` in the `Caddyfile` to use the staging CA.
Staging certificates are untrusted by browsers — that is expected, and it means
a typo costs nothing instead of a seven-day wait.

---

## GitHub configuration

**Secrets** (Settings → Secrets and variables → Actions):

| Secret               | What it is                                       |
| -------------------- | ------------------------------------------------ |
| `DEPLOY_HOST`        | Hostname or IP                                   |
| `DEPLOY_USER`        | `deploy`                                         |
| `DEPLOY_SSH_KEY`     | The **private** key matching `authorized_keys`   |
| `DEPLOY_KNOWN_HOSTS` | Output of `ssh-keyscan <host>`                   |
| `PRODUCTION_ENV`     | The whole of `env.production.example`, filled in |

`DEPLOY_KNOWN_HOSTS` is not optional and is not a formality. Without a pinned
host key the deploy would accept whatever answers on port 22 and hand it
`PRODUCTION_ENV` — every credential the platform has.

**Variables** (not secrets; these are public and are inlined into the admin
bundle at build time):

| Variable                   | Example                                        |
| -------------------------- | ---------------------------------------------- |
| `API_DOMAIN`               | `api.cme.example.de`                           |
| `ADMIN_API_BASE`           | `https://api.cme.example.de`                   |
| `ADMIN_PROJECT_SLUG`       | `medice-adhs`                                  |
| `ADMIN_KEYCLOAK_ISSUER`    | `https://login.example.de/realms/ds-education` |
| `ADMIN_KEYCLOAK_CLIENT_ID` | `ds-admin-console`                             |
| `ADMIN_REDIRECT_URI`       | `https://verwaltung.cme.example.de/`           |

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
4. **Migrate**, as `ds_migrator` — never the superuser. `ALTER DEFAULT
PRIVILEGES FOR ROLE ds_migrator` only grants `ds_app` on objects
   _ds_migrator_ creates, so migrating as `postgres` leaves `ds_app` with no
   grants at all. That presents as "permission denied" rather than as RLS
   filtering, and looks like isolation working until you read the error.
5. **Start**, and wait for the API's health check.
6. **Verify** over public TLS. An internal health check passing while the
   certificate is broken is a deploy that looks green and serves nothing.

Any failure exits non-zero with the previous version still running.

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

| Symptom                       | Usually                                                                |
| ----------------------------- | ---------------------------------------------------------------------- |
| Browser TLS warning           | DNS does not point here yet, or `acme_ca` staging is still uncommented |
| API healthy, site unreachable | Caddy could not get a certificate — check the ACME lines in its log    |
| Every request 401s            | `KEYCLOAK_ISSUER` / `KEYCLOAK_AUDIENCE` do not match the realm         |
| Widget blocked in the browser | The WordPress origin is missing from `CORS_ALLOWED_ORIGINS`            |
| Videos 403 after a while      | `S3_URL_TTL_SEC` shorter than a lesson; presigned URLs expire          |
| Submissions stuck queued      | `EIV_ALLOW_LIVE` unset while `EIV_BASE_URL` points live — by design    |
