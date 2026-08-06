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
  die "Fill it in before deploying — at least BASE_DOMAIN, ACME_EMAIL,
   PORTAL_PROJECT_SLUG, ADMIN_DEFAULT_PROJECT_SLUG and the two
   PORTAL_KEYCLOAK_* values:

     nano ${CONFIG_FILE}

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
readonly REQUIRED_CONFIG=(
  BASE_DOMAIN ACME_EMAIL
  POSTGRES_DB POSTGRES_SUPERUSER
  PORTAL_PROJECT_SLUG ADMIN_DEFAULT_PROJECT_SLUG
  PORTAL_KEYCLOAK_ISSUER PORTAL_KEYCLOAK_CLIENT_ID
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
# Only *checked* here. Writing the file is a change, and `--check` promises not
# to make any — see the block after the dry-run exit.
#
# Given an empty value once, rather than `${APEX_REDIRECT_URL:-}` at each of
# the four places that read it. Under `set -u` those two are equivalent only
# for as long as nobody adds a fifth reference and forgets the default, and the
# block that writes the Caddy file is past the `--check` exit where a forgotten
# default is an aborted production deploy rather than a failed preflight.
APEX_REDIRECT_URL="${APEX_REDIRECT_URL:-}"
if [[ -n "$APEX_REDIRECT_URL" ]]; then
  [[ "$APEX_REDIRECT_URL" =~ ^https?:// ]] || die \
    "APEX_REDIRECT_URL must be a full URL, e.g. https://${PORTAL_DOMAIN}"
fi

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
if [[ -n "$APEX_REDIRECT_URL" ]]; then
  log "Bare domain ${BASE_DOMAIN} redirects to ${APEX_REDIRECT_URL}"
  cat > "$APEX_BLOCK" <<EOF
# Generated by deploy.sh from APEX_REDIRECT_URL. Do not edit.
${BASE_DOMAIN} {
	import baseline
	# 308, not 302: the method and body are preserved and the answer is
	# cacheable, which is what a permanent home-page move is.
	redir ${APEX_REDIRECT_URL}{uri} 308
}
EOF
else
  rm -f "$APEX_BLOCK"
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
    -e MIGRATION_DATABASE_URL="postgres://ds_migrator:${DS_MIGRATOR_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
    --entrypoint node api dist/db-migrate.js
fi

# ---------------------------------------------------------------------------
# 4b. The portal's realm and the project's realm are the same realm
# ---------------------------------------------------------------------------
# The API validates a learner's token against `projects.keycloak_issuer`; the
# portal sends the learner to `PORTAL_KEYCLOAK_ISSUER`. Nothing structural keeps
# those two the same, and when they differ the learner signs in perfectly well
# and then has every request rejected with a 401 that names nothing.
#
# A warning rather than a refusal, and only when the project row exists: on a
# first deploy it does not, and refusing would make the platform impossible to
# install. `|| true` throughout — a check that can fail the deploy on a psql
# quirk is worse than no check.
#
# The **portal's** project, `PORTAL_PROJECT_SLUG`. This block said
# `PROJECT_SLUG` until P18-01 split that variable per surface, and the name
# survived the rename — which under `set -u` is not a wrong answer but an
# aborted deploy, at the one step `--check` cannot reach because it is after
# the migrations. The console's `ADMIN_DEFAULT_PROJECT_SLUG` is deliberately
# not what is checked: staff sign in against the local identity plane
# (ADR-0012) and never meet Keycloak at all.
#
# The slug goes in as a psql variable rather than into the query text. It is a
# value from a file only an operator writes, so this is not a live injection —
# but it runs as the superuser, which is a bad place to keep a shape that only
# happens to be safe.
if [[ "$RUN_MIGRATIONS" == "1" ]]; then
  project_issuer="$(compose exec -T -e PGPASSWORD="$POSTGRES_SUPERUSER_PASSWORD" postgres \
    psql -tAX -U "$POSTGRES_SUPERUSER" -d "$POSTGRES_DB" \
    -v "slug=${PORTAL_PROJECT_SLUG}" \
    -c "SELECT coalesce(keycloak_issuer, '') FROM projects WHERE slug = :'slug'" \
    2>/dev/null | tr -d '[:space:]' || true)"

  if [[ -z "$project_issuer" ]]; then
    log "Project '${PORTAL_PROJECT_SLUG}' has no Keycloak issuer yet — set it in the console"
  elif [[ "$project_issuer" != "$PORTAL_KEYCLOAK_ISSUER" ]]; then
    printf '\033[1;33m!!\033[0m %s\n' \
      "PORTAL_KEYCLOAK_ISSUER (${PORTAL_KEYCLOAK_ISSUER}) is not the issuer on project '${PORTAL_PROJECT_SLUG}' (${project_issuer})." >&2
    printf '\033[1;33m!!\033[0m %s\n' \
      "A learner will sign in successfully and then have every request refused. Fix one of the two." >&2
  else
    log "Portal and project agree on the Keycloak realm"
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
