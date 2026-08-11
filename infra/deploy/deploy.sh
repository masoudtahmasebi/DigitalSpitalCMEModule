#!/usr/bin/env bash
#
# Deploy the DS Education Platform (P10-04, P17-01).
#
# Runs **on the target host**, from the repository's own checkout. GitHub
# Actions fetches the commit and invokes this; a human can run exactly the same
# command over SSH, which is the point — a deployment path that only CI can
# execute is a deployment path nobody can debug at 22:00.
#
# ## Where things live
#
#   ~/Repositories/DigitalSpitalCMEModule   the git clone. Disposable: `git
#                                           fetch && git checkout` is the whole
#                                           of what a deploy changes here.
#   ~/ds-education/config.env               written once by a human, never by a
#                                           deploy. The answers no default can
#                                           be right about.
#   ~/ds-education/secrets.env              generated on first deploy, mode 600,
#                                           never regenerated. See secrets.sh.
#   ~/ds-education/sites/                   Caddy blocks this script generates.
#
# State is outside the clone deliberately: a `git checkout` must never be able
# to touch a credential, and `git status` on the server should be clean.
#
# `DS_STATE_DIR` overrides the state location, which is what the tests use.
#
#   ./deploy.sh                 build, migrate, restart, verify
#   ./deploy.sh --check         run the preflight only, change nothing
#   ./deploy.sh --no-build      restart without rebuilding (config change only)
#   ./deploy.sh --no-migrate    skip migrations
#   ./deploy.sh --rollback SHA  run images already built from an older commit
#
# ## The order, and why it is that order
#
# 1. Preflight: refuse early on anything missing, rather than half-deploying.
# 2. Build the images. A failed build must not stop the running site — and it
#    does not, because nothing is swapped until step 5.
# 3. Back up the database, before any migration touches it.
# 4. Migrate, as ds_migrator. Migrations here are additive by convention, so
#    the old container keeps working against the new schema during the swap.
# 5. Start the new containers and wait for the API to report healthy.
# 6. Verify from outside, over TLS.
#
# A failure at any step leaves the previous version running and exits non-zero.

set -Eeuo pipefail

# Assigned separately from `readonly` so a failing `cd` is not masked by the
# declaration's own exit status (SC2155).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
readonly COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.prod.yml"
readonly BACKUP_DIR="${DS_BACKUP_DIR:-/var/backups/ds-education}"
readonly STATE_DIR="${DS_STATE_DIR:-${HOME}/ds-education}"
readonly CONFIG_FILE="${STATE_DIR}/config.env"

RUN_MIGRATIONS=1
RUN_BUILD=1
ROLLBACK_TAG=""
DRY_RUN=0

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mxx\033[0m %s\n' "$*" >&2; exit 1; }

# Anything that fails past this point should say where, not just fail.
trap 'die "failed at line ${LINENO}. The previous version is still running."' ERR

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-migrate) RUN_MIGRATIONS=0; shift ;;
    # For a configuration change: the images are already right, only the
    # environment they start with has moved.
    --no-build)   RUN_BUILD=0; shift ;;
    # Everything up to and including the preflight, then stop. For checking a
    # freshly written .env.production before the first real deploy, when the
    # alternative is finding out halfway through.
    --check)      DRY_RUN=1; shift ;;
    --rollback)   ROLLBACK_TAG="${2:-}"; [[ -n "$ROLLBACK_TAG" ]] || die "--rollback needs a commit"; shift 2 ;;
    -h|--help)    sed -n '2,30p' "$0"; exit 0 ;;
    *)            die "unknown option: $1" ;;
  esac
done

# ---------------------------------------------------------------------------
# 1. Preflight
# ---------------------------------------------------------------------------
log "Preflight"

command -v docker >/dev/null || die "docker is not installed"
docker compose version >/dev/null 2>&1 || die "docker compose v2 is not available"
command -v openssl >/dev/null || die "openssl is not installed (needed to generate credentials)"
command -v git >/dev/null || die "git is not installed (the deploy runs from a checkout)"

