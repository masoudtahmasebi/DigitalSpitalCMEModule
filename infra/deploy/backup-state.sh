#!/usr/bin/env bash
#
# Is a backup actually being taken, and would anybody find out if it stopped?
# (P182-03)
#
# ## The defect this is for, which was in the units themselves
#
# `ds-backup.service` and `ds-backup-verify.service` both carry
# `OnFailure=ds-watchdog.service`. That reads as "a failed backup raises the
# alarm", and it does not, because of what the watchdog checks: containers,
# `/health/ready`, and callers queued for a database connection. A backup that
# cannot reach the bucket leaves every one of those green.
#
# So the sequence was:
#
#   1. the nightly backup fails;
#   2. systemd starts the watchdog because of `OnFailure=`;
#   3. the watchdog finds nothing wrong — correctly, nothing it looks at *is*
#      wrong;
#   4. it exits 0, and **sends the heartbeat**.
#
# The failure of the backup therefore produced an *affirmative* signal to the
# external monitor that the installation was healthy. That is CLAUDE.md §9.1 in
# its purest form: a gate that is green because of what it is not scanning,
# wired to a trigger that made it look deliberate. `OnFailure=` stays — it makes
# the report immediate rather than up to two minutes late — but it is no longer
# what the report depends on, because the watchdog now asks this question on its
# own schedule.
#
# ## Why systemd's own state, and not `backup verify`
#
# `dsc run --rm backup verify` starts a container, reaches the object store and
# lists it. That is the right check twice a day and the wrong one every two
# minutes: sixty times an hour it would spend a container start and a network
# round trip to re-learn something systemd already knows for free.
#
# What systemd knows is also the more honest question. `backup verify` asks "is
# there a recent object in the bucket", which stays true for a day and a half
# after the mechanism that writes them has died. These four facts ask "is the
# thing that takes backups still running, and did it work" — which goes false
# the first morning, not the second.
#
# The two are complements and both are checked: a green unit whose upload
# silently went nowhere is exactly what `backup verify` is for, and its own
# failure is fact four here.
#
# ## Pure, so it can be tested
#
# The function below reads nothing and calls nothing. `watchdog.sh` gathers the
# six values from `systemctl` and passes them in; `backup-state.test.sh` passes
# in a table. Otherwise the only way to test "the backup has not run since
# Tuesday" is to have a host where it has not run since Tuesday.

# The oldest a successful backup may be before it is a problem.
#
# Arithmetic, not a number that sounds right: `ds-backup.timer` is
# `OnCalendar=*-*-* 02:15:00` with `RandomizedDelaySec=300`, so two consecutive
# successes are at most 24 h 5 min apart, and the run itself may take up to the
# unit's `TimeoutStartSec=7200` (2 h). 24:05 + 2:00 = 26 h 5 min is the largest
# healthy gap. 30 h leaves just under four hours of slack — enough for a host
# that was down over the backup window and came back, and short enough that a
# single missed night is reported the same morning rather than the next one.
DS_BACKUP_MAX_AGE_SECONDS=$((30 * 3600))

