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

printf '%d passed, %d failed\n' "$passed" "$failed"
[[ "$failed" -eq 0 ]]
