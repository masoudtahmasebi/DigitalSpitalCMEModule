#!/usr/bin/env bash
#
# The whole platform, in containers, on this machine (P48-01).
#
#   ./run-on-local.sh          build, start, migrate, seed, print what to open
#   ./run-on-local.sh --fresh  the same, from an empty database
#   ./run-on-local.sh --down   stop everything, keep the data
#   ./run-on-local.sh --logs   follow the logs of the running stack
#
# ## What this is for, and what `pnpm dev` is for
#
# | Want                                        | Use              |
# | ------------------------------------------- | ---------------- |
# | Write code, see it reload                   | `pnpm dev`       |
# | Check it works the way it will on the server | this script      |
# | No Node or pnpm installed at all            | this script      |
#
# `pnpm dev` runs the applications from source with watchers. It is faster and
# it is the right loop for writing code — and it has never once exercised the
# thing that has actually broken on the client's server. Every failure in P44
# and P45 lived between "the code works" and "the image starts": a variable the
# nginx entrypoint required and compose never set, a config value the API
# rejects at boot, a path resolved against the wrong directory. None of them are
# reachable from a Vite dev server.
#
# This script builds and runs the **production images**, with the production
# entrypoints and the production runtime-config mechanism. What starts here is
# what will start there.
#
# ## Why it is a script and not "docker compose up"
#
# Because `up` alone gives you an API answering 500 on every route with an empty
# schema behind it. The schema and the data arrive through **one-shot
# containers** — the migrator and the three seeds — which have to run between
# the database becoming healthy and the applications being useful. That
# ordering is the whole content of this file, and a README step somebody has to
# remember is a README step somebody skips.

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
readonly INFRA="${SCRIPT_DIR}/infra"

FRESH=0
ACTION="up"

BOLD=$'\033[1m'
DIM=$'\033[2m'
GREEN=$'\033[1;32m'
RED=$'\033[1;31m'
OFF=$'\033[0m'

log() { printf '%s==>%s %s\n' $'\033[1;34m' "$OFF" "$*"; }
die() { printf '%s✘%s %s\n' "$RED" "$OFF" "$*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --fresh) FRESH=1; shift ;;
    --down)  ACTION="down"; shift ;;
    --logs)  ACTION="logs"; shift ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) die "unknown option: $1 (try --help)" ;;
  esac
done

# Both files, always, and in this order: the dependencies define the services
# the applications `depends_on`, and compose merges later files over earlier
# ones. Wrapped in a function because every invocation below needs all of it,
# and a forgotten `-f` silently operates on half a stack.
compose() {
  docker compose \
    -f "${INFRA}/docker-compose.yml" \
    -f "${INFRA}/docker-compose.apps.yml" \
    "$@"
}

# ---------------------------------------------------------------------------
# The two commands that are not "start everything"
# ---------------------------------------------------------------------------
if [[ "$ACTION" == "down" ]]; then
  log "Stopping"
  compose down
  printf '%sStopped.%s Data is kept; --fresh on the next run discards it.\n' "$GREEN" "$OFF"
  exit 0
fi

if [[ "$ACTION" == "logs" ]]; then
  compose logs -f api admin portal widget
  exit 0
fi

# ---------------------------------------------------------------------------
# 1. Prerequisites, named one at a time
# ---------------------------------------------------------------------------
#
# One message per missing tool. A single "check your prerequisites" makes the
# reader audit four things to find the one that is wrong.
log "Checking prerequisites"

command -v docker >/dev/null 2>&1 || die \
  "docker is not installed — https://docs.docker.com/get-docker/"

# `docker --version` answers from the client alone and succeeds while the
# daemon is stopped, which is the state of every laptop that has just booted.
docker info >/dev/null 2>&1 || die \
  "the docker daemon is not running. Start Docker Desktop, or: sudo systemctl start docker"

docker compose version >/dev/null 2>&1 || die \
  "docker compose v2 is not available (\`docker compose version\` fails)"

command -v git >/dev/null 2>&1 || die "git is not installed"

