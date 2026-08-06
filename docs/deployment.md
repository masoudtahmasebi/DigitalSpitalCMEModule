# Deploying to Hetzner

One host, in Germany, everything in containers, deployed by GitHub Actions on
every green build of `main`. This is the whole runbook: follow it top to bottom
once, and afterwards a deploy is `git push`.

It assumes the server is ordered and the DNS is pointed at it. Everything else
is here.

**This deployment:** `78.47.178.65`, `digitalspital.com`.

---

## 0. What you are building

| Host                            | Serves                                            | Container |
| ------------------------------- | ------------------------------------------------- | --------- |
| `api.digitalspital.com`         | the API — the only thing that decides a CME point | `api`     |
| `verwaltung.digitalspital.com`  | the admin console                                 | `admin`   |
| `fortbildung.digitalspital.com` | the standalone learner portal                     | `portal`  |
| `widget.digitalspital.com`      | `ds-lms.js` for the WordPress plugin              | `widget`  |

Behind them, reachable from nothing outside the host: PostgreSQL, Redis, and
Caddy terminating TLS.

The bare `digitalspital.com` is **not** one of these. It is free for a
promotional site; until there is one, `APEX_REDIRECT_URL` in the environment
file makes Caddy redirect it somewhere useful, and leaving that empty means the
bare domain has no site block at all.

### You configure one thing

`BASE_DOMAIN=digitalspital.com`. Everything above is derived from it, along with
the API origin the console's CSP names, the staff cookie's scope, the CORS
allow-list, the certificate email's link target, and what the two browser
bundles are told at container start — twelve values that all say the same
domain, written once.

`infra/deploy/domains.sh` does the derivation, `infra/deploy/domains.test.sh`
tests it, and the deploy refuses to proceed if the result is inconsistent. You
can still set any individual hostname explicitly and it wins; you should not
need to.

---

## 1. The server

**CX32 or larger** (4 vCPU, 8 GB) in **Falkenstein or Nuremberg**. Germany is
not a preference: the processing record in `docs/gdpr.md` says the data stays
in the EU, and a physician's participation record is what it is about.

Ubuntu 24.04. After first boot:

```bash
# As root, once.
apt-get update && apt-get -y upgrade
apt-get -y install docker.io docker-compose-v2 ca-certificates curl

# A user for deployments. Not root: the CI job holds this key, and a key that
# can `rm -rf /` is a key you have to think about every time you rotate it.
adduser --disabled-password --gecos "" deploy
usermod -aG docker deploy

# The backup directory deploy.sh writes to, before it needs to exist.
install -d -m 700 -o deploy -g deploy /var/backups/ds-education

# Only 22, 80 and 443. Postgres is not published by the compose file, and this
# is the second reason it is not reachable.
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable

# Unattended security updates. A host nobody logs into is a host nobody patches.
apt-get -y install unattended-upgrades
dpkg-reconfigure -f noninteractive unattended-upgrades
```

Then harden SSH — `/etc/ssh/sshd_config`:

```
PermitRootLogin no
PasswordAuthentication no
```

and `systemctl restart ssh`. Do this **after** you have confirmed you can log
in as `deploy` with your key, not before.

---

## 2. DNS

Already done for this deployment: an A record on the apex and a wildcard, both
to `78.47.178.65`.

| Type | Name | Value          |
| ---- | ---- | -------------- |
| A    | `@`  | `78.47.178.65` |
| A    | `*`  | `78.47.178.65` |

The wildcard covers all four service hostnames, so no per-service record is
needed. Add AAAA records too if you took the IPv6 — Hetzner always gives you
one, and a learner on a v6-only mobile network will otherwise not reach the
site at all.

**Every name must resolve before the first deploy.** Caddy proves control of
each over an HTTP-01 challenge on port 80; a name that does not resolve here
simply never gets a certificate. It does not take the others down, but that
subdomain serves nothing until it is fixed and Caddy restarts.

Check before continuing:

```bash
for h in api verwaltung fortbildung widget; do
  echo "$h → $(dig +short "$h.digitalspital.com")"
done
```

