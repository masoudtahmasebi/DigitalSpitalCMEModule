#!/usr/bin/env bash
#
# That every option the scripts *name* is an option the scripts *accept*
# (P144-01).
#
# The failure this file exists for, verbatim, from the host on 01.09.2026:
#
#   $ sudo .../deploy.sh --install-timers
#   xx unknown option: --install-timers
#
# The operator ran exactly what the deploy's own warning told them to run. The
# flag had never existed: `ds_install_timers` was called unconditionally at the
# end of a deploy, and its "you need root, run this instead" branch named a
# command nobody had written.
#
# That is CLAUDE.md §9.2 in a shell script — *never offer what the system will
# refuse* — and it is the same shape as `course_editor` (P38-02) and the
# self-reset button (P38-07): the offer and the acceptance live in different
# places, and nothing compared them.
#
# So this compares them, mechanically: every `--flag` appearing anywhere in the
# script's own text — usage header, `log` lines, warnings — must be handled by
# its `case`. It cannot go stale, because it derives both sides from the file.
#
# Run: ./infra/deploy/options.test.sh   (CI and `pnpm verify` both run it)

set -Eeuo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

passed=0
failed=0

fail() {
  failed=$((failed + 1))
  echo "FAIL: $*" >&2
}
pass() { passed=$((passed + 1)); }

# ---------------------------------------------------------------------------
# The two sides, both derived from the file
# ---------------------------------------------------------------------------

# Accepted: every literal in the option `case`, e.g. `--no-build)` and
# `-h|--help)`. Restricted to the parsing loop so a flag mentioned in a comment
# is not mistaken for a handler.
accepted_options() {
  local script="$1"
  awk '/^while \[\[ \$# -gt 0 \]\]; do/,/^done$/' "$script" |
    grep -oE '^[[:space:]]*(-[A-Za-z0-9|-]+\))' |
    tr -d ' )' | tr '|' '\n' | grep -E '^-' | sort -u
}

# Offered: every `--flag` the script writes anywhere in its own text.
offered_options() {
  local script="$1"
  grep -oE '(^|[^-A-Za-z0-9])--[a-z][a-z0-9-]+' "$script" |
    grep -oE '\--[a-z][a-z0-9-]+' | sort -u
}

# ---------------------------------------------------------------------------
# deploy.sh
# ---------------------------------------------------------------------------
#
# `offered` catches every flag in the file, including flags belonging to other
# programs the script invokes — `docker compose --profile`, `psql --no-align`.
# Those are not deploy.sh's to accept, so the comparison is scoped to flags that
# appear **immediately after the script's own name**, which is how a message
# tells an operator what to type.
offered_for_self() {
  local script="$1" name
  name="$(basename "$script")"
  grep -oE "${name} (--[a-z][a-z0-9-]+)" "$script" |
    grep -oE '\--[a-z][a-z0-9-]+' | sort -u
}

# shellcheck disable=SC2043 # one script today. The loop is the shape this
# check has to keep: `dsc` and `run-on-local.sh` both document options too, and
# adding either is a word here rather than a rewrite.
for script in deploy.sh; do
  accepted="$(accepted_options "$script")"

  while read -r flag; do
    [[ -n "$flag" ]] || continue
    if grep -qxF -- "$flag" <<<"$accepted"; then
      pass
    else
      fail "${script} tells an operator to run '${flag}', which its own option parser rejects"
    fi
  done <<<"$(offered_for_self "$script")"
done

# ---------------------------------------------------------------------------
# The refusal has to be actionable (§9.4)
# ---------------------------------------------------------------------------
#
# "unknown option: --x" tells somebody they mistyped. It does not tell them
# whether the feature exists, which is the question they actually have — and
# on 01.09.2026 the answer was "no", and the message did not say so.
if grep -A2 'unknown option' deploy.sh | grep -q 'Valid options:'; then
  pass
else
  fail "deploy.sh's 'unknown option' does not list the valid options"
fi

# Every option named in that list must also be accepted, or the help is a lie
# in the other direction.
listed="$(grep -A2 'unknown option' deploy.sh | grep -oE '\--[a-z][a-z0-9-]+' | sort -u)"
accepted="$(accepted_options deploy.sh)"
while read -r flag; do
  [[ -n "$flag" ]] || continue
  if grep -qxF -- "$flag" <<<"$accepted"; then
    pass
  else
    fail "deploy.sh lists '${flag}' as valid, but its option parser rejects it"
  fi
done <<<"$listed"

# ---------------------------------------------------------------------------
# And the one that started it, asserted by name
# ---------------------------------------------------------------------------
if grep -qxF -- "--install-timers" <<<"$accepted"; then
  pass
else
  fail "deploy.sh does not accept --install-timers, which ds_install_timers tells operators to run"
fi

echo "options.test.sh: ${passed} passed, ${failed} failed"
[[ "$failed" -eq 0 ]]
