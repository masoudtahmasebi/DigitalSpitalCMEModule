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
# Printed, not merely checked. When compose rejects a flag — `unknown flag:
# --no-build`, P49-02 — the version is the first thing anybody asks for, and a
# deploy log that already contains it saves a round trip.
log "Using $(docker compose version --short 2>/dev/null || echo 'compose v2')"
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

# The release number (P47-01). Derived here rather than passed in by the
# workflow, so a deploy typed by hand and a deploy from GitHub Actions produce
# the same value — two sources for "the version" that cannot be compared would
# be worse than none.
#
# shellcheck source=./version.sh
source "${SCRIPT_DIR}/version.sh"
ds_derive_version "${SCRIPT_DIR}/../.." || die "could not derive a release version (see above)"
log "Deploying version ${DS_VERSION}"
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
# pointing at the real register has to be a deliberate act (ADR-0005).
#
# ## The test system is not the live one (P104-01)
#
# This used to match `*eiv-fobi.de*`, which is true of
# `backend-test.eiv-fobi.de` as well — EIV's **test** system, the one they
# instruct integrators to develop against. So configuring the platform against
# the safe system required setting `EIV_ALLOW_LIVE=yes`, and an operator who
# did that then had a deployment that would also submit to the production
# register the moment somebody edited a URL. A safety flag that must be
# switched off to do ordinary work is a flag that is always off.
#
# The rule now lives in `packages/eiv-client/src/endpoint.ts` and is unit
# tested there; `eiv-endpoint.sh` is the shell reading of it, and
# `eiv-endpoint.test.sh` drives both over one fixture table so they cannot
# drift (§9.11).
# shellcheck source=./eiv-endpoint.sh
source "$(dirname "${BASH_SOURCE[0]}")/eiv-endpoint.sh"

if ds_eiv_requires_live_consent "${EIV_BASE_URL:-}" && [[ "${EIV_ALLOW_LIVE:-}" != "yes" ]]; then
  die "EIV_BASE_URL is the live register (or an unrecognised host) but EIV_ALLOW_LIVE is not 'yes'"
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
#
# It says how, because it fires in an unattended GitHub Actions deploy where
# nobody is at a shell and the message is the whole interface (CLAUDE.md §9.4).
# The first version named the problem and the screen to fix it on, and left the
# person holding a red deploy to work out the edit for themselves.
for inert in EIV_VNR_PASSWORD EIV_VNR; do
  [[ -z "${!inert:-}" ]] || die \
    "${inert} is set in ${CONFIG_FILE}, where nothing reads it. The VNR and its
   password belong to the course: set them on the Fortbildung's settings screen
   in the admin console (the password is write-only and encrypted at rest).

   On the host, as the deploy user:

       sed -i '/^${inert}=/d' ${CONFIG_FILE}

   Then rotate the value if it has ever been shared — it has been sitting in a
   file on disk, and this refusal is the first thing that noticed."
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
# 2b. Ask the image whether it can start, before anything is changed
# ---------------------------------------------------------------------------
#
# The API validates its whole environment at boot and refuses on anything it
# cannot use. That refusal used to arrive after four images were built, a backup
# was taken, migrations were applied and the stack was swapped — as
# `container ds-education-api-1 is unhealthy`, with the actual sentence
# (`S3_ENDPOINT: must start with https://`) reachable only through `docker logs`.
#
# This runs the same `loadConfig` in a one-shot container with the same
# `environment:` block, and nothing else. `--no-deps` because configuration
# validation needs no database. A bad value now costs a build and stops here.
#
# Deliberately *after* the build — it needs the image — and *before* the backup,
# so a refusal leaves the installation byte-for-byte as it was.
log "Checking the API's configuration"

# No `--no-build`: `docker compose run` only grew that flag in a later v2, and
# this host's compose rejected it with `unknown flag: --no-build` (P49-02). It
# was belt-and-braces anyway — the image was built moments ago in step 2, and
# `pull_policy: never` stops compose reaching for a registry that does not
# exist. A flag that is redundant here and fatal on an older compose is not a
# trade worth making.
config_check_output=""
config_check_status=0
config_check_output="$(compose run --rm --no-deps \
  --entrypoint node api dist/check-config.js 2>&1)" || config_check_status=$?

# shellcheck source=./config-check.sh
source "${SCRIPT_DIR}/config-check.sh"

