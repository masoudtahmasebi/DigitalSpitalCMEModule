#!/usr/bin/env bash
# `mail-posture.sh`, driven (P189-01).
#
# The point of extracting the query was that a string inside a workflow cannot
# be tested. These cases hold the two properties that can be wrong silently:
# the query names the columns the schema actually has and yields three
# `|`-separated fields, and the arithmetic refuses anything that is not a
# number rather than aborting the step it runs in.
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")" || exit 1
# shellcheck source=./mail-posture.sh
. ./mail-posture.sh

passed=0
failed=0

check() {
  local what="$1" expected="$2" actual="$3"
  if [[ "$actual" == "$expected" ]]; then
    passed=$((passed + 1))
  else
    printf 'FAIL  %s: expected %q, got %q\n' "$what" "$expected" "$actual" >&2
    failed=$((failed + 1))
  fi
}

# --- the query -------------------------------------------------------------
sql="$(ds_mail_posture_sql)"

# Two `|| '|' ||` concatenations means three fields. Asserted by counting,
# because a query that silently lost one would make `cut -d'|' -f2` read the
# platform's address as a count and the step would report nonsense.
check "the query yields three fields" 2 "$(grep -c "|| '|' ||" <<<"$sql")"

# The tables and columns it reads. A rename would otherwise surface as
# "unreadable" on a deploy — indistinguishable from the host being unreachable,
# which is the failure this whole ticket is about (§9.6).
for column in projects smtp_host smtp_from_address platform_smtp from_address host; do
  if grep -q "\b${column}\b" <<<"$sql"; then
    passed=$((passed + 1))
  else
    printf 'FAIL  the query does not mention %s\n' "$column" >&2
    failed=$((failed + 1))
  fi
done

# The platform's address is reported only when the sender is complete — a host
# **and** a From address. Offering an address that cannot send is §9.2.
check "the platform address is gated on a host" 1 \
  "$(grep -c "btrim(coalesce(host, '')) <> ''" <<<"$sql")"

# Never the credential.
for secret in password_enc password username; do
  if grep -q "$secret" <<<"$sql"; then
    printf 'FAIL  the query selects %s, which must never reach a log\n' "$secret" >&2
    failed=$((failed + 1))
  else
    passed=$((passed + 1))
  fi
done

# --- the arithmetic --------------------------------------------------------
check "two of five leaves three" 3 "$(ds_mail_posture_fallback_count 2 5)"
check "none of three leaves three" 3 "$(ds_mail_posture_fallback_count 0 3)"
check "all of three leaves none" 0 "$(ds_mail_posture_fallback_count 3 3)"

# The cases that must not abort the caller.
#
# In a **subshell**, and that is the whole point of these two. Without the
# numeric guard, `$(( ERROR - x ))` under `set -u` does not return non-zero — it
# kills the shell it runs in. Called directly, that took this test file down
# with it and printed nothing at all: a sabotage that produced silence rather
# than a failure, which is §9.1 in the check meant to prove the guard.
#
# The subshell turns "it crashed" into a non-zero status these cases can see,
# and it is also how the deploy calls it — a step that dies mid-read would
# report the deploy as broken rather than the question as unanswerable (§9.6).
( ds_mail_posture_fallback_count 'ERROR' 'x' ) >/dev/null 2>&1 && rc=0 || rc=$?
check "a non-numeric answer is refused rather than crashing" 1 "$rc"

( ds_mail_posture_fallback_count '' '' ) >/dev/null 2>&1 && rc=0 || rc=$?
check "an empty answer is refused rather than crashing" 1 "$rc"

printf 'mail-posture: %d passed, %d failed\n' "$passed" "$failed"
[[ "$failed" -eq 0 ]]
