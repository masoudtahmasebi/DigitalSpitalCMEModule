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
# `ds_eiv_endpoint_url` — the console's three words (P180-01).
#
# The shell twin of `eivEndpointUrl`. Two implementations of one rule again, and
# the deploy has to answer the question before any TypeScript is running, so the
# fixtures below are the same ones the unit test uses.

check_url() {
  local expected="$1" choice="$2" mock="$3" actual
  actual="$(ds_eiv_endpoint_url "$choice" "$mock")"

  if [[ "$actual" == "$expected" ]]; then
    passed=$((passed + 1))
  else
    printf 'FAIL  url choice=%-8s expected %s, got %s\n' \
      "$choice" "$expected" "$actual" >&2
    failed=$((failed + 1))
  fi
}

check_url 'http://eiv-mock:4010'            mock 'http://eiv-mock:4010'
check_url 'https://backend-test.eiv-fobi.de' test 'http://eiv-mock:4010'
check_url 'https://backend.eiv-fobi.de'      live 'http://eiv-mock:4010'

# A word this file does not know is **not** treated as the mock. Resolving a
# typo to loopback would report "not live" for a setting the application will
# reject, and the guard would be silent about the one state nobody has checked.
check_url 'about:unknown' 'liv'  'http://eiv-mock:4010'
check_url 'about:unknown' ''     'http://eiv-mock:4010'
check_url 'about:unknown' 'LIVE' 'http://eiv-mock:4010'


# ---------------------------------------------------------------------------
# `ds_eiv_worker_will_file_live` — the three settings together (P107-02, P180-01).
#
# Arming the worker against the live register does not only affect the next
# physician to finish: the first sweep claims every row already `queued` or
# `failed_retryable`, so a backlog from testing against the mock goes to the
# Ärztekammer in a batch. The deploy counts them and warns, and this is the
# condition that decides whether it looks.
#
# Three settings now rather than two. `platform_settings` can hold an
# installation pointed at `live` with the worker **on** and no consent recorded
# — a state `config.env` could not express — and in it the application refuses
# every submission. Warning there would cry wolf on every deploy of a
# half-configured host, and a warning that fires when nothing will happen is one
# people learn to skip.
#
# Driving the function the deploy calls, not a copy of it beside it — a test
# that re-implemented the condition would pass on a deploy that had it
# backwards (CLAUDE.md §9.7).

# $1 expected yes|no, $2 endpoint choice, $3 worker enabled, $4 consent recorded
check_worker() {
  local expected="$1" choice="$2" worker="$3" consent="$4" actual

  if ds_eiv_worker_will_file_live "$choice" "$worker" "$consent" \
    'http://eiv-mock:4010'; then
    actual=yes
  else
    actual=no
  fi

  if [[ "$actual" == "$expected" ]]; then
    passed=$((passed + 1))
  else
    printf 'FAIL  endpoint=%-6s worker=%-6s consent=%-6s expected %s, got %s\n' \
      "$choice" "$worker" "$consent" "$expected" "$actual" >&2
    failed=$((failed + 1))
  fi
}

# The one state that warrants a warning: pointed at the live register, armed,
# and consented to.
check_worker yes live t t
check_worker yes live true true
check_worker yes live yes t

# Armed at the live register with no consent on record. The application refuses
# every submission in this state, so nothing will be filed and nothing is said.
check_worker no live t f
check_worker no live t ''

# Disarmed. The endpoint is still the live register — this is the state an
# operator configures a VNR in, and it must be quiet.
check_worker no live f t
check_worker no live '' t

# Armed and consented, but at somewhere that reaches no real record. Consent is
# meaningless here and the application ignores it; so does this.
check_worker no test t t
check_worker no mock t t

# An unrecognised word fails closed, like an unrecognised host.
check_worker yes 'liv' t t
check_worker yes '' t t

printf '%d passed, %d failed\n' "$passed" "$failed"
[[ "$failed" -eq 0 ]]
