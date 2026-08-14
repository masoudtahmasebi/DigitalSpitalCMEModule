#!/usr/bin/env bash
#
# Tests for the "is Caddy serving this checkout's Caddyfile" check (P74-07).
#
# Bash rather than vitest, for the same reason `domains.test.sh` is: the thing
# under test is what runs on the production host, and a TypeScript
# reimplementation would leave the one that actually runs untested.
#
# The case that earned this file: a deploy on 14.08 pulled a Caddyfile with a
# new `media-src`, reported success, and Caddy went on serving the policy it
# had read at its last restart — because the file is a bind mount and
# `compose up -d` does not recreate a container for a changed mounted file.
# Every header, route and redirect ever changed in that file had the same fate.
#
# **Every assertion is made in this shell.** A `check` called inside `( … )`
# increments a counter the parent never sees, so a failing case would leave
# `failed` at zero and the suite green — a check that cannot go red, which is
# the exact §9.1 shape this file exists to prevent elsewhere. Values are
# produced in a subshell; only the value comes back.
#
# Run: ./infra/deploy/caddy-config.test.sh   (CI runs it in the lint job)

# shellcheck disable=SC1091

set -Eeuo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

source ./caddy-config.sh

passed=0
failed=0

check() {
  local what="$1" expected="$2" actual="$3"
  if [[ "$expected" == "$actual" ]]; then
    passed=$((passed + 1))
  else
    failed=$((failed + 1))
    printf 'xx %s\n   expected: %s\n   actual:   %s\n' "$what" "$expected" "$actual" >&2
  fi
}

fixture="$(mktemp)"
trap 'rm -f "$fixture"' EXIT

cat >"$fixture" <<'CADDY'
{$ADMIN_DOMAIN} {
	import baseline
	header Content-Security-Policy "default-src 'self'; media-src 'self' {$S3_ORIGIN}; connect-src 'self' {$API_DOMAIN_URL} {$S3_ORIGIN}"
	reverse_proxy admin:80
}

{$PORTAL_DOMAIN} {
	header Content-Security-Policy "default-src 'self'; media-src 'self' https:"
	reverse_proxy portal:80
}

{$WIDGET_DOMAIN} {
	reverse_proxy widget:80
}
CADDY

# --- placeholder expansion -------------------------------------------------

actual=$(
  export S3_ORIGIN="https://nbg1.your-objectstorage.com"
  export API_DOMAIN_URL="https://api.example.de"
  ds_expected_csp ADMIN_DOMAIN "$fixture"
)
check "expands every placeholder it finds" \
  "default-src 'self'; media-src 'self' https://nbg1.your-objectstorage.com; connect-src 'self' https://api.example.de https://nbg1.your-objectstorage.com" \
  "$actual"

# An installation with no bucket. Caddy expands an unset placeholder to
# nothing, so the directive collapses — and the check must expect exactly that
# rather than a literal `{$S3_ORIGIN}` no server would ever send.
actual=$(
  unset S3_ORIGIN API_DOMAIN_URL || true
  ds_expected_csp ADMIN_DOMAIN "$fixture"
)
check "collapses an unset placeholder the way Caddy does" \
  "default-src 'self'; media-src 'self'; connect-src 'self'" \
  "$actual"

# --- reading the right block ----------------------------------------------

check "reads the portal's own policy, not the admin block above it" \
  "default-src 'self'; media-src 'self' https:" \
  "$(ds_expected_csp PORTAL_DOMAIN "$fixture")"

check "says nothing for a site that declares no policy" \
  "" \
  "$(ds_expected_csp WIDGET_DOMAIN "$fixture")"

check "says nothing for a site that is not in the file" \
  "" \
  "$(ds_expected_csp NO_SUCH_DOMAIN "$fixture")"

# --- normalisation, which must not paper over a real difference ------------

check "treats a header's whitespace as insignificant" \
  "default-src 'self'; media-src 'self'" \
  "$(ds_normalise_policy "  default-src 'self' ;  media-src 'self'  ")"

check "strips the CR a header arrives with" \
  "default-src 'self'" \
  "$(ds_normalise_policy "$(printf "default-src 'self'\r")")"

# The half that matters: normalisation forgives spacing and nothing else. A
# missing directive must still compare unequal, or the whole check is
# decoration.
served="$(ds_normalise_policy "default-src 'self'; connect-src 'self'")"
expected="$(ds_normalise_policy "default-src 'self'; media-src 'self'; connect-src 'self'")"
check "does not forgive a missing directive" \
  "different" \
  "$([[ "$served" == "$expected" ]] && echo same || echo different)"

# And the exact instance that got through: the file gained a `media-src` and
# the server was still answering without one.
expected=$(
  export S3_ORIGIN="https://nbg1.your-objectstorage.com"
  export API_DOMAIN_URL="https://api.example.de"
  ds_expected_csp ADMIN_DOMAIN "$fixture"
)
stale="$(ds_normalise_policy "default-src 'self'; connect-src 'self' https://api.example.de https://nbg1.your-objectstorage.com")"
check "catches the stale policy that shipped on 14.08" \
  "different" \
  "$([[ "$stale" == "$expected" ]] && echo same || echo different)"

# --- the real Caddyfile, so the fixture cannot drift from it ---------------
#
# A fixture is a model of the file. These assert the model still applies to the
# thing being modelled: the admin block really does declare a policy, and it
# really does name the bucket in `media-src` — the directive whose absence
# produced the report.
real=$(
  export S3_ORIGIN="https://storage.example"
  export API_DOMAIN_URL="https://api.example.de"
  ds_expected_csp ADMIN_DOMAIN ./Caddyfile
)
check "the admin site in the real Caddyfile declares a policy" \
  "yes" "$([[ -n "$real" ]] && echo yes || echo no)"

check "and that policy lets the console load media from the bucket" \
  "yes" \
  "$([[ "$real" == *"media-src 'self' https://storage.example"* ]] && echo yes || echo no)"

real_portal=$(ds_expected_csp PORTAL_DOMAIN ./Caddyfile)
check "the portal's policy is read as its own, not the admin's" \
  "yes" \
  "$([[ -n "$real_portal" && "$real_portal" != "$real" ]] && echo yes || echo no)"

if [[ "$failed" == "0" ]]; then
  printf '%s passed, 0 failed\n' "$passed"
else
  printf '%s passed, %s failed\n' "$passed" "$failed" >&2
fi
[[ "$failed" == "0" ]]
