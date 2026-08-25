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

The bare `digitalspital.com` and `www.` are **not** in that table, and by
default they **redirect to the portal**. They have to do something: the DNS
wildcard points them at this host, so a name with no Caddy site block is a name
Caddy has no certificate for — and a browser reports that as
`ERR_SSL_PROTOCOL_ERROR`, not as a missing page. It is free for a promotional
site whenever there is one; set `APEX_REDIRECT_URL` to that site, or to `none`
to serve nothing from it — and if you choose `none`, point its DNS away from
this host first, or you are back to the TLS error.

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

Ubuntu 24.04 or 26.04. After first boot:

```bash
# As root, once.
apt-get update && apt-get -y upgrade

# `docker-buildx` is not optional here: the host builds the images, and without
# buildx compose falls back to the legacy builder, which cannot share the one
# `deps` stage between the four targets. That is the difference between a
# three-minute deploy and a twelve-minute one.
apt-get -y install docker.io docker-compose-v2 docker-buildx ca-certificates curl

# A user for deployments. Not root: the CI job holds this key, and a key that
# can `rm -rf /` is a key you have to think about every time you rotate it.
adduser --disabled-password --gecos "" deploy
usermod -aG docker deploy

# The backup directory deploy.sh writes to, before it needs to exist.
install -d -m 700 -o deploy -g deploy /var/backups/ds-education

# git, to fetch the repository the deploy runs from, and openssl, to generate
# the credentials it owns.
apt-get -y install git openssl

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

### Then, as `deploy`: the clone

```bash
mkdir -p ~/Repositories && cd ~/Repositories
git clone git@github.com:masoudtahmasebi/DigitalSpitalCMEModule.git
```

`~/ds-education/` — the configuration, the generated credentials, the Caddy
blocks the deploy writes — is created by `deploy.sh` on its first run. It is
deliberately outside the clone, so a `git checkout` can never touch a
credential.

The clone needs a read-only deploy key on the repository (`Settings → Deploy
keys`) or the account's own key — whichever, `git fetch` must work
non-interactively as `deploy`, because that is what a deployment does.

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

## 3a. Reaching the host from CI once a firewall is in front of it

Added 25.08, after a firewall was put on the server and the deploy stopped at
`ssh: connect to host … port 22: Connection timed out`. Nothing was deployed —
the workflow fails before it checks anything out — but a deploy pipeline that
cannot reach the host is not a deploy pipeline.

### The move to not make

GitHub publishes its runner addresses at `https://api.github.com/meta` under
`actions`, and allow-listing them is the obvious idea. Three reasons not to:

- **It is thousands of CIDR blocks**, not a handful. Hetzner Cloud Firewalls cap
  the rules per firewall far below that, so it may not physically fit.
- **It changes.** The allow-list rots, and the symptom arrives weeks later as a
  deploy that times out for no reason anyone remembers.
- **It is not a boundary.** Those are shared Azure ranges. "Allow GitHub" means
  "allow anybody who can start a VM in Azure" — the whole maintenance cost, and
  almost none of the isolation you wanted when you added the firewall.

### Option A — a private network between the runner and the host (recommended)

The runner joins a tailnet and reaches the host over it. **Port 22 stays closed
to the internet.**

This is recommended because it changes the least. The SSH design here was never
the weak part — it pins the host key rather than trusting on first use, and
nothing from the runner is copied to the server. Only the _path_ broke, so only
the path is replaced.

