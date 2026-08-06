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

printf '\n%s passed, %s failed\n' "$passed" "$failed"
[[ "$failed" == "0" ]]
