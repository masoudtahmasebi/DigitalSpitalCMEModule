#!/usr/bin/env bash
#
# The watchdog's backup rule (P182-03).
#
# The case that earns the file is the first one below: everything green, backup
# green, **nothing reported** — because on the old watchdog that was the answer
# for a failed backup too, and it was the answer it sent to the external
# heartbeat. A test that only asserted the failures would have been green on the
# broken system (§9.7); the pairs here assert both directions of every rule.
#
# Run: ./infra/deploy/backup-state.test.sh   (CI and `pnpm verify` both run it)

set -Eeuo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

# shellcheck source=./backup-state.sh
source ./backup-state.sh

passed=0
failed=0

NOW=1757000000 # a fixed clock, so "26 hours ago" means the same thing for ever
HOUR=3600

# check <name> <expected-count> <expected-substring-or-empty> <args...>
check() {
  local name="$1" expect_count="$2" expect_text="$3"
  shift 3

  local output count
  output="$(ds_backup_state_problems "$@")"
  if [[ -z "$output" ]]; then count=0; else count="$(printf '%s\n' "$output" | wc -l)"; fi

  if [[ "$count" -ne "$expect_count" ]]; then
    printf 'FAIL  %-52s expected %s problem(s), got %s:\n%s\n' \
      "$name" "$expect_count" "$count" "${output:-  (none)}" >&2
    failed=$((failed + 1))
    return
  fi
  if [[ -n "$expect_text" && "$output" != *"$expect_text"* ]]; then
    printf 'FAIL  %-52s expected text %q, got:\n%s\n' "$name" "$expect_text" "$output" >&2
    failed=$((failed + 1))
    return
  fi
  passed=$((passed + 1))
}

# --- The healthy installation, which must stay silent ------------------------
#
# If this one ever reports, the watchdog alarms every two minutes for ever and
# somebody turns it off — which is how a monitoring system stops monitoring.
check "healthy: backed up two hours ago" 0 "" \
  "$NOW" active success "$((NOW - 2 * HOUR))" success "$((NOW - 4 * HOUR))"

check "healthy: 26 hours, the largest normal gap" 0 "" \
  "$NOW" active success "$((NOW - 26 * HOUR))" success "$((NOW - 4 * HOUR))"

# --- The four ways it goes wrong ---------------------------------------------

# The one the whole file is for: the nightly run failed, everything else is fine,
# and before P182-03 this produced a heartbeat saying the host was healthy.
check "the nightly backup failed" 1 "did not succeed" \
  "$NOW" active exit-code "$((NOW - 26 * HOUR))" success "$((NOW - 4 * HOUR))"

# `deploy.sh --install-timers` could not get a root password, so the install
# finished, the site serves traffic, and nothing is being backed up.
check "the timer was never armed" 1 "no backup is being taken" \
  "$NOW" inactive success "$((NOW - 2 * HOUR))" success "$((NOW - 4 * HOUR))"

check "systemd does not know the timer" 1 "no backup is being taken" \
  "$NOW" "" success "$((NOW - 2 * HOUR))" success "$((NOW - 4 * HOUR))"

# A fresh host, or one where the unit has never completed once.
check "never backed up" 1 "has ever completed" \
  "$NOW" active success "" success ""

check "never backed up, epoch zero" 1 "has ever completed" \
  "$NOW" active success 0 success ""

# The silent one. Nothing failed; the timer simply stopped firing — a host that
# was off, a timer somebody disabled to do maintenance and did not re-enable.
check "31 hours, one missed night" 1 "31 hours ago" \
  "$NOW" active success "$((NOW - 31 * HOUR))" success "$((NOW - 4 * HOUR))"

check "a week with nothing failing" 1 "168 hours ago" \
  "$NOW" active success "$((NOW - 168 * HOUR))" success "$((NOW - 4 * HOUR))"

# The backup writes happily into a bucket that is not keeping them. This is the
# fact `backup verify` exists to establish, and its failure had the same fate as
# the backup's own.
check "the freshness check failed" 1 "freshness check did not succeed" \
  "$NOW" active success "$((NOW - 2 * HOUR))" exit-code "$((NOW - 4 * HOUR))"

# --- Several at once ---------------------------------------------------------
#
# The real shape of a bad morning: the timer is off, so the last success is old
# and there is nothing scheduled to change that.
check "timer off and the copy is stale" 2 "" \
  "$NOW" inactive success "$((NOW - 100 * HOUR))" success "$((NOW - 4 * HOUR))"

check "everything at once" 3 "" \
  "$NOW" failed exit-code "" success ""

# --- The boundary, to the second ---------------------------------------------
#
# 30 h is the threshold and the arithmetic behind it is in backup-state.sh. A
# rule whose boundary is untested is a rule with an off-by-one nobody meets
# until the one morning it matters.
check "exactly 30 hours is not yet stale" 0 "" \
  "$NOW" active success "$((NOW - 30 * HOUR))" success "$((NOW - 4 * HOUR))"

check "one second past 30 hours is stale" 1 "30 hours ago" \
  "$NOW" active success "$((NOW - 30 * HOUR - 1))" success "$((NOW - 4 * HOUR))"

printf '\nbackup-state: %s passed, %s failed\n' "$passed" "$failed"
[[ "$failed" -eq 0 ]]