> **Let's Encrypt rate-limits duplicate certificates to five per week.** If you
> expect to iterate on DNS, uncomment `acme_ca` in `infra/deploy/Caddyfile`
> first to use the staging CA, and comment it out again when the names are
> settled. Burning the limit on a typo means waiting seven days.

### One thing the wildcard costs you

The staff session cookie is scoped to `.digitalspital.com`, because that is the
nearest common parent of the console and the API and the browser will only
attach it to both if it is (ADR-0012). So **every** host under
`digitalspital.com` — present and future, including a marketing site an agency
runs — receives that cookie on every request.

It is `httpOnly`, so no script can read it, and `Secure`, so it never crosses
plain HTTP. What a subdomain operator would see is the cookie in their access
logs, which is a session token in a place it has no business being.

Putting the platform under its own second-level name —
`BASE_DOMAIN=cme.digitalspital.com`, cookie scope `.cme.digitalspital.com` —
narrows that to the platform's own hosts. It needs a second wildcard,
`*.cme.digitalspital.com`, because a DNS wildcard matches exactly one label.
Nothing in the code changes: one line of the environment file.

Worth doing before anything else is hosted under the bare domain.

---

## 3. The SSH key

Generate a key **for this deployment only**, on your machine. Not your personal
key: this one lives in GitHub's secret store, and the blast radius of a key
should match the number of places it exists.

```bash
ssh-keygen -t ed25519 -C "github-actions@ds-education" -f ~/.ssh/ds-deploy -N ""

# Install the public half on the server.
ssh-copy-id -i ~/.ssh/ds-deploy.pub deploy@78.47.178.65

# Confirm it works and that the password path is closed.
ssh -i ~/.ssh/ds-deploy deploy@78.47.178.65 'docker version --format "{{.Server.Version}}"'
```

Then take the host's own key, which is what stops a deploy being
man-in-the-middled into handing over every credential the platform has:

```bash
ssh-keyscan -t ed25519 78.47.178.65
```

Keep both outputs — the **private** key file and the keyscan line. They go into
GitHub next.

---

## 4. GitHub secrets and variables

`Settings → Secrets and variables → Actions`.

### Secrets (encrypted, never shown again)

| Name                 | Value                                                         |
| -------------------- | ------------------------------------------------------------- |
| `DEPLOY_HOST`        | `78.47.178.65`                                                |
| `DEPLOY_USER`        | `deploy`                                                      |
| `DEPLOY_SSH_KEY`     | the whole of `~/.ssh/ds-deploy`, `BEGIN`/`END` lines included |
| `DEPLOY_KNOWN_HOSTS` | the `ssh-keyscan` output from §3                              |
| `PRODUCTION_ENV`     | the whole of `infra/deploy/env.production.example`, filled in |

`PRODUCTION_ENV` being one blob rather than twenty secrets is deliberate.
Twenty secrets drift from twenty variable names, and the failure is a container
that starts with an empty password.

### Variables (plain, visible)

| Name          | Value               |
| ------------- | ------------------- |
| `BASE_DOMAIN` | `digitalspital.com` |

One. It used to be eight, five of which were Vite build arguments inlined into
the frontend bundles — which made every image environment-specific and put the
API's URL in a _variable_ while the API's hostname lived in a line of a
_secret_, with nothing checking that the two agreed. When they disagreed, the
console loaded and every request failed CORS: a browser-side failure with no
server-side trace. The frontends now read `/config.js`, written when their
container starts from values derived out of `BASE_DOMAIN`.

This one exists only so the workflow can name the deployment before it has read
the secret. It has to match the `BASE_DOMAIN` inside `PRODUCTION_ENV`.

### Filling in `PRODUCTION_ENV`

Start from `infra/deploy/env.production.example`. For this deployment:

```
BASE_DOMAIN=digitalspital.com
PROJECT_SLUG=medice-adhs
ACME_EMAIL=technik@digitalspital.de
EXTRA_CORS_ORIGINS=https://www.medice.de
```

