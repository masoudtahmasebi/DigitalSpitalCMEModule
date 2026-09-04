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

# **The state a new installation now ships in** (P188-01). Migration 0053 moved
# the endpoint default to `live`, so this exact triple is what the deploy asks
# about on every fresh host.
#
# Honestly labelled: these two rows are **defence in depth, not independent
# evidence.** Both the worker guard and the consent guard refuse this triple, so
# neutering either one alone leaves them green — verified by doing it. They fail
# only if both go, and they are kept because a reader asking "what does a new
# installation answer?" should find that question asked by name.
#
# What can go red on its own is the database fact, and it is asserted where it
# lives: `platform-settings.integration.test.ts` reads the shipped default off a
# freshly migrated database.
check_worker no live f f
check_worker no live false ''

# Armed and consented, but at somewhere that reaches no real record. Consent is
# meaningless here and the application ignores it; so does this.
check_worker no test t t
check_worker no mock t t

# An unrecognised word fails closed, like an unrecognised host.
check_worker yes 'liv' t t
check_worker yes '' t t

# ---------------------------------------------------------------------------
# ds_eiv_choice_for_url — the inverse, used by the carry-forward (P182-05)
# ---------------------------------------------------------------------------
#
# This one decides what an installation that was reporting before P180-01 is
# switched to afterwards. Getting `test` wrong points a working installation at
# nothing; getting `unknown` wrong sends a Punktemeldung somewhere nobody chose.

check_choice() {
  local expected="$1" url="$2" actual
  actual="$(ds_eiv_choice_for_url "$url")"
  if [[ "$expected" == "$actual" ]]; then
    passed=$((passed + 1))
  else
    printf 'FAIL  choice %-40s expected %s, got %s\n' "$url" "$expected" "$actual" >&2
    failed=$((failed + 1))
  fi
}

check_choice mock 'http://127.0.0.1:4010'
check_choice mock 'http://localhost:4010/fobi'
check_choice mock 'http://[::1]:4010'
check_choice mock 'http://eiv-mock:4010'
check_choice test 'https://backend-test.eiv-fobi.de'
check_choice test 'https://BACKEND-TEST.EIV-FOBI.DE/fobi/veranstalter/veranstaltung'
check_choice live 'https://backend.eiv-fobi.de'
check_choice live 'https://backend.eiv-fobi.de/fobi/veranstalter/push_teilnahme'

# Everything else is `unknown`, and the caller refuses on it rather than
# guessing. `punktemeldung.eiv-fobi.de` is the case that matters: it is treated
# as needing consent by the tier function above, and it is *not* silently
# mapped to `live` here — a URL nobody wrote down the meaning of gets a person,
# not a default.
check_choice unknown 'https://punktemeldung.eiv-fobi.de/'
check_choice unknown 'https://backend-test.eiv-fobi.de.example.com'
check_choice unknown 'https://proxy.internal'
check_choice unknown ''
check_choice unknown 'not a url'

# The two must never disagree about what is safe: anything this calls `mock` or
# `test` is exactly what the tier function lets through without consent.
for safe_url in 'http://127.0.0.1:4010' 'http://eiv-mock:4010' \
  'https://backend-test.eiv-fobi.de'; do
  choice="$(ds_eiv_choice_for_url "$safe_url")"
  if ds_eiv_requires_live_consent "$safe_url"; then
    printf 'FAIL  %s is %s but needs consent — the two disagree\n' "$safe_url" "$choice" >&2
    failed=$((failed + 1))
  else
    passed=$((passed + 1))
  fi
done

for live_url in 'https://backend.eiv-fobi.de' 'https://proxy.internal'; do
  if ds_eiv_requires_live_consent "$live_url"; then
    passed=$((passed + 1))
  else
    printf 'FAIL  %s needs consent and the tier function says otherwise\n' "$live_url" >&2
    failed=$((failed + 1))
  fi
done

# ---------------------------------------------------------------------------
# ds_eiv_truthy — how a person spelled "on" in a file written months ago
# ---------------------------------------------------------------------------
#
# Reading only `yes` would carry a *disabled* worker forward from an
# installation that was in fact reporting, and nothing on any screen would say
# so. Every spelling here has been written into a config file by somebody.

check_truthy() {
  local expected="$1" value="$2" actual="no"
  if ds_eiv_truthy "$value"; then actual="yes"; fi
  if [[ "$expected" == "$actual" ]]; then
    passed=$((passed + 1))
  else
    printf 'FAIL  truthy %-12s expected %s, got %s\n' "'$value'" "$expected" "$actual" >&2
    failed=$((failed + 1))
  fi
}

check_truthy yes yes
check_truthy yes YES
check_truthy yes Yes
check_truthy yes y
check_truthy yes true
check_truthy yes TRUE
check_truthy yes t
check_truthy yes 1
check_truthy yes on

check_truthy no no
check_truthy no false
check_truthy no f
check_truthy no 0
check_truthy no off
check_truthy no ''
check_truthy no 'yes please'

# ---------------------------------------------------------------------------
# ds_eiv_carry_plan — what the deploy does with a pre-P180 config.env (P182-05)
# ---------------------------------------------------------------------------
#
# The highest-stakes table in this file. Each row decides, for an installation
# upgrading across P180-01, whether Punktemeldungen resume, stay stopped, or —
# the row that must never exist — start flowing to the live Ärztekammer because
# a shell script inferred a consent nobody gave.