# Compose v2 prefers Bake, which needs buildx. Ubuntu's `docker.io` package does
# not ship it, so compose warns on every build and silently falls back to the
# legacy builder — which works, but shares nothing between the four targets and
# rebuilds the `deps` stage for each of them.
#
# Installing `docker-buildx` is worth several minutes a deploy. Until it is
# there, saying so once and turning Bake off explicitly beats a warning that
# scrolls past above ten minutes of build output.
if docker buildx version >/dev/null 2>&1; then
  export COMPOSE_BAKE=true
else
  export COMPOSE_BAKE=false
  printf '\033[1;33m!!\033[0m %s\n' \
    "buildx is not installed, so the four images cannot share their build stages." >&2
  printf '\033[1;33m!!\033[0m %s\n' \
    "  sudo apt-get install -y docker-buildx        (once; saves minutes per deploy)" >&2
fi

# The state directory, before anything needs it. Created here rather than left
# to a documented `install -d` step, because the documented step is the one
# somebody skips — and the error it produces then is `install: invalid target`,
# which is about the wrong thing entirely.
mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"

# The operator's file. Seeded from the template rather than merely demanded:
# the copy is mechanical, the *filling in* is the part that needs a person, and
# a script that stops with "now edit this file" wastes nobody's time on the
# half it could have done itself.
if [[ ! -f "$CONFIG_FILE" ]]; then
  (umask 077 && cp "${SCRIPT_DIR}/config.env.example" "$CONFIG_FILE")
  printf '\033[1;33m!!\033[0m %s\n' "Created ${CONFIG_FILE} from the template." >&2
  die "Fill it in before deploying — at minimum BASE_DOMAIN and ACME_EMAIL:

     nano ${CONFIG_FILE}

   Everything else has a working default or is derived from BASE_DOMAIN.
   Then run this again."
fi

perms="$(stat -c '%a' "$CONFIG_FILE")"
[[ "$perms" == "600" || "$perms" == "400" ]] || die "${CONFIG_FILE} has mode ${perms}; expected 600"

set -a
# shellcheck disable=SC1090 # runtime path, deliberately not resolvable at lint time
source "$CONFIG_FILE"
set +a

# Everything the stack cannot start without and cannot derive. Named here, in
# one list, so the drift check below can speak about exactly these.
# `PORTAL_PROJECT_SLUG`, `ADMIN_DEFAULT_PROJECT_SLUG` and the two
# `PORTAL_KEYCLOAK_*` values used to be here and are not any more (P24-01).
#
# The first two lost their last reader in P21-03 and P22-03 — the portal takes
# its tenant from the URL path now, and the console from what the operator can
# actually reach. They stayed in this list anyway, so a fresh installation was
# **refused until somebody set two variables that do nothing**, and the only way
# to find that out was to read the source. That is worse than clutter: it is an
# instruction that cannot be satisfied honestly.
#
# The `PORTAL_KEYCLOAK_*` pair is still read — `domains.sh` derives the CSP's
# `KEYCLOAK_ORIGIN` from the issuer — but it is no longer *required*, because a
# customer whose participants have local accounts has no Keycloak at all.
#
# `scripts/env-audit.mjs` is what stops this recurring: a variable in a template
# with no reader now fails CI.
readonly REQUIRED_CONFIG=(
  BASE_DOMAIN ACME_EMAIL
  POSTGRES_DB POSTGRES_SUPERUSER
)

# A config.env written against an older template.
#
# The file is never rewritten by a deploy — which is right, it holds decisions —
# so a renamed or added variable surfaces later as "X is not set", with nothing
# to say that the *template* is where X came from. That happened on the first
# real deployment: `PROJECT_SLUG` had become `PORTAL_PROJECT_SLUG` and
# `ADMIN_DEFAULT_PROJECT_SLUG`, and the message named the new spellings without
# mentioning that the file predated them.
#
# **Required keys only.** The optional ones are absent because somebody chose to
# leave them out — listing those buries the two that matter under a dozen that
# do not.
drifted=()
for key in "${REQUIRED_CONFIG[@]}"; do
  grep -qE "^${key}=" "$CONFIG_FILE" || drifted+=("$key")
