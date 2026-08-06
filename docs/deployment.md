# Deploying to Hetzner

One host, in Germany, everything in containers, deployed by GitHub Actions on
every green build of `main`. This is the whole runbook: follow it top to bottom
once, and afterwards a deploy is `git push`.

It assumes you have already ordered the server. Everything else is here.

---

## 0. What you are building

| Host                         | Serves                                            | Container |
| ---------------------------- | ------------------------------------------------- | --------- |
| `api.cme.example.de`         | the API — the only thing that decides a CME point | `api`     |
| `verwaltung.cme.example.de`  | the admin console                                 | `admin`   |
| `fortbildung.cme.example.de` | the standalone learner portal                     | `portal`  |
| `widget.cme.example.de`      | `ds-lms.js` for the WordPress plugin              | `widget`  |

Behind them, reachable from nothing outside the host: PostgreSQL, Redis, and
Caddy terminating TLS. Substitute your real domain for `cme.example.de`
throughout — the names of the four subdomains are yours to choose, but the
**relationship** between them matters, and §4 says where.

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

Four A records, all pointing at the server's IPv4 address. Add AAAA records too
if you took the IPv6 — Hetzner always gives you one.

| Type | Name              | Value           |
| ---- | ----------------- | --------------- |
| A    | `api.cme`         | `<server IPv4>` |
| A    | `verwaltung.cme`  | `<server IPv4>` |
| A    | `fortbildung.cme` | `<server IPv4>` |
| A    | `widget.cme`      | `<server IPv4>` |

**All four must resolve before the first deploy.** Caddy proves control of each
name over an HTTP-01 challenge on port 80; a name that does not resolve here
simply never gets a certificate. It does not take the others down, but that
subdomain serves nothing until you fix it and restart Caddy.

Check from anywhere before continuing:

```bash
for h in api verwaltung fortbildung widget; do
  echo "$h → $(dig +short "$h.cme.example.de")"
done
```

> **Let's Encrypt rate-limits duplicate certificates to five per week.** If you
> expect to iterate on DNS, uncomment `acme_ca` in `infra/deploy/Caddyfile`
> first to use the staging CA, and comment it out again when the names are
> settled. Burning the limit on a typo means waiting seven days.

---

## 3. The SSH key

Generate a key **for this deployment only**, on your machine. Not your personal
key: this one lives in GitHub's secret store, and the blast radius of a key
should match the number of places it exists.

```bash
ssh-keygen -t ed25519 -C "github-actions@ds-education" -f ~/.ssh/ds-deploy -N ""

# Install the public half on the server.
ssh-copy-id -i ~/.ssh/ds-deploy.pub deploy@<server IPv4>

# Confirm it works and that the password path is closed.
ssh -i ~/.ssh/ds-deploy deploy@<server IPv4> 'docker version --format "{{.Server.Version}}"'
```

Then take the host's own key, which is what stops a deploy being
man-in-the-middled into handing over every credential the platform has:

```bash
ssh-keyscan -t ed25519 <server IPv4>
```

Keep both outputs — the **private** key file and the keyscan line. They go into
GitHub next.

---

## 4. GitHub secrets and variables

`Settings → Secrets and variables → Actions`.

### Secrets (encrypted, never shown again)

| Name                 | Value                                                         |
| -------------------- | ------------------------------------------------------------- |
| `DEPLOY_HOST`        | the server's IPv4 address, or a hostname that resolves to it  |
| `DEPLOY_USER`        | `deploy`                                                      |
| `DEPLOY_SSH_KEY`     | the whole of `~/.ssh/ds-deploy`, `BEGIN`/`END` lines included |
| `DEPLOY_KNOWN_HOSTS` | the `ssh-keyscan` output from §3                              |
| `PRODUCTION_ENV`     | the whole of `infra/deploy/env.production.example`, filled in |

`PRODUCTION_ENV` being one blob rather than twenty secrets is deliberate.
Twenty secrets drift from twenty variable names, and the failure is a container
that starts with an empty password.

**Generate the four credentials it needs with real randomness:**

```bash
openssl rand -base64 32   # POSTGRES_SUPERUSER_PASSWORD
openssl rand -base64 32   # DS_MIGRATOR_PASSWORD
openssl rand -base64 32   # DS_APP_PASSWORD
openssl rand -base64 32   # SECRETS_KMS_KEY  — must decode to exactly 32 bytes
```

### The three that are easy to get wrong

Everything else in the template is a domain or a knob. These three are
relationships, and the preflight checks all of them so you find out in eight
seconds rather than twenty minutes:

- **`STAFF_COOKIE_DOMAIN`** — the parent of both the console and the API, with a
  leading dot: `.cme.example.de`. It is what makes `verwaltung.…` and `api.…`
  same-site so the browser attaches the staff session cookie. Wrong, and every
  sign-in succeeds and is then reported as an expired session, with nothing in
  any log to say why. Empty is correct in development and wrong here.
- **`CORS_ALLOWED_ORIGINS`** — must contain `https://verwaltung.…` and
  `https://fortbildung.…` as well as the customer's WordPress origin. The API
  cannot tell which host a request came from, and that is the point (ADR-0007).
- **`API_DOMAIN_URL`** — lands inside a `connect-src`. Unset, the console loads
  and cannot reach the API, which looks exactly like the API being down.

### Variables (plain, visible)

| Name                        | Example                                        |
| --------------------------- | ---------------------------------------------- |
| `API_DOMAIN`                | `api.cme.example.de`                           |
| `ADMIN_API_BASE`            | `https://api.cme.example.de`                   |
| `ADMIN_PROJECT_SLUG`        | `medice-adhs`                                  |
| `PORTAL_API_BASE`           | `https://api.cme.example.de`                   |
| `PORTAL_PROJECT_SLUG`       | `medice-adhs`                                  |
| `PORTAL_KEYCLOAK_ISSUER`    | `https://login.example.de/realms/ds-education` |
| `PORTAL_KEYCLOAK_CLIENT_ID` | `ds-portal`                                    |
| `PORTAL_REDIRECT_URI`       | `https://fortbildung.cme.example.de/callback`  |

These are Vite build arguments, inlined into the frontend bundles, which is why
they are variables and not secrets — they are in the JavaScript a browser
downloads either way.

The **admin console has no Keycloak variables**. It authenticates on the
platform's own staff plane (ADR-0012); only the learner-facing portal uses a
realm.

Finally, create a GitHub **environment** called `production`
(`Settings → Environments`). The deploy job targets it, so you can require a
manual approval there if you want one, and every deployment appears in the
repository's timeline.

---

## 5. The first deploy

Push to `main`, or run **Actions → Deploy → Run workflow**. In order, it:

1. **Preflight** — checks every secret and variable is present, that
   `SECRETS_KMS_KEY` decodes to 32 bytes, and that `STAFF_COOKIE_DOMAIN` is
   shaped like a parent domain. Nothing has been touched at this point.
2. **Build** — four images, pushed to `ghcr.io`, tagged with the short SHA and
   `latest`. Built here, never on the host: a failed build on the target takes
   the site with it, and a rollback should be a tag change rather than a
   rebuild.
3. **Deploy** — copies `infra/deploy/` over, writes `.env.production` with mode
   600, and runs `deploy.sh`, which backs up the database, migrates as
   `ds_migrator`, starts the stack and waits for the API to report healthy.
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
ssh -i ~/.ssh/ds-deploy deploy@<server> \
  'cd ~/ds-education/infra/deploy && \
   docker compose --env-file .env.production -f docker-compose.prod.yml \
     run --rm --entrypoint node api dist/bootstrap-admin.js \
     --email technik@digitalspital.de --name "Technik"'
```

It prints a generated password **once** and stores it nowhere. Sign in at
`https://verwaltung.cme.example.de` immediately; the first sign-in enrols the
second factor, which `super_admin` requires.

It refuses to run again while any staff account exists — after that the ordinary
invitation flow is the only way to add one. `--force` exists for a genuine
lockout and records itself in `admin_audit_log`.

---

## 6. Afterwards

### Every deploy

Merge to `main`. CI runs; if it is green, Deploy runs. That is the whole loop.

### Rolling back

**Actions → Deploy → Run workflow**, with `rollback_tag` set to a previous short
SHA. Migrations are **not** re-run — they are additive by convention, so an
older image works against a newer schema, and this script will never run one
backwards.

### Checking a configuration change before applying it

```bash
ssh deploy@<server> 'cd ~/ds-education/infra/deploy && ./deploy.sh --check'
```

Runs the whole preflight and stops. Nothing is pulled, migrated or restarted.

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
```

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
- **Off-host backups**, per §6.
- **`ALERT_WEBHOOK_URL` is optional and should not be.** Every alert is logged
  at `error` regardless, but a log nobody reads on a Saturday is not an alert,
  and the Ärztekammer's reporting window is eight days.
- **A second administrator.** One account with a TOTP secret on one phone is a
  single point of failure with a physical form.
