#!/usr/bin/env bash
# `watchdog.sh`, driven where it goes quiet (P194-01).
#
# ## Why this file exists
#
# The watchdog's job is to notice. Both ways it can fail to are silent by
# construction: every `compose` call redirects stderr away so a transient docker
# error cannot kill the run, and check 1 turns a failure into `|| true` and then
# iterates over an empty list. A host with every container down and a watchdog
# that cannot read the compose file produce the same output — nothing.
#
# So these cases drive it with `docker` replaced by a stub, and assert what it
# *says* rather than what it returns. There is no daemon and no stack; the
# property under test is the reporting, which is the half that was wrong.
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
    printf '  FAIL %s\n    expected to contain: %s\n    actual:\n%s\n' "$what" "$needle" "$haystack" >&2
  fi
}

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# A `docker` that fails the way compose fails on a missing SECRETS_KMS_KEY:
# non-zero, with the reason on stderr and nothing on stdout.
mkdir -p "${work}/bin"
cat > "${work}/bin/docker" <<'STUB'
#!/usr/bin/env bash
echo "error while interpolating services.api.environment.SECRETS_KMS_KEY: required variable SECRETS_KMS_KEY is missing a value" >&2
exit 1
STUB
chmod +x "${work}/bin/docker"

# --- 1. no host configuration: it refuses instead of reporting ---------------
#
# The state that produced the defect. A watchdog that cannot read the host's
# files cannot see the stack, and saying "no problems" about it is worse than
# saying nothing (§9.6).
mkdir -p "${work}/empty-state"
out="$(PATH="${work}/bin:$PATH" DS_STATE_DIR="${work}/empty-state" bash ./watchdog.sh 2>&1)"
rc=$?
check "an unreadable host configuration is a non-zero exit" 1 "$rc"
contains "it names the file it could not read" "config.env" "$out"
contains "it says the fault is its own, not the platform's" "fault in the watchdog" "$out"

# --- 2. configured, but compose answers nothing ------------------------------
#
# This is the case that was silent. With both files present the watchdog gets
# past the load and runs its census — which the stub fails. Check 1's `|| true`
# swallows it, so without the guard the census contributes zero problems and
# the only complaint is check 2's, which blames the API.
mkdir -p "${work}/state"
cat > "${work}/state/config.env" <<'ENV'
BASE_DOMAIN=example.test
POSTGRES_DB=ds_education
POSTGRES_SUPERUSER=postgres
ENV
cat > "${work}/state/secrets.env" <<'ENV'
POSTGRES_SUPERUSER_PASSWORD=pw
SECRETS_KMS_KEY=kms-key-for-tests
ENV

out="$(PATH="${work}/bin:$PATH" DS_STATE_DIR="${work}/state" bash ./watchdog.sh 2>&1)"
contains "a census that could not run is reported as a problem" \
  "no containers at all" "$out"

printf 'watchdog: %d passed, %d failed\n' "$passed" "$failed"
[[ "$failed" -eq 0 ]]