case "$(ds_classify_config_check "$config_check_status" "$config_check_output")" in
  ok)
    printf '%s\n' "$config_check_output"
    ;;
  old-image)
    log "  (this image predates the configuration check — skipping)"
    ;;
  invalid)
    printf '%s\n' "$config_check_output" >&2
    die "the API refuses this configuration — see the message above.
   Nothing has been changed: no backup taken, no migration run, no container
   swapped. Fix the value in ${CONFIG_FILE} and run this again."
    ;;
  *)
    # The check could not run. **Not** a reason to stop: the API still
    # validates its own environment at boot, this script still refuses to swap
    # a container that will not start, and `ds_dump_broken_services` still
    # prints its log. Blocking here would let a deploy-tooling problem stop a
    # deployment that is otherwise fine — which is exactly what
    # `unknown flag: --no-build` did.
    printf '\033[1;33m!!\033[0m %s\n' \
      "the configuration check could not run, so the deploy continues without it:" >&2
    printf '%s\n' "$config_check_output" | sed 's/^/     /' >&2
    printf '\033[1;33m!!\033[0m %s\n' \
      "If the API's configuration is wrong you will find out at step 5 instead," >&2
    printf '\033[1;33m!!\033[0m %s\n' \
      "with the previous version still running. Worth fixing, not worth blocking on." >&2
    ;;
esac

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
    < "${SCRIPT_DIR}/../postgres/init-roles.sql"

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

  # -------------------------------------------------------------------------
  # 4a-bis. The client tenants, once, on an installation that has none (P65-01)
  # -------------------------------------------------------------------------
  #
  # ## Why these now run here, having been excluded on purpose
  #
  # They were excluded because they rebuild a course's content tree
  # unconditionally, deleting learner progress against it. That reasoning was
  # right about the seeds as they were and wrong as a conclusion, because the
  # consequence was that `https://…/medice` answered "Diesen Bereich gibt es
  # nicht" on a correctly deployed installation — reported three times — for the
  # single reason that nobody had SSH'd in and run one command.
  #
  # A seed the deploy cannot run is a seed somebody has to remember, and over
  # four months nobody did. So the seeds gained `--if-missing`, which returns
  # before the first write once the tenant exists. The destructive rebuild is
  # still there and still what an operator gets when they run `./dsc seed medice`
  # deliberately; it is simply not what an unattended deploy does.
  #
  # Off with `SEED_CLIENT_TENANTS=no` for an installation that manages its
  # tenants by hand and does not want ours appearing.
  if [[ "${SEED_CLIENT_TENANTS:-yes}" == "yes" ]]; then
    for tenant_seed in seed-medice seed-ds seed-ds-test; do
      log "Ensuring the ${tenant_seed#seed-} tenant exists"
      compose run --rm \
        -e MIGRATION_DATABASE_URL="postgres://ds_migrator:${DS_MIGRATOR_PASSWORD_URL}@postgres:5432/${POSTGRES_DB}" \
        --entrypoint node api "dist/${tenant_seed}.js" --if-missing
    done
  fi
fi