On the host:

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --ssh=false --hostname=ds-education
```

In the tailnet's ACLs, give CI a tag that may reach this host **and nothing
else** — a deploy runner has no business anywhere but this machine.

In the repository, add two secrets from a Tailscale OAuth client:

| Secret               |                                                   |
| -------------------- | ------------------------------------------------- |
| `TS_OAUTH_CLIENT_ID` | its presence is what switches the private path on |
| `TS_OAUTH_SECRET`    |                                                   |

Then repoint `DEPLOY_HOST` at the tailnet name (`ds-education`, or the full
MagicDNS name) and close 22 in the Hetzner firewall.

The workflow step is **conditional on `TS_OAUTH_CLIENT_ID`**: with no secret it
is skipped and the deploy behaves exactly as before. There is no flag day — set
the secrets when ready, and the next run takes the new path.

> Check the action's current major tag before relying on it
> (`tailscale/github-action`). The version pinned in the workflow was written
> from memory and has not been executed here.

### Option B — a self-hosted runner on the host

Removes SSH from the deploy entirely: the runner polls GitHub **outbound**,
picks the job up automatically, and runs `deploy.sh` locally. Automatic CI/CD is
unaffected — same triggers, same workflow — and `DEPLOY_SSH_KEY`,
`DEPLOY_KNOWN_HOSTS` and the SSH steps all disappear.

It fits ADR-0013, where the host already builds its own images from its own
checkout. The reason it is second rather than first: it puts a long-lived agent
on the production machine that executes workflow code, so anyone who can trigger
the workflow can run commands there. The current SSH user has a full shell, so
the delta is smaller than it sounds — but it is a persistent agent rather than a
key used for one command, and it wants `--ephemeral`, an unprivileged user and a
protected `production` environment with required reviewers.

### Option C — keep 22 open, harden it

What was in place before the firewall, and a normal posture: key-only
authentication, no root login, fail2ban. Fine on its own terms; listed so the
choice is deliberate rather than a reversal by default.

### Doing a deploy by hand meanwhile

Nothing above is needed to deploy. The workflow only does three things, and they
can be run from any machine that can reach the host:

```bash
ssh <user>@<host>
cd ~/Repositories/DigitalSpitalCMEModule
git fetch origin && git checkout --force <sha>
git status --porcelain          # must print nothing
cd infra/deploy && ./deploy.sh
```

Then, from anywhere, check what the internet sees:

```bash
curl -sS https://<api-domain>/health
curl -sS -o /dev/null -w '%{http_code}\n' https://<api-domain>/metrics   # expect 404
```

## 4. Configuration

Two files on the server, and four secrets in GitHub. Nothing that unlocks the
platform is in GitHub.

### On the server: `~/ds-education/config.env`

The answers no default can be right about. Written once, never touched by a
deploy.

Run the deploy once and it creates the file from the template, then stops:

```bash
cd ~/Repositories/DigitalSpitalCMEModule/infra/deploy
./deploy.sh                       # creates ~/ds-education/config.env, then stops
nano ~/ds-education/config.env
```

The platform-level lines — nothing here names a customer:

```
BASE_DOMAIN=digitalspital.com
ACME_EMAIL=technik@digitalspital.de
```

Then the per-surface block, which does. It is separate, and labelled, because
these are properties of a _browser app that must know them before it has spoken
to any API_ — not of the installation:

```
PORTAL_PROJECT_SLUG=medice-adhs
PORTAL_KEYCLOAK_ISSUER=https://<their-keycloak>/realms/<their-realm>
PORTAL_KEYCLOAK_CLIENT_ID=ds-portal
ADMIN_DEFAULT_PROJECT_SLUG=medice-adhs
EXTRA_CORS_ORIGINS=https://www.medice.de
```

**The API has no Keycloak configuration at all.** It validates each learner's
token against the issuer on the **project row** (`projects.keycloak_issuer`),
read per request — which is what lets one installation serve several customers
with separate realms, and what makes the console immune to a customer's Keycloak
being down (ADR-0012). Three deployment-wide Keycloak variables used to exist
here and were read by nothing; they are gone (P17-02).

The portal keeps an issuer because a browser app has to know where to send a
learner before it has spoken to any API. It must name the same realm as
`PORTAL_PROJECT_SLUG` — `deploy.sh` warns when they disagree, which is otherwise
a learner signing in successfully and then having every request refused.

`ADMIN_DEFAULT_PROJECT_SLUG` is a _default_, not an identity: a super
administrator spans customers and their first screen is the customer registry,
which sends no project header at all. `EXTRA_CORS_ORIGINS` is the union across
every customer on the installation, which is wider than any one of them needs.
Both are tracked as P18-03 and P18-04 — the console should let an operator pick
the project, and CORS should be per project. The obstacle for CORS is not
storage: a preflight `OPTIONS` carries no custom header, so the API cannot know
which project is being asked about at the moment it must answer.

### On the server: `~/ds-education/secrets.env`

You do not write this one. On the next run, `deploy.sh` generates:

| Variable                      | What it protects                              |
| ----------------------------- | --------------------------------------------- |
| `POSTGRES_SUPERUSER_PASSWORD` | the database's superuser                      |
| `DS_MIGRATOR_PASSWORD`        | the role that owns the schema                 |
| `DS_APP_PASSWORD`             | the role the API connects as                  |
| `SECRETS_KMS_KEY`             | the VNR password and SMTP credentials at rest |

Each is `openssl rand -base64 32`, written mode 600, and **generated only if
absent**. Nobody reads them, nobody types them, and no decision is encoded in 32
random bytes — so no human ever needs to see one.

> **`secrets.env` is part of the backup.** A database dump without the KMS key
> restores rows whose encrypted columns can never be read again. There is no
> plaintext fallback; that is the design. §6 says where the copies go.

### In GitHub: four secrets

`Settings → Secrets and variables → Actions`.

| Name                 | Value                                                         |
| -------------------- | ------------------------------------------------------------- |
| `DEPLOY_HOST`        | `78.47.178.65`                                                |
| `DEPLOY_USER`        | `deploy`                                                      |
| `DEPLOY_SSH_KEY`     | the whole of `~/.ssh/ds-deploy`, `BEGIN`/`END` lines included |
| `DEPLOY_KNOWN_HOSTS` | the `ssh-keyscan` output from §3                              |

And optionally one _variable_, `DEPLOY_REPO_DIR`, if the clone is not at
`~/Repositories/DigitalSpitalCMEModule`.

One optional secret, `SEED_TEST_STAFF_PASSWORD`, belongs with them (P68-03). It
is the password of the DS Test tenant's operator — the account the post-deploy
journey signs in as — and it has to be the **same value the host seeded with**.
Set it in neither place and both use the seed's own self-describing default,
which is fine: that tenant holds no accreditation, no CME points and no real
participant. Set it on the host and not here, and the journey job cannot sign in.

That is the whole list. `PRODUCTION_ENV` — the entire production environment,
database passwords and encryption key included — used to be a repository secret
this workflow wrote to the host on every deploy. It made GitHub a credential
store for the database, put the configuration a browser tab away from the thing
it configures, and rotated nothing. The server owns both halves now (P17-01).

### What the preflight checks, so you do not have to

`deploy.sh --check` runs on the host before anything is built, and asserts:

- every hostname a domain implies, and that they are mutually consistent — the
  staff cookie's scope is a parent of the console and the API, the CORS list
  contains both, the CSP origin matches the API's hostname, no two services
  share a name;
- `SECRETS_KMS_KEY` decodes to exactly 32 bytes;
- the EIV endpoint is not the live one without `EIV_ALLOW_LIVE=yes`;
- `config.env` is mode 600.

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

1. **Preflight** — SSHes in and runs `./deploy.sh --check` on the host: the
   generated credentials, the derived domains and their mutual consistency,
   against the configuration that is actually there. Nothing has been touched at
   this point, and this is where most first deployments stop. It then asks the
   host what it believes its own API hostname is, rather than rebuilding the
   derivation from a copy of the configuration the workflow no longer holds.
2. **Deploy** — `git fetch && git checkout <sha>` in the host's clone, then
   `deploy.sh`. The script generates any missing credential, derives the
   domains, **builds the four images**, backs up the database, migrates as
   `ds_migrator`, starts the stack and waits for the API to report healthy.
3. **Smoke test** — `GET /health` from GitHub's runner, over public DNS and
   real TLS. The deploy script already checked it from the host; this checks
   that the internet agrees.

There is no registry. The host builds from its own checkout and tags each image
with the commit, so `docker images` is a deployment history and a rollback is an
image already on the disk (ADR-0013). A failed build cannot take the site down:
nothing is swapped until the build has succeeded.

The first build takes ten to fifteen minutes; later ones are two to four,
because all four images share one `deps` layer and Docker caches it. The
workspace is installed **once** however many images change — provided
`docker-buildx` is installed. Without it, compose warns and quietly falls back
to the legacy builder, which rebuilds `deps` per target; `deploy.sh` says so
rather than letting the warning scroll past.

The commit is checked out **detached at an exact SHA**, not pulled to a branch
tip: `main` may have moved in the twenty minutes since CI went green, and a
deploy of a commit nothing tested is the thing this whole workflow exists to
prevent. `git rev-parse HEAD` on the server answers "what is running?" without
trusting the workflow's memory of it.

Certificates arrive within a minute of Caddy starting.

### If the deploy never runs

The automatic trigger is `workflow_run` on **CI passing on `main`**. Work on a
feature branch never deploys, however green it is — that is the gate, not a
fault. Until something is merged to `main`, use **Actions → Deploy → Run
workflow** and pick the branch; that deploys that branch's head.

### Then create the first administrator (P14-01)

The console is empty and there is no way in: staff accounts are created by
invitation, invitations are issued by an account that may invite, and there is
no such account yet. One command closes that, once:

```bash
ssh -i ~/.ssh/ds-deploy deploy@78.47.178.65 \
  'cd ~/Repositories/DigitalSpitalCMEModule/infra/deploy && \
   ./dsc run --rm --entrypoint node api dist/bootstrap-admin.js \
     --email technik@digitalspital.de --name "Technik"'