printf '   %s✓%s docker, compose, git\n' "$GREEN" "$OFF"

# ---------------------------------------------------------------------------
# 2. .env — the file the README forgot for a year
# ---------------------------------------------------------------------------
#
# Compose reads `.env` from the project directory automatically, which is where
# `SECRETS_KMS_KEY` reaches the API container. Without it the API refuses to
# start, correctly and confusingly.
log "Local configuration"

readonly ENV_FILE="${SCRIPT_DIR}/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  cp "${SCRIPT_DIR}/.env.example" "$ENV_FILE"
  printf '   %s✓%s created .env from .env.example\n' "$GREEN" "$OFF"
fi

# 32 bytes, base64 — the same rule production enforces at boot. Generated here
# rather than demanded, because the value is arbitrary and the demand is a step
# somebody skips.
if ! grep -qE '^SECRETS_KMS_KEY=.+' "$ENV_FILE"; then
  if grep -qE '^SECRETS_KMS_KEY=' "$ENV_FILE"; then
    key="$(openssl rand -base64 32)"
    # A `|` delimiter: base64 contains `/` and `+`, and a generated key with a
    # `/` in it would end the pattern with `sed`'s default separator.
    sed -i.bak "s|^SECRETS_KMS_KEY=.*|SECRETS_KMS_KEY=${key}|" "$ENV_FILE"
    rm -f "${ENV_FILE}.bak"
  else
    printf 'SECRETS_KMS_KEY=%s\n' "$(openssl rand -base64 32)" >> "$ENV_FILE"
  fi
  printf '   %s✓%s generated SECRETS_KMS_KEY (local only; .env is git-ignored)\n' "$GREEN" "$OFF"
fi

# The build identifiers, so the footers say something locally too. Not fatal:
# a checkout without git history is still a usable development machine, and the
# footers then read `unknown`, which is honest.
# shellcheck source=./infra/deploy/version.sh
source "${SCRIPT_DIR}/infra/deploy/version.sh"
ds_derive_version "$SCRIPT_DIR" 2>/dev/null || { DS_VERSION="unknown"; export DS_VERSION; }
DS_COMMIT="$(git -C "$SCRIPT_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"
export DS_COMMIT
printf '   %s✓%s building v%s · %s\n' "$GREEN" "$OFF" "$DS_VERSION" "$DS_COMMIT"

# ---------------------------------------------------------------------------
# 3. A clean slate, if asked
# ---------------------------------------------------------------------------
if [[ "$FRESH" == "1" ]]; then
  log "Discarding the local database and starting empty"
  compose down -v
fi

# ---------------------------------------------------------------------------
# 4. Build, then dependencies, then schema, then data, then the applications
# ---------------------------------------------------------------------------
#
# The order is the whole point of this script. An application container started
# before the migrations answers 500 on every route against an empty schema,
# which reads as a broken build.
log "Building the images (first run takes a few minutes)"
compose build api admin portal widget

log "Starting Postgres, Redis, Keycloak and Mailpit"
compose up -d --wait postgres redis keycloak mailpit

# Roles first: `init-roles.sql` is mounted into `docker-entrypoint-initdb.d`,
# which Postgres runs **only when the data directory is empty**. A role added
# in a later migration would never exist on a database created before it, and
# the migration granting to that role would fail. The file is idempotent, so
# applying it every time is both safe and the only way the role set stays in
# step with the repository.
log "Ensuring database roles"
compose exec -T postgres psql -v ON_ERROR_STOP=1 -q \
  -U "${POSTGRES_SUPERUSER:-postgres}" -d "${POSTGRES_DB:-ds_education}" \
  < "${INFRA}/postgres/init-roles.sql" >/dev/null

# As `ds_migrator`, never as the superuser: `ALTER DEFAULT PRIVILEGES FOR ROLE
# ds_migrator` only grants `ds_app` on objects ds_migrator creates. Migrating as
# postgres leaves ds_app with no grants at all — which presents as "permission
# denied" rather than as RLS filtering rows, and looks like isolation working
# until you read the error.
readonly MIGRATOR_URL="postgres://ds_migrator:ds_migrator_dev@postgres:5432/${POSTGRES_DB:-ds_education}"