# ---------------------------------------------------------------------------
# 4b. The portal's realm and the project's realm are the same realm
# ---------------------------------------------------------------------------
# The loopback pattern, named once (P101-03).
#
# `packages/seed/src/keycloak-binding.ts` is the authority — it parses the URL
# and asks the hostname, which is the right way and is unit-tested against nine
# addresses. This is the same question asked in POSIX ERE because step 4b runs
# before the API image does, with nothing but `psql`.
#
# Two implementations of one rule is exactly what §9.11 warns about, so this one
# is pinned by `keycloak-issuer.test.sh` over the same fixture table, including
# the case that makes a naive pattern wrong: `localhost.medice.com` is a public
# host and must not match.
DS_LOOPBACK_ISSUER_RE='^https?://(127\.[0-9.]+|localhost|\[::1\]|[^/]*\.localhost)(:[0-9]+)?(/|$)'

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
# What the worker will do on its first tick, before it does it (P107-02).
#
# Arming the worker against the live register is not only a decision about the
# *next* physician to finish. `claim_due_eiv_submissions` claims every row in
# `queued` or `failed_retryable` whose `next_attempt_at` has passed — so the
# first sweep after the deploy flushes whatever is already sitting in the
# queue, in a batch, to the Ärztekammer. On an installation that has been
# tested against the mock or against EIV's test system, that backlog is exactly
# the set of rows nobody intends to file.
#
# It is invisible: there is no queue screen in the console, and the operator
# arming the worker edits two lines in a file with nothing in between that says
# how much is behind them.
#
# So the deploy counts them and says so, to the person who is already trusted
# with the answer (§9.10) at the moment it is actionable. A count and a due
# date, never an EFN — ADR-0004 holds here as everywhere else.
#
# A warning, not a refusal: a backlog is a legitimate state (the worker may
# simply have been off for an hour), and only the operator knows which it is.
if [[ "$RUN_MIGRATIONS" == "1" ]] &&
  ds_eiv_worker_will_file_live "${EIV_BASE_URL:-}" "${EIV_WORKER_ENABLED:-}"; then
  queued="$(compose exec -T -e PGPASSWORD="$POSTGRES_SUPERUSER_PASSWORD" postgres \
    psql -tAX -U "$POSTGRES_SUPERUSER" -d "$POSTGRES_DB" \
    -c "SELECT count(*) FROM eiv_submissions
         WHERE status IN ('queued', 'failed_retryable')
           AND (next_attempt_at IS NULL OR next_attempt_at <= now())" \
    2>/dev/null | tr -d '\n' || true)"

  if [[ -n "$queued" && "$queued" != "0" ]]; then
    printf '\033[1;33m!!\033[0m %s\n' \
      "${queued} Punktemeldung(en) are due and the worker is armed against ${EIV_BASE_URL:-?}." >&2
    printf '\033[1;33m!!\033[0m %s\n' \
      "The first sweep after this deploy files them at the Ärztekammer. Set EIV_WORKER_ENABLED=no and re-deploy if that is not intended." >&2
  else
    log "EIV queue empty — arming the worker files nothing that already exists"
  fi
fi

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

  # A *complete* binding that points at this machine (P101-03).
  #
  # ## Why the check above was green for months on a broken project
  #
  # It asks whether the pair is complete. `medice-adhs` had both columns set —
  # to `http://127.0.0.1:8080/realms/ds-dev` and `ds-education-api`, the seed's
  # old fallback — so it passed, printed "No half-configured Keycloak bindings",
  # and an operator reading that line reasonably concluded the bindings were
  # fine. Every physician arriving from MEDICE's WordPress got a bare 401 on a
  # real, correctly-signed token, because the API was comparing its `iss`
  # against an address inside the API container.
  #
  # That is CLAUDE.md §9.1's second form: a check that silently covers less than
  # its own success message claims. Completeness was never the property that
  # mattered — reachability from a physician's browser was.
  #
  # The seed now refuses outright, which is the hard gate. This stays a warning
  # and stays here because it covers what the seed cannot: a project somebody
  # created by hand in the console, on an installation whose seeds never ran.
  loopback_bound="$(compose exec -T -e PGPASSWORD="$POSTGRES_SUPERUSER_PASSWORD" postgres \
    psql -tAX -U "$POSTGRES_SUPERUSER" -d "$POSTGRES_DB" \
    -c "SELECT string_agg(slug, ', ' ORDER BY slug)
          FROM projects
         WHERE keycloak_issuer ~* '${DS_LOOPBACK_ISSUER_RE}'" \
    2>/dev/null | tr -d '\n' || true)"

  if [[ -n "$loopback_bound" ]]; then
    printf '\033[1;33m!!\033[0m %s\n' \
      "These projects are bound to a Keycloak on loopback: ${loopback_bound}." >&2
    printf '\033[1;33m!!\033[0m %s\n' \
      "No learner can sign in to them — the token's issuer is compared against an address inside this container." >&2
    printf '\033[1;33m!!\033[0m %s\n' \
      "Fix: Verwaltung -> Organisation -> Projekte -> <project> -> Bearbeiten (Issuer, Audience, Realm)." >&2
  else
    log "No project bound to a Keycloak on loopback"
  fi
fi