```

It prints a generated password **once** and stores it nowhere. Sign in at
`https://verwaltung.digitalspital.com` immediately; the first sign-in enrols the
second factor, which `super_admin` requires by default (P22-02 makes that a
policy — see §"Turning the second factor on, off, or mandatory" below).

### The tenant it already has: DSCustomer (P26-01)

A fresh installation is **not** empty any more. After migrations, `deploy.sh`
runs one seed:

```
==> Ensuring the default customer exists
```

It creates `DSCustomer` → `DSOrganisation` → `DSProject` → a course with one
module `DSModule`, five chapters, a Lernerfolgskontrolle and an evaluation. The
prose is lorem ipsum, obviously so. It exists because the alternative was what a
first install used to be: a console with no customer, no department, no project
and no course, four things to create in the right order, and no example of a
filled-in one to copy from.

**A deploy that writes rows is a deploy that can write the wrong ones**, so this
is narrow on purpose, in three ways:

| Property                                     | Why                                                                                                                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runs with `--if-missing`                     | It reads one row and returns before writing anything once `DSCustomer` exists. The second deploy and the two-hundredth write nothing — a redeploy is a no-op. |
| No VNR, no accreditation body, no CME points | A course with points is a course the EIV worker tries to report. Nothing this seeds can reach a third party.                                                  |
| Prints no password                           | This runs from a GitHub Actions job, so stdout is a workflow log.                                                                                             |