# ds_backup_state_problems NOW TIMER_ACTIVE BACKUP_RESULT BACKUP_LAST VERIFY_RESULT VERIFY_LAST
#
#   NOW            epoch seconds
#   TIMER_ACTIVE   `systemctl is-active ds-backup.timer` — "active" when armed
#   BACKUP_RESULT  `systemctl show ds-backup.service -p Result --value`
#   BACKUP_LAST    epoch seconds of the last successful finish, "" if never
#   VERIFY_RESULT  the same for ds-backup-verify.service
#   VERIFY_LAST    the same, unused today but read so the caller cannot forget
#                  to gather it when a rule wants it
#
# Prints one problem per line, none when there is nothing to say. Always
# returns 0 — the caller counts lines, so that "no problems" and "the function
# broke" are not the same exit code.
ds_backup_state_problems() {
  local now="$1" timer_active="$2" backup_result="$3" backup_last="$4"
  local verify_result="$5" verify_last="${6:-}"

  : "${verify_last}" # gathered deliberately; see the header

  # 1. Is anything scheduled at all?
  #
  # The failure this catches is not exotic: `deploy.sh --install-timers` needs a
  # root password, and when it cannot get one it says so and carries on (P144).
  # An installation can therefore be complete, serving traffic, and taking no
  # backups — which is the state every installation of this platform was in
  # until somebody read the deploy log.
  if [[ "$timer_active" != "active" ]]; then
    printf 'the nightly backup timer is %s — no backup is being taken\n' \
      "${timer_active:-unknown}"
  fi

  # 2. Did the last run fail?
  #
  # `Result` is systemd's verdict on the most recent invocation and stays
  # `success` on a unit that has never run, so "never run" is question 3's.
  if [[ -n "$backup_result" && "$backup_result" != "success" ]]; then
    printf 'the last nightly backup did not succeed (systemd Result=%s)\n' \
      "$backup_result"
  fi

  # 3 and 4. When did one last work?
  if [[ -z "$backup_last" || "$backup_last" == "0" ]]; then
    printf 'no nightly backup has ever completed on this host\n'
  elif ((now - backup_last > DS_BACKUP_MAX_AGE_SECONDS)); then
    printf 'the newest backup finished %s hours ago\n' \
      "$(((now - backup_last) / 3600))"
  fi

  # 5. The twice-daily check that the bucket holds what it should.
  #
  # Its own failure is a separate fact from the backup's: the backup can run
  # green while writing to a bucket that discards it, and that is the case this
  # one exists for.
  if [[ -n "$verify_result" && "$verify_result" != "success" ]]; then
    printf 'the backup freshness check did not succeed (systemd Result=%s)\n' \
      "$verify_result"
  fi

  return 0
}

# Reads the six facts from systemd. Prints them tab-separated, in the order
# `ds_backup_state_problems` takes them after NOW.
#
# Separate from the rule so that the rule is testable and this is the only part
# that needs a real host. Prints nothing and returns 1 where there is no
# systemd — a developer's laptop and the e2e rig both, and neither is a host
# whose backups anybody should be told about.
ds_backup_state_facts() {
  command -v systemctl >/dev/null 2>&1 || return 1
  systemctl show ds-backup.service >/dev/null 2>&1 || return 1

  local timer_active backup_result backup_last verify_result verify_last

  timer_active="$(systemctl is-active ds-backup.timer 2>/dev/null || true)"
  backup_result="$(systemctl show ds-backup.service -p Result --value 2>/dev/null || true)"
  verify_result="$(systemctl show ds-backup-verify.service -p Result --value 2>/dev/null || true)"

  # `ExecMainExitTimestamp` is when the last invocation *finished*, whatever it
  # finished with — so it is only a successful backup's time when `Result` says
  # the run succeeded. Reporting a failed run's timestamp as "the newest backup"
  # is how a broken installation looks fresh.
  backup_last="$(ds_backup_state_epoch ds-backup.service "$backup_result")"
  verify_last="$(ds_backup_state_epoch ds-backup-verify.service "$verify_result")"

  printf '%s\t%s\t%s\t%s\t%s\n' \
    "$timer_active" "$backup_result" "$backup_last" "$verify_result" "$verify_last"
}

# The finish time of a unit's last run, as epoch seconds, but only when that run
# succeeded. Empty otherwise, which the rule reads as "never".
ds_backup_state_epoch() {
  local unit="$1" result="$2" stamp
  [[ "$result" == "success" ]] || return 0
  stamp="$(systemctl show "$unit" -p ExecMainExitTimestamp --value 2>/dev/null || true)"
  [[ -n "$stamp" ]] || return 0
  date -d "$stamp" +%s 2>/dev/null || true
}
