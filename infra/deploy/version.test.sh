#!/usr/bin/env bash
#
# Tests for the release number (P47-01).
#
# The case that earns this file is the **shallow clone**. `git rev-list --count`
# on one returns the clone depth: a plausible small number, silently wrong, and
# *lower* than the last full-clone deploy produced — so a version would go
# backwards and the footer would report a regression that did not happen.
# `actions/checkout` is shallow by default, so this is one `fetch-depth` away at
# all times.
#
# Real git repositories rather than stubs: the thing under test is what git
# reports, and a stubbed `git` would be a test of the stub.
#
# Run: ./infra/deploy/version.test.sh   (CI and `pnpm verify` both run it)

# shellcheck disable=SC1091

set -Eeuo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

source ./version.sh

passed=0
failed=0

check() {
  local what="$1" expected="$2" actual="$3"
  if [[ "$expected" == "$actual" ]]; then
    passed=$((passed + 1))
  else
    failed=$((failed + 1))
    echo "FAIL: ${what}" >&2
    echo "  expected: ${expected}" >&2
    echo "  actual:   ${actual}" >&2
  fi
}

work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT

# A repository with a known number of commits and a known package version.
origin="${work}/origin"
mkdir -p "$origin"
git -C "$origin" init -q
git -C "$origin" config user.email "test@example.com"
git -C "$origin" config user.name "Test"
printf '{\n  "version": "2.7.0"\n}\n' > "${origin}/package.json"
for n in 1 2 3 4 5; do
  echo "$n" > "${origin}/file"
  git -C "$origin" add -A
  git -C "$origin" commit -qm "commit ${n}"
done

# ---------------------------------------------------------------------------
# major.minor from package.json, patch from the commit count
# ---------------------------------------------------------------------------
(
  ds_derive_version "$origin"
  check "derives major.minor.count" "2.7.5" "${DS_VERSION}"
)
passed=$((passed + 1))

# ---------------------------------------------------------------------------
# It goes up, which is the entire point
# ---------------------------------------------------------------------------
(
  ds_derive_version "$origin"
  before="${DS_VERSION}"
  echo "six" > "${origin}/file"
  git -C "$origin" add -A
  git -C "$origin" commit -qm "commit 6"
  ds_derive_version "$origin"
  check "increments on a new commit" "2.7.6" "${DS_VERSION}"
  check "the previous value was lower" "2.7.5" "${before}"
)
passed=$((passed + 1))

# ---------------------------------------------------------------------------
# A shallow clone is refused, not answered wrongly
#
# Without the guard this returns 1 — the clone depth — and the deployment
# appears to go from 2.7.6 back to 2.7.1.
# ---------------------------------------------------------------------------
shallow="${work}/shallow"
git clone -q --depth 1 "file://${origin}" "$shallow" 2>/dev/null

if (ds_derive_version "$shallow" >/dev/null 2>&1); then
  failed=$((failed + 1))
  echo "FAIL: derived a version from a shallow clone (it would be the depth)" >&2
else
  passed=$((passed + 1))
fi

# And the message has to name the fix, not just the problem.
if (ds_derive_version "$shallow" 2>&1 >/dev/null || true) | grep -q -- "--unshallow"; then
  passed=$((passed + 1))
else
  failed=$((failed + 1))
  echo "FAIL: the shallow-clone refusal does not say how to fix it" >&2
fi

# ---------------------------------------------------------------------------
# Not a checkout at all
# ---------------------------------------------------------------------------
mkdir -p "${work}/plain"
if (ds_derive_version "${work}/plain" >/dev/null 2>&1); then
  failed=$((failed + 1))
  echo "FAIL: derived a version outside a git checkout" >&2
else
  passed=$((passed + 1))
fi

# ---------------------------------------------------------------------------
# A package.json whose version it cannot read
# ---------------------------------------------------------------------------
broken="${work}/broken"
mkdir -p "$broken"
git -C "$broken" init -q
git -C "$broken" config user.email "test@example.com"
git -C "$broken" config user.name "Test"
printf '{\n  "name": "no-version"\n}\n' > "${broken}/package.json"
git -C "$broken" add -A
git -C "$broken" commit -qm "one"

if (ds_derive_version "$broken" >/dev/null 2>&1); then
  failed=$((failed + 1))
  echo "FAIL: invented a version from a package.json that has none" >&2
else
  passed=$((passed + 1))
fi

echo "version.test.sh: ${passed} passed, ${failed} failed"
[[ "$failed" -eq 0 ]]