The demo participant `demo@dscustomer.example` therefore exists with a password
nobody holds. Set one for it under **Teilnehmende** in the console — the same
path a real physician's credential arrives by — or run the seed by hand, which
prints it:

```bash
./dsc seed default
```

Without `--if-missing` that **rebuilds the course's content tree**, which deletes
learner progress on that one course. Fine on a fresh install, not something to
run on a tenant anybody has used.

Switch the whole thing off with `SEED_DEFAULT_CUSTOMER=no` in `config.env` — for
an installation whose only tenant is a customer's real content, where a
Lorem-ipsum course in the project picker is noise.

Everything else is still created through the console's own screens, which is
what they are for. The console picks its project from what the operator can
actually reach (P22-03), so there is no slug in deploy config that has to name a
tenant that may not exist yet.

The other two seeds are **not** on the deploy path, because both rebuild their
content unconditionally:

```bash
./dsc seed ds        # the ds test tenant, two demo courses
./dsc seed medice    # MEDICE's real ADHS course
```

`./dsc seed` and not `./dsc run --entrypoint node api dist/seed-….js`: a seed
connects as `ds_migrator`, and that connection string is built from two files
`dsc` sources and your shell does not. The longer form was in this guide for
three releases and never worked — it refused with `MIGRATION_DATABASE_URL is not
set` before opening a connection.

### Two refusals you may meet, and what they mean (P43)