# ---------------------------------------------------------------------------
# 5. Start and wait
# ---------------------------------------------------------------------------
# Print why, for every container that is not running (P44-03).
#
# ## The failure this exists to end
#
# The deploy said, in full:
#
# ```
# ✘ Container ds-education-api-1  Error
# dependency failed to start: container ds-education-api-1 is unhealthy
# xx failed at line 316. The previous version is still running.
# ```
#
# and stopped. Two other containers were in a restart loop with the actual
# cause in their logs — `ds-runtime-config: DS_PROJECT_SLUG is empty and is
# required` — and the deploy named neither, because `caddy` `depends_on` all of
# them and the API is the one carrying a healthcheck.
#
# There *was* a `compose logs --tail 50 api` below, and it could not run: it
# lives after the wait loop, and `compose up -d` had already exited non-zero, so
# the ERR trap fired first. A diagnostic behind a failing command is a
# diagnostic that only prints when it is not needed (CLAUDE.md §9.1).
#
# So the logs are dumped **here**, for every service that is not `running`, and
# `up` is allowed to fail on its own terms rather than through the trap.
ds_dump_broken_services() {
  local service container status
  for service in api admin portal widget caddy; do
    container="$(compose ps -aq "$service" 2>/dev/null || true)"
    if [[ -z "$container" ]]; then
      printf '\n\033[1;31m✘\033[0m %s\n' "${service}: no container was created"
      continue
    fi

    status="$(docker inspect -f '{{.State.Status}}' "$container" 2>/dev/null || echo unknown)"
    [[ "$status" == "running" ]] && continue

    printf '\n\033[1;31m✘\033[0m %s\n' \
      "${service} is ${status} (exit $(docker inspect -f '{{.State.ExitCode}}' "$container" 2>/dev/null || echo '?')) — its last 40 log lines:"
    docker logs --tail 40 "$container" 2>&1 | sed 's/^/     /' >&2
  done
}

log "Starting services"
if ! compose up -d --remove-orphans; then
  ds_dump_broken_services
  die "one or more containers did not start — the logs above say which and why.
   The previous version is still running."
fi

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
    # Every broken service, not only the API. The API's healthcheck is what
    # times out, but the container that explains it is often another one.
    compose logs --tail 50 api >&2
    ds_dump_broken_services
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

# ---------------------------------------------------------------------------
# 6b. The bucket will accept an upload from the console (P70-01)
# ---------------------------------------------------------------------------
#
# ## The failure this ends
#
# The console PUTs a course video straight to the bucket, so the browser asks
# the *bucket* for permission in a preflight the API is not part of and never
# learns about. A bucket with no CORS rule therefore produces: an upload button
# that appears to work, a ticket minted successfully, an API log with nothing
# wrong in it, and no video.
#
# That was production's state for as long as uploads have existed. The rule to
# apply has been in `config.env.example` since P23-04, under the heading
# "Bucket configuration you have to do once, by hand", and nobody ever did —
# CLAUDE.md §9.9's corollary: **the repository's state is not the
# installation's state.** So the deploy applies it, rather than a document
# asking somebody to remember.
#
# The tool applies the rule and then asks the bucket the browser's own
# question — an unsigned OPTIONS preflight. It is the probe, not the write,
# that decides the exit code: a write returning 200 proves the request was
# accepted, and only the preflight proves the browser can proceed.
#
# **Fatal, deliberately.** The containers are already running by this point, so
# the site stays up and the deploy reports failure — which is the honest
# outcome for an installation whose authors cannot upload. The message names
# the exact document to paste at the storage provider.
if [[ -n "${S3_ENDPOINT:-}" && -n "${S3_BUCKET:-}" ]]; then
  log "Checking the media bucket accepts uploads from https://${ADMIN_DOMAIN}"
  if ! compose run --rm --no-deps \
    -e S3_CORS_ORIGINS="https://${ADMIN_DOMAIN}" \
    --entrypoint node api dist/bucket-cors.js; then
    die "the media bucket refuses uploads from the console — see the CORS document above.
   Everything else deployed and is running; only video upload is affected."
  fi
else
  log "No object storage configured; skipping the bucket check"
fi

