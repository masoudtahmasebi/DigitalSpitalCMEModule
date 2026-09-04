#!/usr/bin/env bash
# Ask the running stack's database one of the posture questions (P194-02).
#
# ## Why this file exists
#
# `deploy.yml` had this assembled inline, twice: `cd`, source `config.env`,
# `docker compose exec -T postgres psql`, capture stderr, parse. Forty lines of
# shell inside an `ssh "…"` inside a `bash -lc '…'` inside a YAML block scalar,
# written out once per question — and both copies were missing `secrets.env`,
# so both had never once answered (see host-env.sh for what that error looks
# like and why it is invisible).
#
# A third question would have been a third copy with the same omission. So the
# connection is assembled in one place that can be run by hand on the host, and
# the workflow passes the name of a question.
#
# ## Usage
#
#   ./host-query.sh eiv     -> <endpoint>|<worker armed>|<live consent>
#   ./host-query.sh mail    -> <projects with own SMTP>|<projects>|<platform From>
#
# The SQL itself stays where it already lives — `ds_eiv_settings_sql` in
# eiv-endpoint.sh and `ds_mail_posture_sql` in mail-posture.sh — because those
# are the definitions deploy.sh reads too, and two spellings of "is the worker
# armed" is exactly what lets a smoke test run against a host that files real
# Punktemeldungen.
#
# ## What it prints where
#
# The answer, and only the answer, on **stdout** — a caller substitutes it
# directly. Everything else, including the reason a query failed, on stderr.
# A caller that cannot get an answer must be able to say why (§9.4); the three
# deploys that could not are what this file is for.
#
# Exit 0 with an empty stdout is a legitimate result — it means the table is not
# there yet, which is the first deploy of a migration that introduces it. Exit
# non-zero means the question could not be asked. Those are different facts and
# a caller failing closed should say which it saw (§9.6).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=./host-env.sh
. "${SCRIPT_DIR}/host-env.sh"
# shellcheck source=./eiv-endpoint.sh
. "${SCRIPT_DIR}/eiv-endpoint.sh"
# shellcheck source=./mail-posture.sh
. "${SCRIPT_DIR}/mail-posture.sh"

usage() {
  echo "usage: $(basename "$0") <eiv|mail>" >&2
  return 2
}

[ $# -eq 1 ] || usage

case "$1" in
  eiv)  sql="$(ds_eiv_settings_sql)" ;;
  mail) sql="$(ds_mail_posture_sql)" ;;
  # Named rather than passed through. A caller that can hand this script
  # arbitrary SQL is a caller that can read any table over the deploy key,
  # and the whole point is that the questions are a fixed, reviewed list.
  *)    echo "xx unknown question '$1'" >&2; usage ;;
esac

ds_load_host_env || exit 1

# `compose` interpolates the whole file, so this needs the environment above
# even though it only addresses `postgres`.
#
# stderr is captured rather than discarded, and its **tail** is what a caller
# sees: compose warns first about every variable with a default and fails last,
# so the head of the stream is noise and the end of it is the answer (P189-03).
err_file="$(mktemp)"
trap 'rm -f "$err_file"' EXIT

answer="$(docker compose -f "${SCRIPT_DIR}/docker-compose.prod.yml" exec -T \
  -e PGPASSWORD="${POSTGRES_SUPERUSER_PASSWORD}" postgres \
  psql -tAX -U "${POSTGRES_SUPERUSER}" -d "${POSTGRES_DB}" \
  -c "$sql" 2>"$err_file" | tr -d '\n' || true)"

if [ -n "$answer" ]; then
  printf '%s' "$answer"
  exit 0
fi

# No answer. Either the table is not there yet, or the query could not run —
# and the difference is in the stderr the old inline version threw away.
detail="$(grep -v 'level=warning' <"$err_file" | tail -c 400 | tr '\n' ' ')"
if [ -z "${detail// /}" ]; then
  # Empty result, nothing on stderr: the query ran and matched no rows.
  exit 0
fi

echo "xx the query ran but answered nothing usable: ${detail}" >&2
exit 1