**`this database is N migration(s) behind the image`.** Only `deploy.sh` runs
migrations, and the seeds are separate entrypoints in the same image — so a
clone that has been pulled since the last successful deploy carries seed code
newer than the schema it is writing to. Migrate first; `./deploy.sh` does it
after taking a backup, which is the supported path.

Before this check existed, that situation failed as a constraint name instead —
`violates check constraint "projects_identity_provider_check"` — which is a true
sentence about a database eleven versions old and reads as a broken seed.

**`No ds-education/api image on this host`.** `./dsc` deliberately does not
build: there is no registry (ADR-0013), images are built by `./deploy.sh`, and a
wrapper that quietly spent forty seconds compiling would produce a container
from whatever commit the clone happens to be on rather than the one serving
traffic. Where an older image _is_ present it uses that and says so:

```
note: this clone is at ebab45b, but the API image on this host is
      old9999 — using that one, because it is what is running.
```

Which is the right image for a seed: it writes rows the running API reads.

A seed also **adopts a customer that already holds its slug** rather than
failing on the unique index, so creating the tenant in the console first and
seeding afterwards is a supported order.

It refuses to run again while an **active super administrator** exists — after
that the ordinary invitation flow is the only way to add one. `--force` exists
for a genuine lockout and records itself in `admin_audit_log`.

The condition used to be "any staff account", which was wrong in a way that only
appeared once the seeds started creating operators (P38-03): `canGrant` refuses
a grant broader than the actor's own, so an installation holding only a
`customer_admin` has no path to a super administrator at all — and the one
command that could create one refused because that account existed. Order still
does not matter now: seed first or bootstrap first, both work.

### The DS Test tenant, which the deploy seeds for you (P68-01)

Separate from `ds` below, and not optional: `dstest` is the tenant the
post-deploy journey **writes into**. `deploy.sh` seeds it alongside the others,
so there is nothing to run by hand.

It holds a customer, a department, a portal project at `/dstest` and one
`customer_admin`, `e2e@dstest.example`. **No course** — building one is what the
journey is for. Its data accumulates on purpose: every run leaves the course, the
participant and the certificate it created, each named with a fresh suffix, so a
failed run is still there to look at. Nothing in it is visible to any other
customer, and nothing it seeds carries accreditation or CME points.

```bash
ssh -i ~/.ssh/ds-deploy deploy@78.47.178.65
cd ~/ds-education && ./dsc seed ds-test        # prints the operator's sign-in
```

### Optionally, the DS test tenant (P20-01)

A second customer — `ds`, DigitalSpital's own — with two demo courses. It exists
so that the console's customer registry, the project picker and every screen
that spans customers have something to be wrong about, and so a `customer_admin`
scoped to one customer can be shown **not** seeing the other on the real
installation rather than only in a test.

```bash
ssh -i ~/.ssh/ds-deploy deploy@78.47.178.65
cd ~/Repositories/DigitalSpitalCMEModule/infra/deploy
./dsc seed ds
```

Since P38-01 it also creates the tenant's **two console operators**, one per
customer role, and prints their passwords once:

| Account                 | Role             | May                                                    |
| ----------------------- | ---------------- | ------------------------------------------------------ |
| `verwaltung@ds.example` | `customer_admin` | departments, projects, courses, participants, branding |
| `redaktion@ds.example`  | `course_editor`  | courses and their content — nothing above a course     |

Both are on a reserved domain (RFC 2606), so neither can receive mail, and both
are mock data — `docs/mock-data.md` lists what replaces them. Set
`SEED_STAFF_PASSWORD` to choose the password instead of having one generated;
note that doing so gives **both** accounts the same one, which is fine for a
demo installation being handed round and wrong for anything else.

Neither holds a second factor, and what happens on their first sign-in is
decided by the **customer's** policy, not the platform's — that default is
`optional`, so they sign straight in. Raise it for this customer under
**Sicherheit** to send them to enrolment.

It rebuilds its two courses' content trees, which deletes learner progress **on
those two courses**. It touches nothing belonging to any other customer — the
whole run is inside `app.customer_id = <ds>` and passes the same RLS policies a
request does.