# ---------------------------------------------------------------------------
# 6c. Caddy is serving the Caddyfile in *this checkout* (P74-07)
# ---------------------------------------------------------------------------
#
# ## The failure this ends
#
# Found by the post-deploy journey on 14.08. The browser said, on production:
#
#     Refused to load media from 'https://nbg1.your-objectstorage.com/…'
#     because it violates the following Content Security Policy directive:
#     "default-src 'self'". Note that 'media-src' was not explicitly set…
#
# against a deploy whose checkout *contained* that `media-src`.
#
# ## Two causes, and the second one only showed itself under the check
#
# 1. `compose up -d` recreates a container when its **image** or its
#    **compose-level configuration** changes, and a changed mounted file is
#    neither — so nothing restarted Caddy at all.
#
# 2. And a reload alone does not fix it either, which is the part that cost a
#    second deploy to learn. `./Caddyfile:/etc/caddy/Caddyfile:ro` is a bind
#    mount of a **file**, and Docker resolves that to an **inode** when the
#    container is created. `git checkout` does not edit the file in place — it
#    writes a new one and renames it over the old — so the checkout gets a new
#    inode and the container goes on pointing at the previous one. Caddy then
#    re-reads `/etc/caddy/Caddyfile` perfectly faithfully and gets the old
#    bytes; `caddy reload` returns 0 and nothing changes.
#
# The repository's state is not the installation's state (CLAUDE.md §9.9), one
# layer below where that rule is usually applied: the deploy had updated the
# file, and the container was not looking at that file any more.
#
# This is not one directive's problem. Every header, route and redirect ever
# changed in that file has had the same fate, and nothing anywhere said so.
#
# ## Reload, check, escalate, check again
#
# `caddy reload` is the graceful path — no dropped connections, no fresh ACME
# work — so it is tried first. A recreate re-resolves the mount and always
# works, at the cost of a few seconds of refused connections, so it is the
# fallback rather than the default. **What decides between them is the served
# header**, not a guess about which of the two causes above is in play: a
# reload returning 0 proves the command ran, not that the running server
# answers differently, which is exactly the §9.1 shape this check exists for.
#
# The comparison expands Caddy's own placeholders from this shell, which holds
# the same values compose passes the container — so a mismatch means the file
# and the server genuinely disagree, not that one of them interpolated. (Spelt
# without the literal token here: `deploy-vars.test.sh` reads comments too, and
# an example in prose would read as a variable this script requires.)
#
# What it covers: any change to a policy, including a value inside a directive.
# What it does not: the rest of the Caddyfile — a changed route or redirect is
# still unverified here, and the reload above is what applies it.
source "${SCRIPT_DIR}/caddy-config.sh"

# The served policy for one site, normalised. Empty when the site answers no
# header at all, which is itself a mismatch worth reporting.
ds_served_csp() {
  ds_normalise_policy "$(
    curl --silent --show-error --max-time 10 --head "https://$1" 2>/dev/null \
      | sed -n 's/^[Cc]ontent-[Ss]ecurity-[Pp]olicy: *//p'
  )"
}

# Does every site serve what the file says? Retried, because a reload is in
# flight and one refused connection during it must not decide the answer.
ds_policies_match() {
  local site host expected attempt
  for attempt in $(seq 1 "${1:-5}"); do
    local all_match=1
    for site in ADMIN_DOMAIN PORTAL_DOMAIN; do
      expected="$(ds_expected_csp "$site" || true)"
      [[ -n "$expected" ]] || continue
      host="${!site}"
      [[ "$(ds_served_csp "$host")" == "$expected" ]] || all_match=0
    done
    [[ "$all_match" == "1" ]] && return 0
    sleep 1
  done
  return 1
}

log "Making Caddy read this checkout's Caddyfile"

# Cheap first: a reload is graceful, drops no connection and redoes no ACME
# work. It is also **not always enough**, for a reason worth stating because it
# cost a deploy to find:
#
#   `./Caddyfile:/etc/caddy/Caddyfile:ro` is a bind mount of a *file*, which
#   Docker resolves to an **inode** when the container is created. `git
#   checkout` does not edit that file in place — it writes a new one and
#   renames it over the old — so the checkout gets a new inode and the
#   container keeps pointing at the old one.
#
# Caddy then re-reads `/etc/caddy/Caddyfile` perfectly faithfully and gets the
# file as it was when the container was created. `caddy reload` returns 0 and
# nothing changes. Only recreating the container re-resolves the mount.
#
# So: reload, check, and escalate to a recreate if the check disagrees. The
# recreate costs a few seconds of refused connections, which is why it is not
# the first move — and the check is what decides, rather than a guess about
# which case this is.
compose exec -T caddy caddy reload \
  --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 || true

if ! ds_policies_match 5; then
  log "  a reload was not enough — recreating the container to re-resolve the mount"
  compose up -d --force-recreate caddy
fi