as_migrator() {
  compose run --rm --no-deps \
    -e MIGRATION_DATABASE_URL="$MIGRATOR_URL" \
    --entrypoint node api "$@"
}

log "Running migrations"
as_migrator dist/db-migrate.js

# All three tenants. The portal takes its tenant from the first path segment, so
# `/medice`, `/ds` and `/dsproject` are only exercisable when all three exist —
# and a single-tenant database hides every cross-tenant mistake by construction.
#
# `--force` because the seeds refuse a non-local database without it, and
# `postgres` is on their local allow-list but the refusal is worth keeping
# explicit here rather than widening that list.
log "Seeding medice, ds and dscustomer"
seed_report=""
for seed in seed-medice seed-ds seed-ds-default; do
  seed_report+="$(as_migrator "dist/${seed}.js" --force 2>&1)"$'\n'
done

log "Starting the API, console, portal and widget"
if ! compose up -d --wait api admin portal widget; then
  printf '\n%s✘%s a container did not start. Its own log says why:\n\n' "$RED" "$OFF" >&2
  for service in api admin portal widget; do
    id="$(compose ps -aq "$service" 2>/dev/null || true)"
    [[ -n "$id" ]] || continue
    [[ "$(docker inspect -f '{{.State.Status}}' "$id" 2>/dev/null)" == "running" ]] && continue
    printf '%s--- %s ---%s\n' "$BOLD" "$service" "$OFF" >&2
    docker logs --tail 30 "$id" 2>&1 | sed 's/^/    /' >&2
  done
  die "see above. Nothing else was changed."
fi

# ---------------------------------------------------------------------------
# 5. A console account
# ---------------------------------------------------------------------------
#
# `bootstrap-admin` refuses while an active super administrator exists (P38-03),
# which on a re-run is the refusal working rather than an error.
log "Console super administrator"
bootstrap_output="$(compose run --rm --no-deps \
  -e DATABASE_URL="postgres://ds_app:ds_app_dev@postgres:5432/${POSTGRES_DB:-ds_education}" \
  --entrypoint node api dist/bootstrap-admin.js 2>&1 || true)"

# ---------------------------------------------------------------------------
# What to open
# ---------------------------------------------------------------------------
printf '%s\n' "$seed_report" | grep -E 'Passwort|E-Mail|password|Seeded|already exists' || true
printf '%s\n' "$bootstrap_output" | tail -6

cat <<EOF

${GREEN}Running.${OFF} ${DIM}v${DS_VERSION} · ${DS_COMMIT}${OFF}

  ${BOLD}http://localhost:${DS_LOCAL_ADMIN_PORT:-55391}${OFF}              the admin console
  ${BOLD}http://localhost:${DS_LOCAL_PORTAL_PORT:-55392}/medice${OFF}       the portal, MEDICE's tenant
  ${BOLD}http://localhost:${DS_LOCAL_PORTAL_PORT:-55392}/ds${OFF}           the portal, the DS test tenant
  ${BOLD}http://localhost:${DS_LOCAL_PORTAL_PORT:-55392}/dsproject${OFF}    the neutral default tenant
  ${BOLD}http://localhost:${DS_LOCAL_WIDGET_PORT:-55393}${OFF}              the widget on its own
  ${BOLD}http://localhost:${DS_LOCAL_API_PORT:-55390}/health${OFF}       the API — version and commit
  ${BOLD}http://localhost:${DS_LOCAL_MAILPIT_PORT:-55394}${OFF}             Mailpit — every email the platform sends

${DIM}Password-reset, invitation and certificate mails land in Mailpit. Nothing
here reaches a real inbox, and nothing here can reach EIV.

  ./run-on-local.sh --logs    follow the containers
  ./run-on-local.sh --down    stop, keeping the data
  ./run-on-local.sh --fresh   start again from an empty database

For a fast edit-reload loop, use \`pnpm start && pnpm dev\` instead — same
URLs, source instead of images.${OFF}

EOF
