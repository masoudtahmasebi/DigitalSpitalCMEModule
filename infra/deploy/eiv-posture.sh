#!/usr/bin/env bash
# Will this installation file real Punktemeldungen? (P194-03)
#
# ## Why this file exists
#
# The answer decides whether the post-deploy journey runs. The journey publishes
# an accredited Fortbildung and completes it, which queues a submission whose
# VNR is reserved and belongs to no Veranstaltung — so on an installation that
# reports for real, every deploy would file a refusal against the Ärztekammer
# and raise an alert somebody has to dismiss, for ever.
#
# That decision used to be a `bash -lc '…'` string inside an `ssh "…"` inside a
# YAML block scalar in deploy.yml: the query, the environment, the three-field
# split and the verdict, in one expression nothing could test. Two of those
# parts were wrong at once — the environment was missing `secrets.env` so the
# query never ran (host-env.sh), and an apostrophe in a default word killed two
# further deploys (P193-01). Neither is visible in a string; both are ordinary
# in a file with a test beside it.
#
# ## What it prints
#
#   yes <endpoint>|<armed>|<consent>     the worker will file for real
#   no  <endpoint>|<armed>|<consent>     it will not
#   yes unreadable:<why>                 the question could not be answered
#
# The third is the important one. An unreadable answer and an armed installation
# are not the same fact, and a guard that renders them identically is §9.6 in a
# workflow. It fails **closed** — the journey does not run — because the
# alternative is driving a Fortbildung to completion on a host that might be
# filing against real physicians' EFNs, and a guard that fails open on its own
# confusion is not a guard. But it says which of the two it saw, so nobody
# spends another four deploys guessing.
#
# The verdict itself is `ds_eiv_worker_will_file_live` in eiv-endpoint.sh —
# the same function `deploy.sh` uses. Two spellings of "is the worker armed" is
# precisely what would let a smoke test run against a host that files for real.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=./eiv-endpoint.sh
. "${SCRIPT_DIR}/eiv-endpoint.sh"

# Split and judge. Separate from the I/O above so the test can drive it with a
# settings string and no host at all — the part that was untestable before.
#
# `cut -f2` rather than another `%%`/`##` pair: the middle field of three needs
# both ends trimmed, and nesting those expansions is how the YAML version became
# unreadable.
ds_eiv_posture_verdict() {
  local settings="$1" mock="${2:-}"
  local endpoint armed consent
  endpoint="${settings%%|*}"
  armed="$(printf %s "$settings" | cut -d'|' -f2)"
  consent="${settings##*|}"

  if ds_eiv_worker_will_file_live "$endpoint" "$armed" "$consent" "$mock"; then
    printf 'yes %s' "$settings"
  else
    printf 'no %s' "$settings"
  fi
}

# Sourced for the function alone by the test; run for the answer by the deploy.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  # `host-query.sh` loads the environment and owns the connection. Its stderr is
  # the diagnosis; keep the tail of it, because compose warns first and fails
  # last (P189-03).
  err_file="$(mktemp)"
  trap 'rm -f "$err_file"' EXIT

  settings="$("${SCRIPT_DIR}/host-query.sh" eiv 2>"$err_file")" || settings=""

  if [[ -z "$settings" ]]; then
    said="$(tr -d '\n' <"$err_file" | tail -c 300)"
    # Two statements, never `${said:-…}`: the default word inside
    # `${parameter:-word}` is its own quoting context, so an apostrophe in it
    # opens a quote even inside double quotes (P193-01).
    if [[ -z "${said// /}" ]]; then said="nothing on stderr either"; fi
    printf 'yes unreadable:%s' "$said"
    exit 0
  fi

  # `EIV_MOCK_BASE_URL` comes from the host's own config.env, which
  # host-query.sh has already loaded into *its* process and not this one. Read
  # it here the same way, so the verdict sees what the worker sees.
  # shellcheck source=./host-env.sh
  . "${SCRIPT_DIR}/host-env.sh"
  ds_load_host_env >/dev/null 2>&1 || true

  ds_eiv_posture_verdict "$settings" "${EIV_MOCK_BASE_URL:-}"
fi