# The last word, and deliberately after both attempts: a reload's exit code
# says the command ran, not that the running server answers differently (§9.1).
if ! ds_policies_match 15; then
  for site in ADMIN_DOMAIN PORTAL_DOMAIN; do
    expected="$(ds_expected_csp "$site" || true)"
    [[ -n "$expected" ]] || continue
    host="${!site}"
    served="$(ds_served_csp "$host")"
    [[ "$served" == "$expected" ]] && continue

    printf '\033[1;31mxx\033[0m %s\n' "https://${host} is not serving this checkout's Caddyfile." >&2
    printf '   the file says:   %s\n' "$expected" >&2
    printf '   the server says: %s\n' "${served:-（no Content-Security-Policy at all）}" >&2
  done
  die "Caddy is not serving this checkout's configuration, and recreating its
   container did not change that. Everything else deployed and is running.
   What is affected is every header, route and redirect changed in that file,
   each of which fails in the browser with nothing in any server log."
fi
log "Caddy serves the policy this checkout defines"

# ---------------------------------------------------------------------------
# 6d. The widget bundle is reachable, and loadable from somebody else's page
# ---------------------------------------------------------------------------
#
# Since P96-01 every customer's WordPress site loads `ds-lms.js` from here
# rather than shipping its own copy — which is what makes a widget fix reach
# them without a plugin update, and also what makes this host a single point of
# failure for every embedded Fortbildung on the platform.
#
# Two things can go wrong and neither appears in any log of ours:
#
#   * the host does not answer — DNS, a certificate, a container that did not
#     start — and every embedding page renders an empty area;
#   * it answers **without CORS**, and the browser fetches the file, refuses to
#     execute it, and says so only in a console nobody on our side is looking
#     at. That is P70-01's bucket, one origin over.
#
# So the deploy asks the same question a customer's browser will. A `HEAD`,
# because the bytes are not in question and the headers are.
log "Verifying the widget bundle"
ds_widget_headers=""
for attempt in $(seq 1 20); do
  ds_widget_headers="$(
    curl --fail --silent --show-error --max-time 10 --head "${WIDGET_URL}" 2>/dev/null || true
  )"
  [[ -n "$ds_widget_headers" ]] && break
  # First deploy: Caddy may still be completing the ACME challenge for this
  # hostname, exactly as for the API above.
  [[ "$attempt" == "20" ]] && {
    die "${WIDGET_URL} did not answer. Every WordPress site embedding a
   Fortbildung loads its JavaScript from there, so each of them is currently
   rendering an empty page with nothing in our logs to say so. Check that
   ${WIDGET_DOMAIN} resolves to this host and that the widget container is up."
  }
  sleep 5
done

if ! printf '%s' "$ds_widget_headers" \
  | grep -qi '^access-control-allow-origin: *\*'; then
  die "${WIDGET_URL} answers, but without an Access-Control-Allow-Origin header.
   A browser on a customer's own domain will download the file and refuse to
   execute it, which looks to them like a widget that does nothing and to us
   like a successful request. infra/nginx/widget.conf sets the header — note
   that nginx drops every inherited header the moment a location block declares
   one of its own, so check that block rather than the server."
fi
log "${WIDGET_URL} is reachable and loadable cross-origin"

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

