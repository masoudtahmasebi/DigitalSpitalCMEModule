#!/usr/bin/env bash
# `eiv-posture.sh`'s verdict, driven (P194-03).
#
# This decision — does the post-deploy journey run against this host — lived in
# a shell string inside YAML and so had never been executed by anything but a
# deploy. These cases are the field-splitting and the closed failure, which are
# the two halves that can be wrong without the log looking any different.
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")" || exit 1
# shellcheck source=./eiv-posture.sh
. ./eiv-posture.sh

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

# --- the three fields are split the way psql emits them ----------------------
#
# `-tAX` prints `live|t|t`. The middle field needs trimming at both ends, and
# getting it with nested `%%`/`##` is what made the YAML version unreadable —
# so the case that matters is the one where all three fields differ.
check "an armed, consented live installation files for real" \
  "yes live|t|t" "$(ds_eiv_posture_verdict 'live|t|t')"

check "the worker switched off does not file" \
  "no live|f|t" "$(ds_eiv_posture_verdict 'live|f|t')"

# Consent is a separate switch from the register, and it is the one a person
# gives. An armed worker pointed at the live register without it must not file.
check "no live consent does not file" \
  "no live|t|f" "$(ds_eiv_posture_verdict 'live|t|f')"

check "the test register does not file for real" \
  "no test|t|t" "$(ds_eiv_posture_verdict 'test|t|t')"

# `mock` is only safe when a mock URL is actually configured. Pointed at
# nothing, it resolves to no host at all, which is not loopback and not the
# EIV test host — so it fails closed. That is deliberate (`about:unknown` in
# `ds_eiv_endpoint_url`): a typo that resolved to the mock would report "not
# live" for the one setting nobody has checked.
check "the mock register with a mock URL does not file for real" \
  "no mock|t|t" "$(ds_eiv_posture_verdict 'mock|t|t' 'http://127.0.0.1:8080')"

check "the mock register with no mock URL fails closed" \
  "yes mock|t|t" "$(ds_eiv_posture_verdict 'mock|t|t')"

# --- the fields are read from the right positions ----------------------------
#
# Both cases below are green whatever the verdict does with the *first* field —
# an endpoint word is never `t`, so misreading it as the armed flag gives the
# same answer. What they catch is reading either flag from the wrong *end*,
# which is the mistake the nested `${settings%%|*}` / `${settings##*|}` pair in
# the old YAML string was one edit away from at all times:
#
#   * `live|f|t` — armed taken from the last field would see `t` and file.
#   * `live|t|f` — consent taken from the middle would see `t` and file.
#
# Both are asserted above as ordinary rules; named here so the next person
# knows they are load-bearing and does not merge them into one case.

printf 'eiv-posture: %d passed, %d failed\n' "$passed" "$failed"
[[ "$failed" -eq 0 ]]