done
if [[ ${#drifted[@]} -gt 0 ]]; then
  printf '\033[1;33m!!\033[0m %s\n' \
    "${CONFIG_FILE} predates the current template — it does not mention:" >&2
  printf '     %s\n' "${drifted[@]}" >&2
  printf '\033[1;33m!!\033[0m %s\n' \
    "  diff -u '${CONFIG_FILE}' '${SCRIPT_DIR}/config.env.example'" >&2
fi

# Credentials the machine owns. Generated on first run, loaded on every run,
# never regenerated — see secrets.sh for why that last part is not a nicety.
log "Credentials"
# shellcheck source=./secrets.sh
source "${SCRIPT_DIR}/secrets.sh"
ds_ensure_secrets "$STATE_DIR" || die "could not prepare ${STATE_DIR}/secrets.env"
ds_check_secrets || die "the generated credentials are not usable (see above)"

# `ds_ensure_secrets` has already exported the percent-encoded forms — see
# `ds_url_encode`. It does that rather than leaving it to each caller, because
# `dsc` is the other caller and it forgot.

# Which commit this is. The image tag, so `docker images` is a deployment
# history and a rollback is an image that is already on the disk.
#
# From git rather than from an argument: the checkout *is* the version, and a
# tag passed separately is a tag that can disagree with the code beside it.
if DS_COMMIT="$(git -C "$SCRIPT_DIR" rev-parse --short HEAD 2>/dev/null)"; then
  export DS_COMMIT
else
  die "not a git checkout: ${SCRIPT_DIR}
   The deployment runs from a clone — see docs/deployment.md §1."
fi

# One BASE_DOMAIN, every hostname derived from it (P16-01). Sourced rather than
# run: it exports into this shell, and this shell is what `docker compose`
# inherits — the compose file interpolates the derived names.
#
# Anything the env file set explicitly survives, so a deployment that predates
# this and names every hostname by hand still deploys unchanged.
# shellcheck source=./domains.sh
source "${SCRIPT_DIR}/domains.sh"
ds_derive_domains || die "BASE_DOMAIN is missing or malformed — see config.env.example"
ds_check_domains || die "the derived configuration is inconsistent (see above)"

# Everything the stack cannot start without and cannot derive, checked here
# rather than discovered later. The cost of the long list is nothing; the cost
# of a short one is a deploy that gets as far as taking a backup and restarting
# containers before failing on a variable nobody set.
#
# The four hostnames, the API origin, the cookie domain and the CORS list are
# **not** in this list any more: `ds_derive_domains` produced them from
# BASE_DOMAIN a few lines above, and `ds_check_domains` has already asserted
# they are mutually consistent — which is more than "non-empty" ever proved.
# The credentials are not in this list: `ds_check_secrets` has already asserted
# them, and they come from a file no human edits.
for required in "${REQUIRED_CONFIG[@]}"; do
  [[ -n "${!required:-}" ]] || die "missing required variable: ${required} (set it in ${CONFIG_FILE})"
done

# The cookie scope, the CORS list and the CSP origin are checked by
# `ds_check_domains`, which ran above — against the derived *result*, so a
# deployment that overrides a hostname by hand is held to the same invariants.

# The EIV live guard, at deploy time rather than at submission time. A
# Punktemeldung cannot be withdrawn once the correction window closes, so
# pointing at the real endpoint has to be a deliberate act (ADR-0005).
if [[ "${EIV_BASE_URL:-}" == *"eiv-fobi.de"* && "${EIV_ALLOW_LIVE:-}" != "yes" ]]; then
  die "EIV_BASE_URL points at the live endpoint but EIV_ALLOW_LIVE is not 'yes'"
fi

# The API never reads a VNR or its password from the environment, and an
# operator who believes otherwise has a worker that cannot authenticate.
#
# Both belong to a *course*: `courses.vnr` and `courses.vnr_password_enc`,
# the latter encrypted with the application KMS key and settable only through
# the admin console's write-only field (CLAUDE.md §4 invariant 7). The VNR
# differs per accredited event, so there is no single environment value that
# could be right for an installation serving more than one.
#
# `EIV_VNR_PASSWORD` and `EIV_VNR` do exist — in `.env.example`, read by
# `apps/eiv-harness` at a developer's terminal, and by nothing else.
#
# This refuses rather than warns. A password sitting in `config.env` that
# nothing reads is two problems at once: a credential at rest for no reason,
# and an operator who reasonably believes the worker is configured. What
# actually happens is that every completion is abandoned `missing_vnr_password`
# — permanently, one row at a time, until somebody reads the audit log.
for inert in EIV_VNR_PASSWORD EIV_VNR; do
  [[ -z "${!inert:-}" ]] || die \
    "${inert} is set in ${CONFIG_FILE}, where nothing reads it. The VNR and its
   password belong to the course: set them on the Fortbildung's settings screen
   in the admin console (the password is write-only and encrypted at rest).
   Remove ${inert} from ${CONFIG_FILE} — and rotate it if it has been shared."
done

# Going live without somewhere for the deadline alarm to go.
#
# CLAUDE.md §4 invariant 8: a submission approaching its deadline raises an
# alert rather than failing silently. With ALERT_WEBHOOK_URL empty the alarm
# still fires and is still written to the audit log, but it reaches a log file
# nobody is watching — and the thing it is warning about has an 8-day statutory
# limit. A warning, not a refusal: it degrades to logging by design.
if [[ "${EIV_ALLOW_LIVE:-}" == "yes" && "${EIV_WORKER_ENABLED:-yes}" != "no" &&
      -z "${ALERT_WEBHOOK_URL:-}" ]]; then
  log "WARNING: the EIV worker may submit to ${EIV_BASE_URL:-?} and"
  log "         ALERT_WEBHOOK_URL is empty — deadline alarms are log-only."
fi

if [[ -n "$ROLLBACK_TAG" ]]; then
  log "Rolling back to ${ROLLBACK_TAG}"
  # One variable, because every image is tagged with the same commit. The old
  # form set four and forgot the portal for a while — a version skew between a
  # frontend and the API it calls, which is the one thing a rollback exists to
  # avoid.
  DS_COMMIT="$ROLLBACK_TAG"
  export DS_COMMIT
  # Nothing is rebuilt: the images from that commit are still on this disk,
  # which is the whole reason the tag is the commit.
  RUN_BUILD=0
  # A rollback to an older image against a newer schema is why migrations are
  # additive. Running them again would be pointless; running them *backwards*
  # is not something this script will ever do.
  RUN_MIGRATIONS=0
fi


# The bare domain, which is nobody's service hostname.
#
# Validated by `ds_check_domains`, which ran above — it is a derived value now
# (`domains.sh`), defaulting to the portal, with `none` as the explicit opt-out.
# Writing the file is a change, and `--check` promises not to make any, so the
# write lives after the dry-run exit.

# No `--env-file`: everything above was sourced with `set -a`, so compose
# interpolates from this shell's environment. One source of values rather than
# two, and the two files behind it need no ordering rule inside compose.
compose() { docker compose -f "$COMPOSE_FILE" "$@"; }

# The compose file itself has to interpolate cleanly. `config -q` catches a
# variable this script does not know to require, which is how the list above
# stays honest as the stack grows.
compose config --quiet || die "docker-compose.prod.yml does not interpolate against this .env.production"

if [[ "$DRY_RUN" == "1" ]]; then
  log "Preflight passed. Nothing was changed (--check)."
  exit 0
fi

# ---------------------------------------------------------------------------
# 1b. The bare domain's redirect, if there is one
# ---------------------------------------------------------------------------
# Written as a file rather than an `if` in the Caddyfile, because the Caddyfile
# has no conditionals: an unset APEX_REDIRECT_URL would otherwise leave a site
# block with an empty address, which Caddy reads as a *different site* — the
# catch-all — and it would answer for every hostname that reached it.
#
# Removed, not merely skipped, when the value is empty: a stale block from an
# earlier deploy would keep redirecting a domain the client has since pointed at
# a marketing site.
readonly SITES_DIR="${STATE_DIR}/sites"
readonly APEX_BLOCK="${SITES_DIR}/apex.caddy"
mkdir -p "$SITES_DIR"
if [[ "$APEX_REDIRECT_URL" == "none" ]]; then
  log "Bare domain ${BASE_DOMAIN} has no site block (APEX_REDIRECT_URL=none)"
  log "  Point its DNS elsewhere, or Caddy will answer for a name it cannot"
  log "  serve and browsers will report ERR_SSL_PROTOCOL_ERROR."
  rm -f "$APEX_BLOCK"
else
  log "Bare domain ${BASE_DOMAIN} redirects to ${APEX_REDIRECT_URL}"
  cat > "$APEX_BLOCK" <<EOF
# Generated by deploy.sh from APEX_REDIRECT_URL. Do not edit.
#
# \`www\` is here for the same reason the apex is: the DNS wildcard points it at
# this host, so without a site block Caddy has no certificate for it and the
# browser reports a TLS error rather than a missing page. Nobody sets up a
# domain expecting \`www\` to be the broken one.
${BASE_DOMAIN}, www.${BASE_DOMAIN} {
	import baseline
	# 308, not 302: the method and body are preserved and the answer is
	# cacheable, which is what a permanent home-page move is.
	redir ${APEX_REDIRECT_URL}{uri} 308
}
EOF
fi

# ---------------------------------------------------------------------------
# 2. Build
# ---------------------------------------------------------------------------
# On this host, from this checkout. A failed build leaves the running site
# untouched: nothing is swapped until step 5, and this script exits non-zero
# long before then.
#
# The four images share one `deps` stage, so the workspace is installed once
# however many of them are rebuilt.
if [[ "$RUN_BUILD" == "1" ]]; then
  log "Building images at ${DS_COMMIT}"
  compose build --pull api admin portal widget
else
  log "Skipping the build (--no-build)"
  # A tag that was never built is a `compose up` that fails on a missing image
  # after the backup and the migration have already run.
  for service in api admin portal widget; do
    docker image inspect "ds-education/${service}:${DS_COMMIT}" >/dev/null 2>&1 || die \
      "no image ds-education/${service}:${DS_COMMIT} — drop --no-build, or --rollback to a commit that was built"
  done
fi

# ---------------------------------------------------------------------------
# 3. Back up before touching the schema
# ---------------------------------------------------------------------------
if [[ "$RUN_MIGRATIONS" == "1" ]]; then
  log "Backing up the database"
  mkdir -p "$BACKUP_DIR"
  chmod 700 "$BACKUP_DIR"

  backup="${BACKUP_DIR}/$(date -u +%Y%m%dT%H%M%SZ).sql.gz"

  # Started on demand: on a first deploy the stack is not up yet.
  compose up -d postgres
  compose exec -T postgres sh -c \
    "until pg_isready -U '${POSTGRES_SUPERUSER}' -d '${POSTGRES_DB}' >/dev/null 2>&1; do sleep 1; done"

  compose exec -T postgres \
    pg_dump -U "$POSTGRES_SUPERUSER" -d "$POSTGRES_DB" --clean --if-exists \
    | gzip > "$backup"
  chmod 600 "$backup"
  log "Backup written to ${backup} ($(du -h "$backup" | cut -f1))"

  # Keep 14. A CME record is a compliance artefact; a fortnight is the
  # shortest window in which somebody notices a bad migration and asks for
  # yesterday's data.
  find "$BACKUP_DIR" -name '*.sql.gz' -type f -printf '%T@ %p\n' \
    | sort -rn | tail -n +15 | cut -d' ' -f2- | xargs -r rm --

  # -------------------------------------------------------------------------
  # 4. Migrate
  # -------------------------------------------------------------------------
  # Roles first. `init-roles.sql` is mounted into docker-entrypoint-initdb.d,
  # which Postgres runs **only when the data directory is empty** — so a role
  # added in a later commit (ds_erasure, migration 0009) would never exist on
  # an already-initialised database, and the migration that grants to it would
  # fail. The file is written to be idempotent (every CREATE ROLE is guarded),
  # so applying it on every deploy is both safe and the only way the role set
  # stays in step with the repository.
  log "Ensuring database roles"
  compose exec -T -e PGPASSWORD="$POSTGRES_SUPERUSER_PASSWORD" postgres \
    psql -v ON_ERROR_STOP=1 -U "$POSTGRES_SUPERUSER" -d "$POSTGRES_DB" \
    < ../postgres/init-roles.sql

  log "Running migrations"
  # As ds_migrator, never as the superuser: `ALTER DEFAULT PRIVILEGES FOR ROLE
  # ds_migrator` only grants ds_app on objects ds_migrator creates. Migrating
  # as postgres leaves ds_app with no grants at all — which presents as
  # "permission denied", not as RLS filtering, and looks like isolation working
  # until you read the error.
  compose run --rm \
    -e MIGRATION_DATABASE_URL="postgres://ds_migrator:${DS_MIGRATOR_PASSWORD_URL}@postgres:5432/${POSTGRES_DB}" \
    --entrypoint node api dist/db-migrate.js

  # -------------------------------------------------------------------------
  # 4a. The default customer, once, on an installation that has none
  # -------------------------------------------------------------------------
  #
  # ## Why a deploy writes rows here, having refused to everywhere else
  #
  # A deploy that writes rows is a deploy that can write the wrong ones, and
  # that is why neither other seed runs from here: both rebuild a course's
  # content tree unconditionally, which deletes learner progress against it.
  #
  # `--if-missing` makes this one different in kind. It reads one row and
  # returns before the first write once `DSCustomer` exists, so the second
  # deploy and the two-hundredth write nothing at all. The only installation it
  # can affect is one that has never had this customer — where the alternative
  # is what a fresh install used to be: a console with no customer, no
  # department, no project and no course, four things to create in the right
  # order, and no example of a filled-in one to copy.
  #
  # What it creates carries no VNR, no accreditation body and no CME points, so
  # nothing it seeds can reach EIV.
  #
  # ## Why nothing here prints a password
  #
  # This runs over SSH from a GitHub Actions job, so stdout is a workflow log.
  # `--if-missing` also tells the seed not to reveal the participant password it
  # generates; an administrator sets one on the Teilnehmende screen, which is
  # the path a real participant's credential arrives by anyway.
  #
  # No `--force`, unlike the manual invocations in the deployment guide. The
  # database is `postgres` on the compose network, which `openSeedPool` already
  # counts as local — so the flag would be redundant here, and a `--force` typed
  # out of habit is how that guard stops meaning anything.
  if [[ "${SEED_DEFAULT_CUSTOMER:-yes}" == "yes" ]]; then
    log "Ensuring the default customer exists"
    compose run --rm \
      -e MIGRATION_DATABASE_URL="postgres://ds_migrator:${DS_MIGRATOR_PASSWORD_URL}@postgres:5432/${POSTGRES_DB}" \
      --entrypoint node api dist/seed-ds-default.js --if-missing
  fi
fi

# ---------------------------------------------------------------------------
# 4b. The portal's realm and the project's realm are the same realm
# ---------------------------------------------------------------------------
# A half-configured Keycloak binding, on any project (P24-01).
#
# The API validates a learner's token against that project's own
# `keycloak_issuer` **and** `keycloak_audience`. Either one set without the
# other refuses every token, and the learner sees a 401 that names nothing.
#
# This used to check one project — the portal's `PORTAL_PROJECT_SLUG` — against
# a `PORTAL_KEYCLOAK_ISSUER` in the config file. That stopped being the right
# question in P21-03: the portal takes its tenant from the URL path and serves
# every customer, so "the portal's project" is not a thing any more. Checking
# one named project would pass while three others were misconfigured.
#
# A warning, never a refusal. On a first deploy there are no projects at all,
# and a check that can fail an install is worse than no check. `|| true`
# throughout for the same reason.
if [[ "$RUN_MIGRATIONS" == "1" ]]; then
  half_bound="$(compose exec -T -e PGPASSWORD="$POSTGRES_SUPERUSER_PASSWORD" postgres \
    psql -tAX -U "$POSTGRES_SUPERUSER" -d "$POSTGRES_DB" \
    -c "SELECT string_agg(slug, ', ' ORDER BY slug)
          FROM projects
         WHERE (keycloak_issuer IS NULL) <> (keycloak_audience IS NULL)" \
    2>/dev/null | tr -d '\n' || true)"

  if [[ -n "$half_bound" ]]; then
    printf '\033[1;33m!!\033[0m %s\n' \
      "These projects have an issuer without an audience, or the reverse: ${half_bound}." >&2
    printf '\033[1;33m!!\033[0m %s\n' \
      "A learner will sign in successfully and then have every request refused. Set both, or neither, in the console." >&2
  else
    log "No half-configured Keycloak bindings"
  fi
fi

# ---------------------------------------------------------------------------
# 5. Start and wait
# ---------------------------------------------------------------------------
log "Starting services"
compose up -d --remove-orphans

log "Waiting for the API to become healthy"
# `docker compose ps --format json` has changed shape between v2 releases
# (a JSON array in some, newline-delimited objects in others). Resolving the
# container id and inspecting it directly is stable across both.
for attempt in $(seq 1 30); do
  container="$(compose ps -q api)"
  state="unknown"
  if [[ -n "$container" ]]; then
    state="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' "$container")"
  fi
  [[ "$state" == "healthy" ]] && break
  [[ "$attempt" == "30" ]] && {
    compose logs --tail 50 api >&2
    die "API did not become healthy within 60s"
  }
  sleep 2
done
log "API is healthy"

# ---------------------------------------------------------------------------
# 6. Verify from outside
# ---------------------------------------------------------------------------
# Through Caddy, over real TLS, exactly as a learner reaches it. An internal
# health check passing while the certificate is broken is a deploy that looks
# green and serves nothing.
log "Verifying over TLS"
for attempt in $(seq 1 20); do
  if curl --fail --silent --show-error --max-time 10 "https://${API_DOMAIN}/health" >/dev/null; then
    log "https://${API_DOMAIN}/health responded"
    break
  fi
  # First deploy: Caddy is still completing the ACME challenge.
  [[ "$attempt" == "20" ]] && {
    compose logs --tail 50 caddy >&2
    die "the API is healthy internally but unreachable over TLS — check DNS and the Caddy log above"
  }
  sleep 5
done

# Old images and build layers accumulate fast on a host that builds; a full
# disk is its own outage. A week keeps enough tags for a rollback to be
# instant, which is the point of tagging by commit.
log "Pruning unused images and build cache"
docker image prune --force --filter "until=168h" >/dev/null
docker builder prune --force --filter "until=168h" >/dev/null

log "Deployed ${DS_COMMIT}."
log "  API     https://${API_DOMAIN}"
log "  Admin   https://${ADMIN_DOMAIN}"
log "  Portal  https://${PORTAL_DOMAIN}"
log "  Widget  ${WIDGET_URL}"

# ---------------------------------------------------------------------------
# 7. Which tenant paths this installation actually serves (P42-02)
# ---------------------------------------------------------------------------
#
# The reported problem: `https://…/medice` answered "Diesen Bereich gibt es
# nicht", and `GET /tenants/medice` answered `{"kind":"unknown"}`, on an
# installation where the MEDICE seed exists in the repository and had simply
# never been run on this host.
#
# Which is correct behaviour from every component and useless to the person
# looking at it. The portal cannot say more than "no such tenant" — naming the
# tenants that *do* exist would be an oracle for enumerating customers to
# anyone who visits (CLAUDE.md §9.5) — so the place that can answer is here,
# where the operator already is and is already trusted.
#
# Local projects only. A Keycloak-bound project is reached through the
# customer's own site (MEDICE's WordPress plugin), not by a path on the portal,
# so listing it here would advertise a URL that does not work — the failure this
# whole section exists to stop.
#
# `|| true` throughout, and never a failure: a deploy that succeeded must not
# report failure because a report could not be produced.
if [[ "$RUN_MIGRATIONS" == "1" ]]; then
  tenants="$(compose exec -T -e PGPASSWORD="$POSTGRES_SUPERUSER_PASSWORD" postgres \
    psql -tAX -U "$POSTGRES_SUPERUSER" -d "$POSTGRES_DB" \
    -c "SELECT string_agg(slug, ' ' ORDER BY slug)
          FROM projects
         WHERE identity_provider = 'local'" \
    2>/dev/null | tr -d '\n' || true)"

  if [[ -n "$tenants" ]]; then
    log "Tenant paths on the portal:"
    for slug in $tenants; do
      log "  https://${PORTAL_DOMAIN}/${slug}"
    done
  else
    printf '\033[1;33m!!\033[0m %s\n' \
      "No project uses local sign-in, so https://${PORTAL_DOMAIN}/<tenant> answers 'Diesen Bereich gibt es nicht' for every path." >&2
    printf '\033[1;33m!!\033[0m %s\n' \
      "Create one in the console, or run a seed: ./dsc seed medice" >&2
  fi
fi
