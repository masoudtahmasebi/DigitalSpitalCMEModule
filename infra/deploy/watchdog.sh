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

# shellcheck source=./backup-state.sh
source "${SCRIPT_DIR}/backup-state.sh"

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

# --- 3. Nobody is queued for a database connection --------------------------
#
# The leading indicator, and the one number that would have named the outage of
# 01.09.2026 in its first minute instead of its twenty-second hour (P144-01).
#
# `ds_pg_pool_waiting` counts callers queued for a pooled connection. Zero is
# normal; a brief spike under load is normal. **Sustained above zero is an
# outage forming** — it is what P141-01 (no checkout deadline), P142-01 (a
# second checkout inside a request) and P143-01 (an unbounded call holding one)
# all look like from the outside, several minutes before anybody notices a
# screen is dead.
#
# Read from inside, because `/metrics` is refused at the edge on purpose. Its
# whole value is that it needs **no connection to answer**: on the day this was
# written the API could not run `SELECT 1` and could still have reported this.
waiting="$(compose exec -T api node -e "
  fetch('http://127.0.0.1:3000/metrics')
    .then(async r => {
      const body = await r.text();
      let worst = 0;
      for (const line of body.split('\n')) {
        if (!line.startsWith('ds_pg_pool_waiting{')) continue;
        const value = Number(line.slice(line.lastIndexOf(' ') + 1));
        if (Number.isFinite(value) && value > worst) worst = value;
      }
      console.log(String(worst));
    })
    .catch(() => { console.log('unknown'); });
" 2>/dev/null | tr -d '\r' || echo unknown)"

# `unknown` is not a problem in itself: an API that cannot serve `/metrics` has
# already been reported by check 2, and reporting it twice trains people to
# ignore the alert.
if [[ "$waiting" =~ ^[0-9]+$ ]] && [[ "$waiting" -gt 0 ]]; then
  problems+=("${waiting} caller(s) queued for a database connection — the pool is saturating")
fi

# --- 4. A backup is being taken, and the last one worked --------------------
#
# The reason this is here and not left to `OnFailure=` on the backup units:
# those units *do* start the watchdog when they fail, and the watchdog had
# nothing in it that could see a backup — so it found three healthy checks,
# exited 0, and sent the heartbeat. A failed backup produced an affirmative
# "this host is fine" to the external monitor. `backup-state.sh` explains the
# sequence; its rule is tested in `backup-state.test.sh`, because a host where
# the backup has not run since Tuesday is not a fixture anybody can arrange.
#
# `ds_backup_state_facts` returns non-zero where there is no systemd — a
# developer's machine, the e2e rig — and there the question does not apply.
if facts="$(ds_backup_state_facts)"; then
  IFS=$'\t' read -r timer_active backup_result backup_last verify_result verify_last \
    <<<"$facts"
  while IFS= read -r problem; do
    # An `if`, not `[[ … ]] &&`. The AND-form leaves the whole loop with exit
    # status 1 whenever the last line read is empty, which is the normal case.
    # Verified that `set -e` does *not* exit on it here (bash 5.2 exempts a
    # loop body's status) — which is precisely why it is worth avoiding: the
    # loop would still be silently returning 1, and the day somebody moves it
    # to the end of the file that becomes the script's own exit code, and the
    # watchdog reports a failure it did not find.
    if [[ -n "$problem" ]]; then problems+=("backup: ${problem}"); fi
  done < <(ds_backup_state_problems "$(date +%s)" "$timer_active" "$backup_result" \
    "$backup_last" "$verify_result" "$verify_last")
fi

# --- 5. Report ---------------------------------------------------------------
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

# --- 6. Healthy: tell the outside world we are still here --------------------
#
# Only here. See the header: an unconditional ping is a heartbeat that says
# "fine" while the building burns.
if [[ -n "${HEARTBEAT_URL:-}" ]]; then
  curl -fsS --max-time 10 "$HEARTBEAT_URL" >/dev/null 2>&1 ||
    printf 'watchdog: healthy, but the heartbeat could not be sent\n' >&2
fi

printf 'watchdog: all services running, the API is ready, backups current\n'
