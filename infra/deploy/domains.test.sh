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
  PROJECT_SLUG=medice-adhs
  PORTAL_KEYCLOAK_ISSUER=https://login.medice.de/realms/medice
  ds_derive_domains

  printf '%s\n' \
    "$API_DOMAIN" "$ADMIN_DOMAIN" "$PORTAL_DOMAIN" "$WIDGET_DOMAIN" \
    "$API_DOMAIN_URL" "$PORTAL_BASE_URL" "$WIDGET_URL" \
    "$STAFF_COOKIE_DOMAIN" "$CORS_ALLOWED_ORIGINS" \
    "$DS_ADMIN_API_BASE" "$DS_PORTAL_API_BASE" "$DS_PORTAL_REDIRECT_URI"
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
check "DS_PORTAL_REDIRECT_URI" "https://fortbildung.digitalspital.com/" "${got[11]}"

# --- the derived set passes its own checks ---------------------------------
if ( source ./domains.sh; BASE_DOMAIN=digitalspital.com; PROJECT_SLUG=medice-adhs; PORTAL_KEYCLOAK_ISSUER=https://login.medice.de/realms/medice; ds_derive_domains; ds_check_domains ) 2>/dev/null; then
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
  PROJECT_SLUG=medice-adhs
  API_DOMAIN=legacy-api.example.org
  ds_derive_domains
  printf '%s|%s' "$API_DOMAIN" "$API_DOMAIN_URL"
)
check "an explicit API_DOMAIN survives" \
  "legacy-api.example.org|https://legacy-api.example.org" "$actual"

# --- a customer's origin joins ours, it does not replace them ---------------
actual=$(
  source ./domains.sh
  BASE_DOMAIN=digitalspital.com
  PROJECT_SLUG=medice-adhs
  EXTRA_CORS_ORIGINS="https://www.medice.de"
  ds_derive_domains
  printf '%s' "$CORS_ALLOWED_ORIGINS"
)
check "EXTRA_CORS_ORIGINS is appended" \
  "https://verwaltung.digitalspital.com,https://fortbildung.digitalspital.com,https://www.medice.de" \
  "$actual"

# --- labels are overridable ------------------------------------------------
actual=$(
  source ./domains.sh
  BASE_DOMAIN=example.org
  ADMIN_LABEL="admin"
  ds_derive_domains
  printf '%s|%s' "$ADMIN_DOMAIN" "$STAFF_COOKIE_DOMAIN"
)
check "ADMIN_LABEL is honoured" "admin.example.org|.example.org" "$actual"

# --- deriving is idempotent -------------------------------------------------
# deploy.sh sources the env file and derives; a rollback may do both again.
actual=$(
  source ./domains.sh
  BASE_DOMAIN=digitalspital.com
  PROJECT_SLUG=medice-adhs
  PORTAL_KEYCLOAK_ISSUER=https://login.medice.de/realms/medice
  ds_derive_domains
  ds_derive_domains
  printf '%s' "$CORS_ALLOWED_ORIGINS"
)
check "deriving twice changes nothing" \
  "https://verwaltung.digitalspital.com,https://fortbildung.digitalspital.com" "$actual"

# --- refusals ---------------------------------------------------------------
# Each of these is a mistake somebody will make, and each would otherwise fail
# much later with a message about something else.
refuses() {
  local what="$1"; shift
  if ( source ./domains.sh; "$@"; ds_derive_domains ) >/dev/null 2>&1; then
    failed=$((failed + 1))
    echo "xx should have been refused: ${what}" >&2
  else
    passed=$((passed + 1))
  fi
}

refuses "an unset BASE_DOMAIN"       true
refuses "a URL, not a domain"        eval 'BASE_DOMAIN=https://digitalspital.com'
refuses "a domain with a port"       eval 'BASE_DOMAIN=digitalspital.com:443'
refuses "a domain with a path"       eval 'BASE_DOMAIN=digitalspital.com/cme'
refuses "a trailing dot"             eval 'BASE_DOMAIN=digitalspital.com.'
refuses "a single label"             eval 'BASE_DOMAIN=localhost'
refuses "a leading dot"              eval 'BASE_DOMAIN=.digitalspital.com'
refuses "an empty value"             eval 'BASE_DOMAIN='

