#!/usr/bin/env bash
#
# Tests for the domain derivation (P16-01).
#
# Bash rather than vitest because the thing under test is what `deploy.sh`
# sources on the production host. A TypeScript reimplementation tested in
# vitest would be a second implementation, and the one that runs on the server
# would be the untested one.
#
# Run: ./infra/deploy/domains.test.sh   (CI runs it in the lint job)

# Every `source ./domains.sh` below is inside a subshell shellcheck cannot
# follow (SC1091), and the variables those subshells assign are read by the
# sourced function rather than by this file (SC2034, SC2209).
#
# SC2030/SC2031 warn that those assignments are local to their subshell. They
# are, deliberately: it is what stops one case's exports leaking into the next,
# which is the whole risk with a function that mutates its caller.
# shellcheck disable=SC1091,SC2030,SC2031,SC2034,SC2209

set -Eeuo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

passed=0
failed=0

# Each case runs in a subshell so one test's exports cannot leak into the next
# — which is the whole risk with a function that mutates its caller.
check() {
  local what="$1" expected="$2" actual="$3"
  if [[ "$expected" == "$actual" ]]; then
    passed=$((passed + 1))
  else
    failed=$((failed + 1))
    printf 'xx %s\n   expected: %s\n   actual:   %s\n' "$what" "$expected" "$actual" >&2
  fi
}

# --- the happy path, which is what production runs -------------------------
(
  # shellcheck source=./domains.sh
  source ./domains.sh
  BASE_DOMAIN=digitalspital.com
  ds_derive_domains

  printf '%s\n' \
    "$API_DOMAIN" "$ADMIN_DOMAIN" "$PORTAL_DOMAIN" "$WIDGET_DOMAIN" \
    "$API_DOMAIN_URL" "$PORTAL_BASE_URL" "$WIDGET_URL" \
    "$STAFF_COOKIE_DOMAIN" "$CORS_ALLOWED_ORIGINS" \
    "$DS_ADMIN_API_BASE" "$DS_PORTAL_API_BASE"
) > /tmp/ds-domains-happy.txt

mapfile -t got < /tmp/ds-domains-happy.txt
check "API_DOMAIN"           "api.digitalspital.com"                    "${got[0]}"
check "ADMIN_DOMAIN"         "verwaltung.digitalspital.com"             "${got[1]}"
check "PORTAL_DOMAIN"        "fortbildung.digitalspital.com"            "${got[2]}"
check "WIDGET_DOMAIN"        "widget.digitalspital.com"                 "${got[3]}"
check "API_DOMAIN_URL"       "https://api.digitalspital.com"            "${got[4]}"
check "PORTAL_BASE_URL"      "https://fortbildung.digitalspital.com"    "${got[5]}"
check "WIDGET_URL"           "https://widget.digitalspital.com/ds-lms.js" "${got[6]}"
check "STAFF_COOKIE_DOMAIN"  ".digitalspital.com"                       "${got[7]}"
check "CORS_ALLOWED_ORIGINS" \
  "https://verwaltung.digitalspital.com,https://fortbildung.digitalspital.com" "${got[8]}"
check "DS_ADMIN_API_BASE"    "https://api.digitalspital.com"            "${got[9]}"
check "DS_PORTAL_API_BASE"   "https://api.digitalspital.com"            "${got[10]}"

# --- the derived set passes its own checks ---------------------------------
if ( source ./domains.sh; BASE_DOMAIN=digitalspital.com; ds_derive_domains; ds_check_domains ) 2>/dev/null; then
  passed=$((passed + 1))
else
  failed=$((failed + 1))
  echo "xx a freshly derived configuration must pass ds_check_domains" >&2
fi

# --- an explicit value always wins -----------------------------------------
# A derivation that cannot be overridden is one you eventually have to delete.
actual=$(
  source ./domains.sh
  BASE_DOMAIN=digitalspital.com
  API_LABEL=schnittstelle
  ds_derive_domains
  printf '%s' "$API_DOMAIN"
)
check "an explicit label wins" "schnittstelle.digitalspital.com" "$actual"

rejects_check() {
  local what="$1"; shift
  if ( source ./domains.sh; BASE_DOMAIN=digitalspital.com; "$@"; ds_derive_domains; ds_check_domains ) >/dev/null 2>&1; then
    failed=$((failed + 1))
    echo "xx ds_check_domains should have rejected: ${what}" >&2
  else
    passed=$((passed + 1))
  fi
}

# --- the bare domain ------------------------------------------------------
#
# It had no default, and the consequence was a browser security error on the
# customer's own domain: no site block means Caddy has no certificate for the
# name, and the DNS points here regardless.
actual=$(
  source ./domains.sh
  BASE_DOMAIN=digitalspital.com
  ds_derive_domains
  printf '%s' "$APEX_REDIRECT_URL"
)
check "the bare domain defaults to the portal" \
  "https://fortbildung.digitalspital.com" "$actual"

