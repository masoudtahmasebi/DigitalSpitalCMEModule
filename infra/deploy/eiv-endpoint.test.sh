#!/usr/bin/env bash
#
# The deploy's EIV endpoint rule (P104-01).
#
# Two implementations of one rule — `packages/eiv-client/src/endpoint.ts` and
# `eiv-endpoint.sh` — because the deploy runs before the API image does and has
# nothing but bash. §9.11 says that is where rules drift, so both are driven
# over the same table and the TypeScript side asserts the identical cases in
# `endpoint.test.ts`.
#
# The row that earns the file is `backend-test.eiv-fobi.de`: EIV's own test
# system, which the old `*eiv-fobi.de*` match treated as the live register. That
# forced `EIV_ALLOW_LIVE=yes` on operators doing the safe thing, and a flag you
# must disable for routine work protects nothing when it matters.
#
# Run: ./infra/deploy/eiv-endpoint.test.sh   (CI and `pnpm verify` both run it)

set -Eeuo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

# shellcheck source=./eiv-endpoint.sh
source ./eiv-endpoint.sh

passed=0
failed=0

check() {
  local expected="$1" url="$2" actual="no"
  if ds_eiv_requires_live_consent "$url"; then actual="yes"; fi

  if [[ "$expected" == "$actual" ]]; then
    passed=$((passed + 1))
  else
    printf 'FAIL  %-46s expected consent=%s, got %s\n' "$url" "$expected" "$actual" >&2
    failed=$((failed + 1))
  fi
}

# Safe: nothing reaches a real physician's record.
check no 'http://127.0.0.1:4010'
check no 'http://localhost:4010'
check no 'http://[::1]:4010'
check no 'http://eiv-mock:4010'
check no 'https://backend-test.eiv-fobi.de'
check no 'https://backend-test.eiv-fobi.de/'
check no 'https://BACKEND-TEST.EIV-FOBI.DE/fobi/veranstalter/veranstaltung'

# The live register.
check yes 'https://backend.eiv-fobi.de'
check yes 'https://backend.eiv-fobi.de/fobi/veranstalter/push_teilnahme'
check yes 'https://punktemeldung.eiv-fobi.de/'

# Unrecognised hosts fail closed: one of them might be a proxy in front of the
# real register, and guessing wrong is a correction that stays on the file.
check yes 'https://proxy.internal'
check yes 'https://backend-test.eiv-fobi.de.example.com'
check yes ''
check yes 'not a url'


# ---------------------------------------------------------------------------
# `ds_eiv_worker_will_file_live` — the two settings together (P107-02).
#
# Arming the worker against the live register does not only affect the next
# physician to finish: the first sweep claims every row already `queued` or
# `failed_retryable`, so a backlog from testing against the mock goes to the
# Ärztekammer in a batch. The deploy counts them and warns, and this is the
# condition that decides whether it looks.
#
# Driving the function the deploy calls, not a copy of it beside it — a test
# that re-implemented the condition would pass on a deploy that had it
# backwards (CLAUDE.md §9.7).

# $1 expected yes|no, $2 base URL, $3 EIV_WORKER_ENABLED
check_worker() {
  local expected="$1" url="$2" worker="$3" actual

  if ds_eiv_worker_will_file_live "$url" "$worker"; then actual=yes; else actual=no; fi

  if [[ "$actual" == "$expected" ]]; then
    passed=$((passed + 1))
  else
    printf 'FAIL  %-40s worker=%-6s expected %s, got %s\n' \
      "$url" "$worker" "$expected" "$actual" >&2
    failed=$((failed + 1))
  fi
}

# The state the client deployed in, and the only one that warrants a warning.
check_worker yes 'https://backend.eiv-fobi.de' 'yes'
check_worker yes 'https://backend.eiv-fobi.de' ''
check_worker yes 'https://punktemeldung.eiv-fobi.de/' 'yes'

# Disarmed. The endpoint is still the live register — this is the credential
# check an operator is told to run first, and it must be quiet.
check_worker no 'https://backend.eiv-fobi.de' 'no'
check_worker no 'https://punktemeldung.eiv-fobi.de/' 'no'

# Armed, but at somewhere that reaches no real record.
check_worker no 'https://backend-test.eiv-fobi.de' 'yes'
check_worker no 'http://127.0.0.1:4010' 'yes'
check_worker no 'http://eiv-mock:4010' ''

# Unrecognised hosts fail closed here too, for the same reason as above.
check_worker yes 'https://proxy.internal' 'yes'
check_worker yes '' 'yes'

# `EIV_WORKER_ENABLED` is off only on an exact "no" — the scheduler's own rule,
# spelled the same way round. A typo leaves the worker running, and a check
# that read `"yes"` as the only on-value would go silent on exactly that typo.
check_worker yes 'https://backend.eiv-fobi.de' 'No'
check_worker yes 'https://backend.eiv-fobi.de' 'false'
check_worker yes 'https://backend.eiv-fobi.de' '0'

printf '%d passed, %d failed\n' "$passed" "$failed"
[[ "$failed" -eq 0 ]]
