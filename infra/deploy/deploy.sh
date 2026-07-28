#!/usr/bin/env bash
#
# Deploy the DS Education Platform (P10-04).
#
# Runs **on the target host**. GitHub Actions copies this directory over and
# invokes it; a human can run exactly the same command over SSH, which is the
# point — a deployment path that only CI can execute is a deployment path
# nobody can debug at 22:00.
#
#   ./deploy.sh                 pull, migrate, restart, verify
#   ./deploy.sh --no-migrate    skip migrations (rolling back to an older image)
#   ./deploy.sh --rollback TAG  redeploy a previous tag
#
# ## The order, and why it is that order
#
# 1. Preflight: refuse early on anything missing, rather than half-deploying.
# 2. Pull images. A registry hiccup must not stop the running site.
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
readonly ENV_FILE="${SCRIPT_DIR}/.env.production"
readonly COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.prod.yml"
readonly BACKUP_DIR="${DS_BACKUP_DIR:-/var/backups/ds-education}"

RUN_MIGRATIONS=1
ROLLBACK_TAG=""

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mxx\033[0m %s\n' "$*" >&2; exit 1; }

# Anything that fails past this point should say where, not just fail.
trap 'die "failed at line ${LINENO}. The previous version is still running."' ERR

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-migrate) RUN_MIGRATIONS=0; shift ;;
    --rollback)   ROLLBACK_TAG="${2:-}"; [[ -n "$ROLLBACK_TAG" ]] || die "--rollback needs a tag"; shift 2 ;;
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
[[ -f "$ENV_FILE" ]] || die "missing ${ENV_FILE} — the deploy workflow writes it from GitHub secrets"

# Refuse a world-readable secrets file rather than silently accepting one.
# Every credential the platform has is in there.
perms="$(stat -c '%a' "$ENV_FILE")"
[[ "$perms" == "600" || "$perms" == "400" ]] || die "${ENV_FILE} has mode ${perms}; expected 600"

set -a
# shellcheck disable=SC1090 # runtime path, deliberately not resolvable at lint time
source "$ENV_FILE"
set +a

for required in \
  API_DOMAIN ADMIN_DOMAIN WIDGET_DOMAIN ACME_EMAIL \
  POSTGRES_DB POSTGRES_SUPERUSER POSTGRES_SUPERUSER_PASSWORD \
  DS_MIGRATOR_PASSWORD DS_APP_PASSWORD \
  KEYCLOAK_ISSUER KEYCLOAK_AUDIENCE KEYCLOAK_JWKS_URI \
  IMAGE_API IMAGE_ADMIN IMAGE_WIDGET
do
  [[ -n "${!required:-}" ]] || die "missing required variable: ${required}"
done

# The EIV live guard, at deploy time rather than at submission time. A
# Punktemeldung cannot be withdrawn once the correction window closes, so
# pointing at the real endpoint has to be a deliberate act (ADR-0005).
if [[ "${EIV_BASE_URL:-}" == *"eiv-fobi.de"* && "${EIV_ALLOW_LIVE:-}" != "yes" ]]; then
  die "EIV_BASE_URL points at the live endpoint but EIV_ALLOW_LIVE is not 'yes'"
fi

if [[ -n "$ROLLBACK_TAG" ]]; then
  log "Rolling back to ${ROLLBACK_TAG}"
  IMAGE_API="${IMAGE_API%:*}:${ROLLBACK_TAG}"
  IMAGE_ADMIN="${IMAGE_ADMIN%:*}:${ROLLBACK_TAG}"
  IMAGE_WIDGET="${IMAGE_WIDGET%:*}:${ROLLBACK_TAG}"
  export IMAGE_API IMAGE_ADMIN IMAGE_WIDGET
  # A rollback to an older image against a newer schema is why migrations are
  # additive. Running them again would be pointless; running them *backwards*
  # is not something this script will ever do.
  RUN_MIGRATIONS=0
fi

compose() { docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }

# ---------------------------------------------------------------------------
# 2. Pull
# ---------------------------------------------------------------------------
log "Pulling images"
compose pull --quiet api admin widget

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

# Old images accumulate fast on a small host; a full disk is its own outage.
log "Pruning unused images"
docker image prune --force --filter "until=168h" >/dev/null

log "Deployed."
log "  API     https://${API_DOMAIN}"
log "  Admin   https://${ADMIN_DOMAIN}"
log "  Widget  https://${WIDGET_DOMAIN}/ds-lms.js"
