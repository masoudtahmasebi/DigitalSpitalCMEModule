#!/usr/bin/env bash
#
# The deploy's loopback-issuer pattern (P101-03).
#
# ## Why this file exists
#
# Step 4b of `deploy.sh` warns about a project bound to a Keycloak on loopback,
# and it asks that question in POSIX ERE inside a `psql` call, because it runs
# before the API image does and has nothing else to hand. That makes it a
# **second implementation** of a rule whose authority is
# `packages/seed/src/keycloak-binding.ts`, and two implementations of one rule
# drift (CLAUDE.md §9.11).
#
# So both are driven over the same fixture table. The row that matters most is
# `localhost.medice.com`: a public host whose name contains "localhost", which a
# naive substring match flags and which would then warn, on every deploy, about
# a project that is perfectly fine — the fastest way to teach an operator to
# ignore a warning.
#
# `grep -E` rather than bash's `[[ =~ ]]`: both are ERE, and grep's is the
# closer of the two to what PostgreSQL's `~*` does with the identical string.
# This is not psql, and the file says so rather than implying a guarantee it
# does not have (§9.1) — the hard gate on this rule is the seed's own refusal,
# which `seeds.integration.test.ts` exercises against a real database.
#
# Run: ./infra/deploy/keycloak-issuer.test.sh   (CI and `pnpm verify` both run it)

set -Eeuo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

# The one line under test, read out of deploy.sh rather than copied here — a
# copy is a test that passes after somebody edits the thing it tests.
DS_LOOPBACK_ISSUER_RE="$(
  sed -n "s/^DS_LOOPBACK_ISSUER_RE='\(.*\)'$/\1/p" deploy.sh
)"

if [[ -z "$DS_LOOPBACK_ISSUER_RE" ]]; then
  echo "could not read DS_LOOPBACK_ISSUER_RE out of deploy.sh" >&2
  exit 1
fi

passed=0
failed=0

check() {
  local expected="$1" issuer="$2" actual="no"
  if printf '%s\n' "$issuer" | grep -qiE "$DS_LOOPBACK_ISSUER_RE"; then
    actual="yes"
  fi

  if [[ "$expected" == "$actual" ]]; then
    passed=$((passed + 1))
  else
    failed=$((failed + 1))
    printf 'FAIL  %-50s expected loopback=%s, got %s\n' "$issuer" "$expected" "$actual" >&2
  fi
}

# Loopback: no physician's browser can reach any of these, so a project bound
# to one authenticates nobody.
check yes 'http://127.0.0.1:8080/realms/ds-dev'
check yes 'http://127.0.0.1:8080/realms/ds-dev/'
check yes 'http://127.1.2.3/realms/x'
check yes 'https://127.0.0.1/realms/x'
check yes 'http://localhost:8080/realms/ds-dev'
check yes 'http://localhost/realms/x'
check yes 'HTTP://LOCALHOST:8080/realms/x'
check yes 'http://[::1]:8080/realms/ds-dev'
check yes 'https://keycloak.localhost/realms/x'

# Reachable, and must stay silent. The second is the one a substring match gets
# wrong, and a warning that cries wolf on a correct project is worse than none.
check no 'https://login.medice.com/auth/realms/medicerealm'
check no 'https://localhost.medice.com/realms/r'
check no 'https://auth.example.de/realms/medice'
check no 'https://127-0-0-1.example.com/realms/x'
check no ''

# Named, because `pnpm check:shell` runs eight of these into one stream and an
# unlabelled tally is a failure nobody can attribute to a file.
printf 'keycloak-issuer.test.sh: %d passed, %d failed\n' "$passed" "$failed"
[[ "$failed" -eq 0 ]]
