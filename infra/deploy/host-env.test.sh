#!/usr/bin/env bash
# `host-env.sh`, driven (P194-01).
#
# The property under test is the one that was wrong on the running system for
# four deploys and is invisible from the code that has it: a caller that loads
# `config.env` and not `secrets.env` cannot run `docker compose` at all, and
# the failure arrives as an interpolation error about a variable the caller
# never mentions. Every case here fails if the `secrets.env` load is removed.
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")" || exit 1

passed=0
failed=0

check() {
  local what="$1" expected="$2" actual="$3"
  if [[ "$actual" == "$expected" ]]; then
    passed=$((passed + 1))
  else
    failed=$((failed + 1))
    printf '  FAIL %s\n    expected: %s\n    actual:   %s\n' "$what" "$expected" "$actual" >&2
  fi
}

contains() {
  local what="$1" needle="$2" haystack="$3"
  if [[ "$haystack" == *"$needle"* ]]; then
    passed=$((passed + 1))
  else
    failed=$((failed + 1))
    printf '  FAIL %s\n    expected to contain: %s\n    actual: %s\n' \
      "$what" "$needle" "$haystack" >&2
  fi
}

state="$(mktemp -d)"
trap 'rm -rf "$state"' EXIT

cat > "${state}/config.env" <<'ENV'
BASE_DOMAIN=example.test
POSTGRES_DB=ds_education
POSTGRES_SUPERUSER=postgres
ENV
cat > "${state}/secrets.env" <<'ENV'
POSTGRES_SUPERUSER_PASSWORD=pw-from-secrets
SECRETS_KMS_KEY=kms-key-for-tests
ENV

# --- the path has one home ---------------------------------------------------
out="$(DS_STATE_DIR=/somewhere bash -c '. ./host-env.sh && ds_state_dir')"
check "ds_state_dir honours DS_STATE_DIR" "/somewhere" "$out"

out="$(HOME=/home/nobody bash -c 'unset DS_STATE_DIR; . ./host-env.sh && ds_state_dir')"
check "ds_state_dir falls back to ~/ds-education" "/home/nobody/ds-education" "$out"

# --- both files reach the environment ----------------------------------------
#
# `SECRETS_KMS_KEY` and `POSTGRES_SUPERUSER_PASSWORD` are the two the posture
# reads needed and did not have: the first is what `docker compose` refuses to
# interpolate without, the second is what `psql` authenticates with. Neither is
# in `config.env` and neither ever will be — they are generated, mode 600.
out="$(DS_STATE_DIR="$state" bash -c '. ./host-env.sh && ds_load_host_env && printf "%s" "${SECRETS_KMS_KEY:-MISSING}"')"
check "SECRETS_KMS_KEY is loaded from secrets.env" \
  "kms-key-for-tests" "$out"

out="$(DS_STATE_DIR="$state" bash -c '. ./host-env.sh && ds_load_host_env && printf "%s" "${POSTGRES_SUPERUSER_PASSWORD:-MISSING}"')"
check "POSTGRES_SUPERUSER_PASSWORD is loaded from secrets.env" "pw-from-secrets" "$out"

out="$(DS_STATE_DIR="$state" bash -c '. ./host-env.sh && ds_load_host_env && printf "%s" "${POSTGRES_DB:-MISSING}"')"
check "config.env is still loaded too" "ds_education" "$out"

# Exported, not merely set: `docker compose` reads the environment of the
# process, so a value that is only a shell variable interpolates as empty.
out="$(DS_STATE_DIR="$state" bash -c '. ./host-env.sh && ds_load_host_env && env | grep -c "^SECRETS_KMS_KEY="')"
check "the values are exported, not just set" "1" "$out"

# --- a missing file is named, not stepped over -------------------------------
#
# The failure this replaces was a compose error naming SECRETS_KMS_KEY, four
# layers below a caller that had asked about mail delivery. Refusing here, by
# filename, is the difference between "somebody forgot to run deploy.sh" and an
# afternoon (§9.4).
partial="$(mktemp -d)"
trap 'rm -rf "$state" "$partial"' EXIT
cp "${state}/config.env" "${partial}/config.env"

( DS_STATE_DIR="$partial" bash -c '. ./host-env.sh && ds_load_host_env' ) >/dev/null 2>&1 && rc=0 || rc=$?
check "a missing secrets.env is refused" 1 "$rc"

msg="$( ( DS_STATE_DIR="$partial" bash -c '. ./host-env.sh && ds_load_host_env' ) 2>&1 >/dev/null )"
contains "the refusal names secrets.env" "secrets.env" "$msg"
contains "the refusal says what it costs" "docker compose" "$msg"

empty="$(mktemp -d)"
( DS_STATE_DIR="$empty" bash -c '. ./host-env.sh && ds_load_host_env' ) >/dev/null 2>&1 && rc=0 || rc=$?
check "a missing config.env is refused" 1 "$rc"
msg="$( ( DS_STATE_DIR="$empty" bash -c '. ./host-env.sh && ds_load_host_env' ) 2>&1 >/dev/null )"
contains "the refusal names config.env" "config.env" "$msg"
rmdir "$empty" 2>/dev/null || true

# --- it reads, it never writes -----------------------------------------------
#
# `ds_ensure_secrets` generates what is missing, which is correct for a deploy
# and wrong for a report. A reporting command that mints a SECRETS_KMS_KEY has
# made every existing backup undecryptable to buy a status line.
before="$(find "$partial" -maxdepth 1 -mindepth 1 -printf '%f\n' | sort | tr '\n' ' ')"
( DS_STATE_DIR="$partial" bash -c '. ./host-env.sh && ds_load_host_env' ) >/dev/null 2>&1 || true
after="$(find "$partial" -maxdepth 1 -mindepth 1 -printf '%f\n' | sort | tr '\n' ' ')"
check "a failed load generates nothing" "$before" "$after"

printf 'host-env: %d passed, %d failed\n' "$passed" "$failed"
[[ "$failed" -eq 0 ]]
