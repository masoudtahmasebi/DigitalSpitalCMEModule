#!/usr/bin/env bash
#
# The URL encoder, against the alphabet the generator actually emits (P18-07).
#
# ## Why this file exists
#
# The first deploy that reached the server died here:
#
#     Migration failed: Invalid URL
#
# `openssl rand -base64 32` emits `+`, `/` and `=`, and a `/` in a URL's
# userinfo **terminates the authority component**. Two connection strings were
# built by interpolating the raw value, so the migrator was rejected and the
# API's own `DATABASE_URL` would have been rejected seconds later.
#
# A comment does not catch that coming back. This does, and it checks the
# property that matters — that a real URL parser accepts the result and gets
# the original password back out — rather than that the encoder produces some
# particular string.
#
# Run: ./infra/deploy/secrets.test.sh   (CI runs it in the lint job)

set -Eeuo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

# shellcheck source=./secrets.sh
source ./secrets.sh

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

# --- the characters that broke production --------------------------------
check "a slash"     "%2F" "$(ds_url_encode '/')"
check "a plus"      "%2B" "$(ds_url_encode '+')"
check "an equals"   "%3D" "$(ds_url_encode '=')"

# --- and the ones that must survive untouched ----------------------------
#
# RFC 3986 unreserved. Encoding these would still be *correct* — a parser
# decodes them the same way — but leaving them alone keeps the common case
# readable in a `docker inspect`.
check "unreserved is left alone" \
  "abcXYZ019-._~" "$(ds_url_encode 'abcXYZ019-._~')"

check "an empty value" "" "$(ds_url_encode '')"

# --- the whole point: a parser gets the password back --------------------
#
# Ten real generated passwords, each round-tripped through a genuine URL
# parser. One in three base64 strings of this length contains a `/`, so ten is
# enough to fail reliably if the encoder is removed.
if command -v node >/dev/null 2>&1; then
  for _ in $(seq 1 10); do
    secret="$(openssl rand -base64 32)"
    encoded="$(ds_url_encode "$secret")"
    back="$(SECRET_URL="postgres://ds_app:${encoded}@postgres:5432/ds_education" \
      node -e 'const u = new URL(process.env.SECRET_URL);
               process.stdout.write(decodeURIComponent(u.password));')"
    check "a generated password survives a URL parser" "$secret" "$back"
  done
else
  echo "!! node is not available; skipping the round-trip cases" >&2
fi

# --- and the raw form is genuinely rejected ------------------------------
#
# The other half of the claim. Without this, the round-trip above would still
# pass if `ds_url_encode` were replaced by `cat` and no generated password
# happened to contain a `/`.
#
# It reproduces the production failure exactly: the parser does not misread the
# authority, it refuses the URL, with the same message the deploy printed —
# `Invalid URL`.
if command -v node >/dev/null 2>&1; then
  verdict="$(SECRET_URL='postgres://ds_app:aa/bb@postgres:5432/ds_education' \
    node -e 'try {
               new URL(process.env.SECRET_URL);
               process.stdout.write("accepted");
             } catch (error) {
               process.stdout.write(error.message);
             }')"
  check "an unencoded slash is refused, as it was in production" \
    "Invalid URL" "$verdict"
fi


# --- and `dsc` really exports them, by running it -------------------------
#
# The first attempt at this grepped `dsc` for `ds_export_url_passwords`. It
# passed with the call deleted, because the *comment* above the call names the
# function too — a test that greps for prose is not a test, and a
# deliberate-violation probe is what showed it.
#
# So this runs the wrapper against a throwaway state directory with `docker`
# stubbed on PATH, and reads back what compose would actually have been given.
# It is the only form of the check that cannot be satisfied by a comment.
probe_dsc() {
  local tmp
  tmp="$(mktemp -d)"
  # shellcheck disable=SC2064 # expand $tmp now, not at trap time
  trap "rm -rf '$tmp'" RETURN

  install -d -m 700 "$tmp/state"
  cat > "$tmp/state/config.env" <<'ENV'
BASE_DOMAIN=digitalspital.com
ACME_EMAIL=technik@digitalspital.de
POSTGRES_DB=ds_education
POSTGRES_SUPERUSER=postgres
PORTAL_PROJECT_SLUG=medice-adhs
ADMIN_DEFAULT_PROJECT_SLUG=medice-adhs
PORTAL_KEYCLOAK_ISSUER=https://login.medice.de/realms/medice
PORTAL_KEYCLOAK_CLIENT_ID=ds-portal
ENV
  chmod 600 "$tmp/state/config.env"

  # A password with every character that breaks a URL, so a wrapper that
  # forwarded the raw value would be caught as surely as one that forwarded
  # nothing.
  cat > "$tmp/state/secrets.env" <<'ENV'
POSTGRES_SUPERUSER_PASSWORD=aa/bb+cc=
DS_MIGRATOR_PASSWORD=dd/ee+ff=
DS_APP_PASSWORD=gg/hh+ii=
SECRETS_KMS_KEY=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=
ENV
  chmod 600 "$tmp/state/secrets.env"

  # `dsc` ends in `exec docker compose …`. Stubbing `docker` is what lets the
  # wrapper run to completion and report the environment it built.
  install -d "$tmp/bin"
  cat > "$tmp/bin/docker" <<'STUB'
#!/usr/bin/env bash
printf 'DS_APP_PASSWORD_URL=%s\n' "${DS_APP_PASSWORD_URL-<unset>}"
printf 'DS_MIGRATOR_PASSWORD_URL=%s\n' "${DS_MIGRATOR_PASSWORD_URL-<unset>}"
STUB
  chmod +x "$tmp/bin/docker"

  PATH="$tmp/bin:$PATH" DS_STATE_DIR="$tmp/state" ./dsc config 2>/dev/null
}

dsc_env="$(probe_dsc)"

check "dsc exports the app password, encoded" \
  "DS_APP_PASSWORD_URL=gg%2Fhh%2Bii%3D" \
  "$(printf '%s\n' "$dsc_env" | grep '^DS_APP_PASSWORD_URL=')"

check "dsc exports the migrator password, encoded" \
  "DS_MIGRATOR_PASSWORD_URL=dd%2Fee%2Bff%3D" \
  "$(printf '%s\n' "$dsc_env" | grep '^DS_MIGRATOR_PASSWORD_URL=')"

printf '\n%s passed, %s failed\n' "$passed" "$failed"
[[ "$failed" == "0" ]]