No `--force` here, and none in the two commands above: `openSeedPool` refuses a
database that is not obviously a development one, and on the compose network the
host is literally `postgres`, which it counts as local. The flag exists for a
seed run from a laptop against something remote. This guide used to say it was
required — typing it out of habit is how that guard stops meaning anything.

What it creates:

| Course           | Points | VNR   | Quiz | Why it is there                             |
| ---------------- | ------ | ----- | ---- | ------------------------------------------- |
| `ds-cme-demo`    | 3      | dummy | yes  | the full path, to a Punktemeldung and a PDF |
| `ds-ohne-punkte` | none   | none  | no   | a course without CME points, which is real  |

The VNR is a documented dummy and the Ärztekammer is fictional. Nothing here
can reach the live EIV endpoint: `deploy.sh` refuses an `EIV_BASE_URL` pointing
at eiv-fobi.de unless `EIV_ALLOW_LIVE=yes` is set deliberately (ADR-0005).

No staff account comes with it. Create one through the ordinary invitation flow
and scope it to this customer — a `customer_admin` on `ds` who can see MEDICE is
the bug this tenant exists to make visible.

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

Merge to `main`. CI runs; if it is green, Deploy runs, and then the **journey**
job drives the deployment in a browser. That is the whole loop.

### The journey job — what a green deploy now means (P68-03)

`/health` answering was never evidence that a physician can earn a CME point.
Every defect reported from production on 12.08 was downstream of a healthy API:
a CSP header that blocked every video upload, a cookie collision that refused
every enrolment, a tenant whose seed had never run.

So after `deploy.sh` succeeds, a separate job checks out the repository on a
GitHub runner, installs Chromium, and runs `pnpm test:smoke` against the real
hostnames — which it takes from the host's own `ds_derive_domains`, so the test
cannot disagree with the server about where the server is. It signs in to
Verwaltung as the DS Test operator, builds a Fortbildung with a real video
upload, publishes it, and then completes it as a physician and downloads the
Teilnahmebescheinigung.

Three things to know when it fails:

- **It fails the workflow run, and that is intended.** A deploy that cannot
  enrol a learner is not a successful deploy. The previous images are still on
  disk — see _Rolling back_ below.
- **It names the build it was looking at.** The run records the commit behind
  `/metrics` before it asserts anything, so "the fix is not deployed" and "the
  fix does not work" are different reports (§9.9).
- **The trace is kept.** The failed run uploads `apps/e2e/test-results/` as an
  artifact; `pnpm exec playwright show-trace trace.zip` replays the browser step
  by step, with a screenshot at the moment it stopped.

It leaves data behind on purpose. Every run creates a course and a participant
in the `dstest` tenant, each named with a fresh suffix, so an old run's course
is still there to look at when something goes wrong. Nothing it creates is
visible to MEDICE or to any other customer.

**It refuses to run when `EIV_ALLOW_LIVE` is set**, and says why. The journey
publishes an accredited Fortbildung — a Teilnahmebescheinigung requires CME
points and a VNR — and its VNR is a reserved number belonging to no
Veranstaltung. On an installation reporting live, that would be one refused
Punktemeldung per deploy, each an alert somebody has to dismiss. If the smoke
ever has to run on a live-reporting installation, `docs/backlog/P68.md` records
what to build first.

### When `config.env` falls behind the template

Variables get renamed. `deploy.sh` never rewrites `config.env` — it holds
decisions — so it says which **required** keys the template has that your file
does not, and prints the `diff -u` to run. Optional keys are not listed: they
are absent because somebody chose to leave them out.

### Keeping the base images patched — monthly, by hand

This is the one maintenance job nothing in CI can do for you, and it is easy to
miss because the symptom is silence.

`deploy.sh` builds with `--pull`, so **every deploy takes the current
`node:22-bookworm-slim`, `nginx:1.27-alpine`, `postgres:16-alpine` and
`caddy:2-alpine`** — patches for the OS packages inside those images arrive
free with any deploy. The catch is the word "deploy": an installation that is
serving happily and receiving no code changes keeps whatever base image it was
built from, indefinitely. Six quiet weeks is six weeks of an unpatched libc.

So once a month, on a commit that has not changed:

```bash
ssh deploy@78.47.178.65
cd ~/Repositories/DigitalSpitalCMEModule/infra/deploy
./deploy.sh          # same commit, fresh bases, ~3 min with buildx
```

Nothing else moves: the images are rebuilt from the same source at the same
`DS_COMMIT`, the migrations are a no-op, and the containers are replaced. If
anything does break, `--rollback` to the previous tag is still there.

Not automated, deliberately. A scheduled unattended production restart is a
scheduled unattended production outage — it wants somebody watching, and it
takes three minutes.

The three moving parts around it _are_ automated, and are not a substitute for
this one:

| What                                           | Who does it                 |
| ---------------------------------------------- | --------------------------- |
| npm dependencies, base image **tags**, actions | Dependabot, weekly PRs      |
| `pnpm audit --prod` against a quiet repo       | CI's Monday scheduled run   |
| OS packages on the **host** itself             | `unattended-upgrades` (§1)  |
| OS packages **inside** the containers          | **this** — a monthly deploy |

### Changing the configuration

Edit `~/ds-education/config.env` on the server and redeploy — from GitHub, or
directly:

```bash
ssh deploy@78.47.178.65
cd ~/Repositories/DigitalSpitalCMEModule/infra/deploy
./deploy.sh --check     # confirm it is still consistent
./deploy.sh             # apply it
```

For a configuration change nothing needs rebuilding at all — add `--no-build`
and it restarts against the images already there. Moving a domain is the same:
change `BASE_DOMAIN`, point the DNS, `./deploy.sh --no-build`. The frontends
read their configuration at container start, so the containers pick up the new
value on restart rather than needing a new image.

### Looking at the running stack

```bash
cd ~/Repositories/DigitalSpitalCMEModule/infra/deploy
./dsc ps
./dsc logs -f api
```

`dsc` is `docker compose` with the two configuration files already loaded. A
bare `docker compose ps` here interpolates an empty `${IMAGE_API}` and reports
on a stack that does not exist, which reads as "everything is down".

### Rolling back

**Actions → Deploy → Run workflow**, with `rollback_tag` set to a previous short
SHA — or on the server:

```bash
cd ~/Repositories/DigitalSpitalCMEModule/infra/deploy
./deploy.sh --rollback 1a2b3c4
```

Nothing is rebuilt: every image is tagged with its commit and the old ones are
still on the disk, which is the whole reason the tag is the commit. Images are
pruned after a week, so a rollback further back than that means checking the
commit out and building it again.

Migrations are **not** re-run — they are additive by convention, so an older
image works against a newer schema, and this script will never run one
backwards.

### Checking a configuration change before applying it

```bash
ssh deploy@78.47.178.65 \
  'cd ~/Repositories/DigitalSpitalCMEModule/infra/deploy && ./deploy.sh --check'
```

Runs the whole preflight and stops. Nothing is pulled, migrated, restarted or
written — including the apex redirect block, which is generated only on a real
deploy.

### Backups

`deploy.sh` takes one before every migration, to `/var/backups/ds-education`,
keeping fourteen. That covers "a migration went wrong"; it does **not** cover
"the server is gone", because the backups are on the server.

**`~/ds-education/secrets.env` belongs in the same backup as the dump.** The
KMS key in it decrypts the VNR password and the SMTP credentials; a restore
without it brings back rows whose `_enc` columns are permanently unreadable.

**Before go-live, add off-host copies.** A CME participation record is the
counterpart of a report already filed with an Ärztekammer under somebody's
name — see `docs/gdpr.md` §5 for why deleting it is not an option and therefore
why losing it is not either. Hetzner's Storage Box over `rsync`, or their
snapshot facility, both work; either is a decision to make deliberately rather
than a default to inherit.

Restoring one:

```bash
gunzip -c /var/backups/ds-education/<timestamp>.sql.gz | \
  ./dsc exec -T postgres psql -U postgres -d ds_education
```

### Watching it

```bash
cd ~/Repositories/DigitalSpitalCMEModule/infra/deploy
./dsc logs -f api
./dsc ps

# What is actually deployed, according to the server rather than a workflow log.
git -C ~/Repositories/DigitalSpitalCMEModule rev-parse --short HEAD
docker images ds-education/api

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