check_plan() {
  local expected="$1" worker="$2" base="$3" allow="$4" actual
  actual="$(ds_eiv_carry_plan "$worker" "$base" "$allow")"
  if [[ "$expected" == "$actual" ]]; then
    passed=$((passed + 1))
  else
    printf 'FAIL  plan w=%-5s b=%-32s a=%-4s expected %q, got %q\n' \
      "'$worker'" "'$base'" "'$allow'" "$expected" "$actual" >&2
    failed=$((failed + 1))
  fi
}

# Nothing left in the file: every deploy after the first. The table must not be
# touched here — an operator's console setting would be overwritten (§9.10b).
check_plan none '' '' ''

# The safe carries. A worker that was on stays on, at the register it was on.
check_plan 'carry test true no' yes 'https://backend-test.eiv-fobi.de' ''
check_plan 'carry test true no' true 'https://backend-test.eiv-fobi.de/fobi' ''
check_plan 'carry test true no' 1 'https://BACKEND-TEST.EIV-FOBI.DE' ''
check_plan 'carry mock true no' yes 'http://eiv-mock:4010' ''
check_plan 'carry mock true no' yes 'http://127.0.0.1:4010' ''
check_plan 'carry mock true no' yes 'http://[::1]:4010' ''

# A worker that was **off** stays off. The direction that is easy to get wrong
# and impossible to see: carrying `true` here would arm an installation whose
# operator had deliberately switched reporting off.
check_plan 'carry test false no' no 'https://backend-test.eiv-fobi.de' ''
check_plan 'carry test false no' false 'https://backend-test.eiv-fobi.de' ''
check_plan 'carry test false no' 0 'https://backend-test.eiv-fobi.de' ''
check_plan 'carry test false no' '' 'https://backend-test.eiv-fobi.de' ''

# No EIV_BASE_URL means the compiled-in default, which was the mock. Refusing
# here would stop a deploy over a variable nobody ever set.
check_plan 'carry mock true no' yes '' ''
check_plan 'carry mock false no' no '' ''

# The live register. Refused whatever else is set, and refused on the endpoint
# rather than on the flag, because the register is what decides whose record is
# touched.
check_plan 'refuse-endpoint live' yes 'https://backend.eiv-fobi.de' yes
check_plan 'refuse-endpoint live' yes 'https://backend.eiv-fobi.de' ''
check_plan 'refuse-endpoint live' no 'https://backend.eiv-fobi.de/fobi/veranstalter/push_teilnahme' ''
check_plan 'refuse-endpoint live' '' 'https://backend.eiv-fobi.de' ''

# A host this platform does not recognise fails closed the same way: it might be
# a proxy in front of the real register (P104-01).
check_plan 'refuse-endpoint unknown' yes 'https://punktemeldung.eiv-fobi.de/' ''
check_plan 'refuse-endpoint unknown' yes 'https://backend-test.eiv-fobi.de.example.com' ''
check_plan 'refuse-endpoint unknown' yes 'https://proxy.internal' ''
check_plan 'refuse-endpoint unknown' yes 'not a url' ''

# EIV_ALLOW_LIVE at a safe register: **dropped, not refused, and never carried**
# — the third field says it was found so the deploy can say so in its log.
#
# This is the case P182-05 first got wrong. The refusal it had here could only
# ever fire at `mock` or `test`, because `live` and `unknown` have already
# returned above — unreachable in the case it was written for and reachable only
# where it is wrong. And until P104-01 reaching EIV's own **test** system
# required `EIV_ALLOW_LIVE=yes`, so on an installation configured before that
# the flag means "I may talk to a non-loopback host". Blocking a deploy over a
# flag that grants nothing, at a register that files nothing, is the refusal
# §9.10 warns about: correct-sounding and unhelpful.
check_plan 'carry test true yes' yes 'https://backend-test.eiv-fobi.de' yes
check_plan 'carry test false yes' no 'https://backend-test.eiv-fobi.de' true
check_plan 'carry mock true yes' yes 'http://eiv-mock:4010' 1
check_plan 'carry mock false yes' '' '' on

# Its falsy spellings are not a flag at all, and must not be reported as one —
# a log line saying "dropped EIV_ALLOW_LIVE" for a file that said `no` is a
# false statement about what was on the host.
check_plan 'carry test true no' yes 'https://backend-test.eiv-fobi.de' no
check_plan 'carry test true no' yes 'https://backend-test.eiv-fobi.de' false
check_plan 'carry test true no' yes 'https://backend-test.eiv-fobi.de' 0

# The flag never rescues a register that is refused: the endpoint is judged
# first, whatever the flag says.
check_plan 'refuse-endpoint live' yes 'https://backend.eiv-fobi.de' yes
check_plan 'refuse-endpoint unknown' yes 'https://proxy.internal' yes

# The property that matters more than any single row: **no input produces a
# plan that carries `live`.** A row added later that did would be a real
# Punktemeldung filed by inference.
for w in yes no true false 1 0 ''; do
  for b in '' 'https://backend.eiv-fobi.de' 'https://backend-test.eiv-fobi.de' \
    'http://eiv-mock:4010' 'https://proxy.internal' 'not a url'; do
    for a in '' yes no true 1; do
      plan="$(ds_eiv_carry_plan "$w" "$b" "$a")"
      case "$plan" in
        carry\ live\ *)
          printf 'FAIL  plan carries LIVE for w=%q b=%q a=%q\n' "$w" "$b" "$a" >&2
          failed=$((failed + 1))
          ;;
        *) passed=$((passed + 1)) ;;
      esac
    done
  done
done

printf '%d passed, %d failed\n' "$passed" "$failed"
[[ "$failed" -eq 0 ]]