actual=$(
  source ./domains.sh
  BASE_DOMAIN=digitalspital.com
  APEX_REDIRECT_URL=""
  ds_derive_domains
  printf '%s' "$APEX_REDIRECT_URL"
)
check "an empty value takes the default, not silence" \
  "https://fortbildung.digitalspital.com" "$actual"

actual=$(
  source ./domains.sh
  BASE_DOMAIN=digitalspital.com
  APEX_REDIRECT_URL=https://www.medice.de
  ds_derive_domains
  printf '%s' "$APEX_REDIRECT_URL"
)
check "an explicit destination wins" "https://www.medice.de" "$actual"

actual=$(
  source ./domains.sh
  BASE_DOMAIN=digitalspital.com
  APEX_REDIRECT_URL=none
  ds_derive_domains
  printf '%s' "$APEX_REDIRECT_URL"
)
check "'none' survives as the opt-out" "none" "$actual"

# A hostname without a scheme is the natural typo, and its failure mode is a
# Caddy block whose redirect target the browser follows to nowhere.
rejects_check "a bare hostname as the apex destination" \
  eval 'APEX_REDIRECT_URL=fortbildung.digitalspital.com'

# ---------------------------------------------------------------------------
# The object storage origin in the console's CSP (P67-01)
# ---------------------------------------------------------------------------
#
# Reported as "the video upload to s3 does not even work". The presigned PUT was
# correct; the browser refused to open the connection, because the console's
# `connect-src` named only itself and the API. Nothing reached a server, so
# nothing was in any log — the only evidence was a line in the operator's
# browser console.

actual=$(
  source ./domains.sh
  BASE_DOMAIN=digitalspital.com
  S3_ENDPOINT=https://nbg1.your-objectstorage.com
  ds_derive_domains
  printf '%s' "$S3_ORIGIN"
)
check "the bucket origin is derived from S3_ENDPOINT" \
  "https://nbg1.your-objectstorage.com" "$actual"

# The failure this shape actually has: an endpoint carrying a path. A CSP names
# origins, and the whole URL in a `connect-src` is a directive the browser reads
# as a path match — which fails in exactly the way this exists to prevent.
actual=$(
  source ./domains.sh
  BASE_DOMAIN=digitalspital.com
  S3_ENDPOINT=https://nbg1.your-objectstorage.com/dscme
  ds_derive_domains
  printf '%s' "$S3_ORIGIN"
)
check "a path on the endpoint is stripped" \
  "https://nbg1.your-objectstorage.com" "$actual"

actual=$(
  source ./domains.sh
  BASE_DOMAIN=digitalspital.com
  ds_derive_domains
  printf '%s' "${S3_ORIGIN:-<empty>}"
)
check "no bucket configured leaves the directive alone" "<empty>" "$actual"

# And the check that would have caught the deployed configuration: an origin
# that does not match the endpoint the presigned URL points at.
rejects_check "an S3_ORIGIN that does not match S3_ENDPOINT" \
  eval 'S3_ENDPOINT=https://nbg1.your-objectstorage.com; S3_ORIGIN=https://elsewhere.example'

# ---------------------------------------------------------------------------
# Derived is not the same as exported (P68-03)
# ---------------------------------------------------------------------------
#
# Every check above reads `$S3_ORIGIN` in the same shell that derived it, and
# every one of them passed while the value never reached a container. `docker
# compose` substitutes from the **environment**, so a variable that is set but
# not exported is a variable the Caddy container is handed as empty — and the
# console shipped with `connect-src 'self' https://api.…` on a host whose bucket
# was configured and whose API was minting valid presigned URLs for it.
#
# The post-deploy journey caught it in a browser. This catches it here, which is
# where the fix is. `env` rather than `${S3_ORIGIN}`, because reading the
# variable is precisely the thing that cannot tell the difference.
actual=$(
  source ./domains.sh
  BASE_DOMAIN=digitalspital.com
  S3_ENDPOINT=https://nbg1.your-objectstorage.com
  ds_derive_domains
  env | grep -c '^S3_ORIGIN=https://nbg1.your-objectstorage.com$' || true
)
check "the bucket origin is exported, not merely set" "1" "$actual"

# The same for every other value compose substitutes, so the next one to be
# derived and not exported fails here rather than in somebody's browser.
for name in API_DOMAIN ADMIN_DOMAIN PORTAL_DOMAIN WIDGET_DOMAIN API_DOMAIN_URL \
  CORS_ALLOWED_ORIGINS DS_SITES_DIR; do
  actual=$(
    source ./domains.sh
    BASE_DOMAIN=digitalspital.com
    ds_derive_domains
    env | grep -c "^${name}=" || true
  )
  check "${name} is exported" "1" "$actual"
done

rm -f /tmp/ds-domains-happy.txt

printf '\n%s passed, %s failed\n' "$passed" "$failed"
[[ "$failed" == "0" ]]