# ---------------------------------------------------------------------------
# The scheduled jobs, installed rather than described (P140-01)
# ---------------------------------------------------------------------------
#
# `backup.timer` in this directory carried four systemd units and an instruction
# to *"copy the four sections below into /etc/systemd/system/"*. On 01.09.2026
# the client confirmed what CLAUDE.md §9.9 predicts about that shape:
#
#   > "They were never installed."
#
# So the platform had run for weeks with **no backup of any kind** — a
# meticulous runbook, an encrypted dump, a retention policy, a freshness check,
# and nothing on a schedule to produce a file for any of it to act on. That is
# the CORS rule of P70-01 exactly: documentation instructing a human to apply a
# setting is a setting that is not applied.
#
# It was worse than not-done. The units hard-coded `User=ds` and
# `/home/ds/ds-education/repo/…`, and the installation they were written for
# runs as `deploy` out of `~/Repositories/DigitalSpitalCMEModule`. A diligent
# operator following the runbook to the letter would have installed three units
# that fail on every fire — so the manual step was not merely skipped, it could
# not have succeeded.
#
# Now the deploy writes them, from the paths it is actually running from, and
# enables them. `--check` skips this: it changes host state.
ds_install_timers() {
  local unit_dir="/etc/systemd/system"

  if ! command -v systemctl >/dev/null 2>&1; then
    log "No systemd on this host — skipping timer installation."
    log "  Backups and the watchdog will NOT run. Schedule these by hand:"
    log "    ${SCRIPT_DIR}/dsc run --rm backup database"
    log "    ${SCRIPT_DIR}/watchdog.sh"
    return 0
  fi

  # `sudo -n`: non-interactive. A deploy that stops to ask for a password is a
  # deploy that hangs in CI, and the SSH session it runs in has no terminal.
  local sudo=""
  if [[ "$(id -u)" != "0" ]]; then
    if sudo -n true 2>/dev/null; then
      sudo="sudo -n"
    else
      printf '\033[1;33m!!\033[0m %s\n' \
        "Cannot write ${unit_dir} without a password, so the backup and watchdog timers were NOT installed." >&2
      printf '\033[1;33m!!\033[0m %s\n' \
        "Run once, as a user who can: sudo ${SCRIPT_DIR}/deploy.sh --install-timers" >&2
      return 0
    fi
  fi

  local user="${SUDO_USER:-$(id -un)}"
  log "Installing systemd units as user=${user} dir=${SCRIPT_DIR}"

  # Written from the real paths, every time. A unit that drifted from the
  # checkout is the same class of defect as a Caddyfile the container never
  # re-read (§9.9a) — so this rewrites rather than skipping when present.
  ds_write_unit() {
    local name="$1"
    $sudo tee "${unit_dir}/${name}" >/dev/null
  }

  ds_write_unit ds-backup.service <<UNIT
[Unit]
Description=DS Education — database and object backup
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
User=${user}
WorkingDirectory=${SCRIPT_DIR}
ExecStart=${SCRIPT_DIR}/dsc run --rm backup database
ExecStart=${SCRIPT_DIR}/dsc run --rm backup objects
TimeoutStartSec=7200
OnFailure=ds-watchdog.service
UNIT

  ds_write_unit ds-backup.timer <<'UNIT'
[Unit]
Description=DS Education — nightly backup

[Timer]
OnCalendar=*-*-* 02:15:00
RandomizedDelaySec=300
Persistent=true

[Install]
WantedBy=timers.target
UNIT

  ds_write_unit ds-backup-verify.service <<UNIT
[Unit]
Description=DS Education — is there a recent, restorable backup?
After=docker.service

[Service]
Type=oneshot
User=${user}
WorkingDirectory=${SCRIPT_DIR}
ExecStart=${SCRIPT_DIR}/dsc run --rm backup verify
OnFailure=ds-watchdog.service
UNIT

  ds_write_unit ds-backup-verify.timer <<'UNIT'
[Unit]
Description=DS Education — backup freshness check

[Timer]
OnCalendar=*-*-* 08:00:00
OnCalendar=*-*-* 16:00:00
Persistent=true

[Install]
WantedBy=timers.target
UNIT

  ds_write_unit ds-watchdog.service <<UNIT
[Unit]
Description=DS Education — is anything broken, and does anybody know?
After=docker.service

[Service]
Type=oneshot
User=${user}
WorkingDirectory=${SCRIPT_DIR}
EnvironmentFile=-${CONFIG_FILE}
ExecStart=${SCRIPT_DIR}/watchdog.sh
UNIT

  ds_write_unit ds-watchdog.timer <<'UNIT'
[Unit]
Description=DS Education — service watchdog

[Timer]
# Every two minutes. The incident it exists for lasted twenty-two hours; the
# cost of asking is two `docker` calls, and the heartbeat it sends when healthy
# is what tells an external service the host is still alive.
OnBootSec=2min
OnUnitActiveSec=2min

[Install]
WantedBy=timers.target
UNIT

  $sudo systemctl daemon-reload
  $sudo systemctl enable --now ds-backup.timer ds-backup-verify.timer ds-watchdog.timer

  log "Timers installed and enabled:"
  systemctl list-timers 'ds-*' --no-pager 2>/dev/null | sed 's/^/    /' || true

  if [[ -z "${ALERT_WEBHOOK_URL:-}" ]]; then
    printf '\033[1;33m!!\033[0m %s\n' \
      "ALERT_WEBHOOK_URL is empty: the watchdog will find problems and report them to a log file nobody reads." >&2
  fi
  if [[ -z "${HEARTBEAT_URL:-}" ]]; then
    printf '\033[1;33m!!\033[0m %s\n' \
      "HEARTBEAT_URL is empty: nothing outside this host will notice if the host itself stops." >&2
  fi
}

ds_install_timers
