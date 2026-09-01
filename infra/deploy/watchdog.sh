#!/usr/bin/env bash
#
# Is this installation actually working, and does anybody know? (P140-01)
#
# ## Why this exists
#
# On 31.08 the API container reported `unhealthy` for **twenty-two hours** while
# serving every request put to it. Nobody knew until the client opened the
# console and asked. That is not a monitoring gap in the abstract: there was no
# monitoring at all. `/metrics` is exposed and nothing scrapes it; the one alert
# channel the platform has — `ALERT_WEBHOOK_URL` — is wired to EIV deadlines and
# to nothing else.
#
# This is the smallest thing that would have caught it, and it is deliberately
# small: a shell script on a timer, using what already exists.
#
# ## The two halves, and why neither is enough alone
#
# **Local.** Container health and `/health/ready` are things only the host can
# see: "Redis is running and not answering" is invisible from outside, because
# every route that does not touch Redis keeps working. This half POSTs to
# `ALERT_WEBHOOK_URL`.
#
# **Remote.** A watchdog on a dead host reports nothing — the failure that
# silences the alarm is the failure the alarm is for. So when *everything* is
# healthy this pings `HEARTBEAT_URL`, and an external service (healthchecks.io,
# Better Stack, Cronitor — any of them) raises the alarm when the pings stop.
# The alert for "the host is gone" therefore comes from somewhere that is not
# the host, which is the only place it can honestly come from.
#
# Note the direction: the heartbeat is sent **only on success**. A watchdog that
# pinged unconditionally would report a healthy installation while it was
# failing, which is the §9.1 trap wearing running shoes.
#
# ## What it deliberately does not do
#
# Restart anything. A watchdog that restarts on unhealthy turns a recoverable
# dependency failure into a restart loop — the argument `health.service.ts`
# already makes about liveness. This one reports and stops.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
[[ -f "${DS_STATE_DIR:-$HOME/ds-education}/config.env" ]] &&
  source "${DS_STATE_DIR:-$HOME/ds-education}/config.env"

COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.prod.yml"
compose() { docker compose -f "$COMPOSE_FILE" "$@"; }

problems=()

# --- 1. Every container that should be up, is, and is healthy ---------------
#
# `docker compose ps` rather than a hand-written list of names: a service added
# to the compose file is watched without anybody remembering to add it here,
# which is the same reasoning as reading the RLS tables out of the migrations.
while IFS=$'\t' read -r name state health; do
  [[ -z "$name" ]] && continue
  if [[ "$state" != "running" ]]; then
    problems+=("${name} is ${state}")
  elif [[ "$health" == "unhealthy" ]]; then
    problems+=("${name} is running but unhealthy")
  fi
done < <(compose ps --format '{{.Service}}\t{{.State}}\t{{.Health}}' 2>/dev/null || true)

# --- 2. The API answers readiness, and says which dependency if not ---------
#
# From inside the network, so this is about the API and not about Caddy or DNS
# — those are the remote half's job. `/health/ready` and not `/health`: the
# latter answers 200 while reporting `degraded`, which is the defect P138-01
# fixed in the container probe and the same trap here.
ready_body="$(compose exec -T api node -e "
  fetch('http://127.0.0.1:3000/health/ready')
    .then(async r => { console.log(r.status, await r.text()); })
    .catch(e => { console.log('000 ' + e.message); });
" 2>/dev/null || echo "000 could not run the check")"

if [[ "$ready_body" != 200\ * ]]; then
  problems+=("API readiness: ${ready_body}")
fi

# --- 3. Report ---------------------------------------------------------------
if [[ ${#problems[@]} -gt 0 ]]; then
  summary="DS Education on $(hostname): ${#problems[@]} problem(s)"
  detail="$(printf '%s\n' "${problems[@]}")"

  # Always to the journal, so `journalctl -u ds-watchdog` is a record even when
  # no webhook is configured. The unit's non-zero exit is what systemd reports.
  printf '%s\n%s\n' "$summary" "$detail" >&2

  if [[ -n "${ALERT_WEBHOOK_URL:-}" ]]; then
    # `text` is what Slack and Teams both read; the rest is for anything that
    # parses JSON properly. No credential and no URL from config appears here.
    payload="$(printf '{"text":%s,"host":%s,"problems":%s}' \
      "$(printf '%s' "${summary}: ${detail//$'\n'/; }" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')" \
      "$(printf '%s' "$(hostname)" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')" \
      "${#problems[@]}")"
    curl -fsS --max-time 10 -X POST -H 'content-type: application/json' \
      -d "$payload" "$ALERT_WEBHOOK_URL" >/dev/null 2>&1 ||
      printf 'watchdog: the alert webhook itself could not be reached\n' >&2
  else
    printf 'watchdog: ALERT_WEBHOOK_URL is empty — this alarm reached a log file nobody is watching\n' >&2
  fi

  exit 1
fi

# --- 4. Healthy: tell the outside world we are still here --------------------
#
# Only here. See the header: an unconditional ping is a heartbeat that says
# "fine" while the building burns.
if [[ -n "${HEARTBEAT_URL:-}" ]]; then
  curl -fsS --max-time 10 "$HEARTBEAT_URL" >/dev/null 2>&1 ||
    printf 'watchdog: healthy, but the heartbeat could not be sent\n' >&2
fi

printf 'watchdog: all services running and the API is ready\n'