# --- the checks catch what a derivation cannot ------------------------------
rejects_check() {
  local what="$1"; shift
  if ( source ./domains.sh; BASE_DOMAIN=digitalspital.com; PROJECT_SLUG=medice-adhs; PORTAL_KEYCLOAK_ISSUER=https://login.medice.de/realms/medice; "$@"; ds_derive_domains; ds_check_domains ) >/dev/null 2>&1; then
    failed=$((failed + 1))
    echo "xx ds_check_domains should have rejected: ${what}" >&2
  else
    passed=$((passed + 1))
  fi
}

# A hand-written cookie domain that is not a parent of the API: every staff
# sign-in succeeds and is then reported as an expired session.
rejects_check "a cookie domain that is not a parent" \
  eval 'STAFF_COOKIE_DOMAIN=.example.net'
rejects_check "a cookie domain without its leading dot" \
  eval 'STAFF_COOKIE_DOMAIN=digitalspital.com'
# The console loads and every request is refused by the browser.
rejects_check "a CORS list missing the portal" \
  eval 'CORS_ALLOWED_ORIGINS=https://verwaltung.digitalspital.com'
# The CSP would name an origin the API is not served from.
rejects_check "an API_DOMAIN_URL that does not match API_DOMAIN" \
  eval 'API_DOMAIN_URL=https://api.example.net'
# Caddy serves whichever block it parsed last; the other service is gone.
rejects_check "two services on one hostname" \
  eval 'PORTAL_LABEL=verwaltung'
# A slug names a row in the database and cannot be derived from a domain. The
# frontends' containers refuse to start without one, which is a restart loop
# rather than a message — so it is said here instead.
rejects_check "a missing PROJECT_SLUG" \
  eval 'PROJECT_SLUG='

# One PROJECT_SLUG covers both frontends, and a per-app value still wins.
actual=$(
  source ./domains.sh
  BASE_DOMAIN=digitalspital.com
  PROJECT_SLUG=medice-adhs
  PORTAL_KEYCLOAK_ISSUER=https://login.medice.de/realms/medice
  DS_PORTAL_PROJECT_SLUG=another-project
  ds_derive_domains
  printf '%s|%s' "$DS_ADMIN_PROJECT_SLUG" "$DS_PORTAL_PROJECT_SLUG"
)
check "PROJECT_SLUG covers both, per-app wins" "medice-adhs|another-project" "$actual"

# --- the Keycloak origin is cut from the issuer -----------------------------
# The portal's CSP names an origin; the issuer is an origin plus a realm path.
# Two spellings of the same host is how one of them ends up with `/realms/...`
# in a connect-src, where it is ignored and sign-in fails silently.
actual=$(
  source ./domains.sh
  BASE_DOMAIN=digitalspital.com
  PROJECT_SLUG=medice-adhs
  PORTAL_KEYCLOAK_ISSUER=https://login.medice.de/realms/medice
  ds_derive_domains
  printf '%s' "$KEYCLOAK_ORIGIN"
)
check "KEYCLOAK_ORIGIN is the portal issuer's origin" "https://login.medice.de" "$actual"

actual=$(
  source ./domains.sh
  BASE_DOMAIN=digitalspital.com
  PROJECT_SLUG=medice-adhs
  PORTAL_KEYCLOAK_ISSUER=http://127.0.0.1:8080/realms/ds-education
  ds_derive_domains
  printf '%s' "$KEYCLOAK_ORIGIN"
)
check "a port survives the cut" "http://127.0.0.1:8080" "$actual"

actual=$(
  source ./domains.sh
  BASE_DOMAIN=digitalspital.com
  PROJECT_SLUG=medice-adhs
  PORTAL_KEYCLOAK_ISSUER=https://login.medice.de/realms/medice
  KEYCLOAK_ORIGIN=https://sso.example.net
  ds_derive_domains
  printf '%s' "$KEYCLOAK_ORIGIN"
)
check "an explicit KEYCLOAK_ORIGIN survives" "https://sso.example.net" "$actual"

rejects_check "an issuer that yields no origin" \
  eval 'PORTAL_KEYCLOAK_ISSUER=login.medice.de/realms/medice'

rm -f /tmp/ds-domains-happy.txt

printf '\n%s passed, %s failed\n' "$passed" "$failed"
[[ "$failed" == "0" ]]