Then the four credentials, generated with real randomness:

```bash
openssl rand -base64 32   # POSTGRES_SUPERUSER_PASSWORD
openssl rand -base64 32   # DS_MIGRATOR_PASSWORD
openssl rand -base64 32   # DS_APP_PASSWORD
openssl rand -base64 32   # SECRETS_KMS_KEY  — must decode to exactly 32 bytes
```

And MEDICE's Keycloak realm, which is the customer's, not ours:

```
KEYCLOAK_ISSUER=https://<their-keycloak>/realms/<their-realm>
KEYCLOAK_AUDIENCE=ds-education-api
KEYCLOAK_JWKS_URI=https://<their-keycloak>/realms/<their-realm>/protocol/openid-connect/certs
PORTAL_KEYCLOAK_CLIENT_ID=ds-portal
```

The admin console uses **none** of those: staff sign in on the platform's own
identity plane (ADR-0012), so a Keycloak outage cannot lock out an administrator.

### What the preflight checks, so you do not have to

Everything a domain implies is derived and then asserted — in the workflow,
before a byte reaches the server, and again on the host:

- the staff cookie's scope is a parent of both the console and the API;
- the CORS list contains the console and the portal;
- the CSP's `connect-src` origin matches the API's hostname;
- no two services share a hostname;
- `SECRETS_KMS_KEY` decodes to exactly 32 bytes;
- the EIV endpoint is not the live one without `EIV_ALLOW_LIVE=yes`;
- the environment file on the host is mode 600.

Each of these was a value somebody used to type twice. They are checks now
because the failures are quiet: a wrong cookie scope means every staff sign-in
succeeds and is then reported as an expired session, with nothing in any log.

Finally, create a GitHub **environment** called `production`
(`Settings → Environments`). The deploy job targets it, so you can require a
manual approval there if you want one, and every deployment appears in the
repository's timeline.

---

## 5. The first deploy

Push to `main`, or run **Actions → Deploy → Run workflow**. In order, it:

1. **Preflight** — every secret present, `PRODUCTION_ENV` complete, the KMS key
   the right length, and the derived domains mutually consistent. Nothing has
   been touched at this point, and this is where most first deployments stop.
2. **Build** — four images, pushed to `ghcr.io`, tagged with the short SHA and
   `latest`. Built here, never on the host: a failed build on the target takes
   the site with it, and a rollback should be a tag change rather than a
   rebuild. None of the four carries a hostname, so the same image is
   deployable to any environment.
3. **Deploy** — copies `infra/deploy/` over, writes `.env.production` with mode
   600, and runs `deploy.sh`, which derives the domains, backs up the database,
   migrates as `ds_migrator`, starts the stack and waits for the API to report
   healthy.
4. **Smoke test** — `GET /health` from GitHub's runner, over public DNS and
   real TLS. The deploy script already checked it from the host; this checks
   that the internet agrees.

The first run takes about ten minutes, most of it building. Certificates arrive
within a minute of Caddy starting.

### Then create the first administrator (P14-01)

The console is empty and there is no way in: staff accounts are created by
invitation, invitations are issued by an account that may invite, and there is
no such account yet. One command closes that, once:

```bash
ssh -i ~/.ssh/ds-deploy deploy@78.47.178.65 \
  'cd ~/ds-education/infra/deploy && \
   docker compose --env-file .env.production -f docker-compose.prod.yml \
     run --rm --entrypoint node api dist/bootstrap-admin.js \
     --email technik@digitalspital.de --name "Technik"'
```

It prints a generated password **once** and stores it nowhere. Sign in at
`https://verwaltung.digitalspital.com` immediately; the first sign-in enrols the
second factor, which `super_admin` requires.

It refuses to run again while any staff account exists — after that the ordinary
invitation flow is the only way to add one. `--force` exists for a genuine
lockout and records itself in `admin_audit_log`.

### Then point the WordPress plugin at it

In `wp-admin → Einstellungen → DS Education`:

| Field                    | Value               |
| ------------------------ | ------------------- |
| Basis-Domain             | `digitalspital.com` |
| Projekt-Slug             | `medice-adhs`       |
| Standard-Fortbildung     | the course slug     |
| API-Basis-URL (optional) | leave empty         |

The API address is derived from the base domain by the same rule the server
uses, so the two cannot disagree by being typed twice. The optional field is
for a staging API on a hostname that follows no convention; filled in, it wins.

The plugin ships its own copy of `ds-lms.js`, so `widget.digitalspital.com` is
not on the critical path for MEDICE. It is there for a customer who would rather
load the bundle from a URL we control, so a fix reaches them without their
redeploying a plugin.

---

## 6. Afterwards

### Every deploy

Merge to `main`. CI runs; if it is green, Deploy runs. That is the whole loop.

### Moving a domain

Change `BASE_DOMAIN` in `PRODUCTION_ENV` (and the `BASE_DOMAIN` variable), point
the DNS, and redeploy. No image is rebuilt: the frontends read their
configuration at container start, so the running containers pick up the new
value on restart.

### Rolling back

**Actions → Deploy → Run workflow**, with `rollback_tag` set to a previous short
SHA. Migrations are **not** re-run — they are additive by convention, so an
older image works against a newer schema, and this script will never run one
backwards.

### Checking a configuration change before applying it

```bash
ssh deploy@78.47.178.65 'cd ~/ds-education/infra/deploy && ./deploy.sh --check'
```

Runs the whole preflight and stops. Nothing is pulled, migrated, restarted or
written — including the apex redirect block, which is generated only on a real
deploy.

### Backups

`deploy.sh` takes one before every migration, to `/var/backups/ds-education`,
keeping fourteen. That covers "a migration went wrong"; it does **not** cover
"the server is gone", because the backups are on the server.

**Before go-live, add off-host copies.** A CME participation record is the
counterpart of a report already filed with an Ärztekammer under somebody's
name — see `docs/gdpr.md` §5 for why deleting it is not an option and therefore
why losing it is not either. Hetzner's Storage Box over `rsync`, or their
snapshot facility, both work; either is a decision to make deliberately rather
than a default to inherit.

Restoring one:

```bash
gunzip -c /var/backups/ds-education/<timestamp>.sql.gz | \
  docker compose --env-file .env.production -f docker-compose.prod.yml \
    exec -T postgres psql -U postgres -d ds_education
```

### Watching it

```bash
cd ~/ds-education/infra/deploy
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f api
docker compose --env-file .env.production -f docker-compose.prod.yml ps

# What the browser bundles were told at container start.
curl -s https://verwaltung.digitalspital.com/config.js
curl -s https://fortbildung.digitalspital.com/config.js
```

That last pair is the fastest way to diagnose "the console loads but nothing
works": it shows exactly which API the running container is pointing at.

---

## 7. Before this is production, not just deployed

Deploying is not the same as being ready to report a physician's CME points.
These are open and tracked elsewhere; they are listed here because the deploy
succeeding will not tell you about any of them.

- **`EIV_BASE_URL` points at the mock.** Leave it there. The live endpoint
  additionally requires `EIV_ALLOW_LIVE=yes`, and `deploy.sh` refuses a live URL
  without it — a Punktemeldung cannot be withdrawn once the correction window
  closes. The questions blocking it are S11–S13 in `docs/show-stoppers.md`.
- **S21 — the EFN length.** The layout says eighteen digits; the platform
  validates fifteen. Unresolved, and it is the field the whole Punktemeldung is
  keyed on.
- **The cookie scope**, per §2. One line, and best changed before anything else
  is hosted under `digitalspital.com`.
- **Off-host backups**, per §6.
- **`ALERT_WEBHOOK_URL` is optional and should not be.** Every alert is logged
  at `error` regardless, but a log nobody reads on a Saturday is not an alert,
  and the Ärztekammer's reporting window is eight days.
- **A second administrator.** One account with a TOTP secret on one phone is a
  single point of failure with a physical form.
