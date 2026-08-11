#!/usr/bin/env bash
#
# Tests for the config-check classification (P49-02).
#
# The case that earns the file is `unknown flag: --no-build` — a real failure
# from a real deploy, which the previous code reported as "the API refuses this
# configuration" and sent an operator to edit a file that was correct.
#
# No docker: the classification is a pure function of an exit status and some
# text, which is precisely why it was extracted. A test that needed a container
# to check a string comparison would not get written, and this is the string
# comparison that misdirected a release.
#
# Run: ./infra/deploy/config-check.test.sh   (CI and `pnpm verify` both run it)

# shellcheck disable=SC1091

set -Eeuo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

source ./config-check.sh

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

check "a clean exit is ok" \
  "ok" \
  "$(ds_classify_config_check 0 "check-config: this container's configuration is valid.")"

# ---------------------------------------------------------------------------
# The API's own verdict — the only outcome that stops a deploy
# ---------------------------------------------------------------------------
check "the API's refusal is a config problem" \
  "invalid" \
  "$(ds_classify_config_check 1 "Invalid configuration:
  S3_ENDPOINT: must start with https:// — a Hetzner console shows the bare host")"

# ---------------------------------------------------------------------------
# The failure that was misreported, verbatim
# ---------------------------------------------------------------------------
check "an unknown compose flag is not a config problem" \
  "unavailable" \
  "$(ds_classify_config_check 1 "unknown flag: --no-build")"

check "a stopped daemon is not a config problem" \
  "unavailable" \
  "$(ds_classify_config_check 1 "Cannot connect to the Docker daemon at unix:///var/run/docker.sock")"

check "a missing image is not a config problem" \
  "unavailable" \
  "$(ds_classify_config_check 125 "Error response from daemon: No such image: ds-education/api:abc1234")"

# ---------------------------------------------------------------------------
# A rollback to an image from before the entrypoint existed
# ---------------------------------------------------------------------------
check "an image without the entrypoint is old, not broken" \
  "old-image" \
  "$(ds_classify_config_check 1 "Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/app/dist/check-config.js'")"

# ---------------------------------------------------------------------------
# The one that must not be swallowed by the one above it
#
# An image that *has* the entrypoint but whose config names a module — an
# `Invalid configuration` mentioning a path — is still a config problem. Order
# matters in the classifier and this is what pins it.
# ---------------------------------------------------------------------------
check "a config error wins over an incidental module mention" \
  "invalid" \
  "$(ds_classify_config_check 1 "Invalid configuration:
  S3_ENDPOINT: Cannot find module semantics do not apply here")"

echo "config-check.test.sh: ${passed} passed, ${failed} failed"
[[ "$failed" -eq 0 ]]
