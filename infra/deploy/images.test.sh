#!/usr/bin/env bash
#
# Tests for the image resolution `./dsc seed` runs on (P43-03).
#
# Bash rather than vitest, for the same reason `domains.test.sh` is: the thing
# under test is what runs on the production host, and a TypeScript
# reimplementation would leave the shell version untested.
#
# `docker` is stubbed on PATH. That is the whole trick and it is what makes
# these tests able to go red: the three states worth distinguishing — the
# checkout's image exists, only an older one is running, nothing exists at all —
# are states of the host's disk, and stubbing the one command that reports on
# it is how they become reachable from a test runner.
#
# Run: ./infra/deploy/images.test.sh   (CI runs it in the lint job; so does
# `pnpm verify`, because a check that only runs in CI is one the person writing
# the code does not run — CLAUDE.md §9.11.)

# shellcheck disable=SC1091

set -Eeuo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

source ./images.sh

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

# A stub `docker` whose behaviour the caller sets through two variables:
#
#   STUB_IMAGES     space-separated image references `image inspect` knows
#   STUB_RUNNING    the image reference `ps -q`/`inspect` should report, or ""
#
# Written per-case into a fresh directory rather than once, so a case cannot
# inherit the previous one's disk — the ambient-state leak CLAUDE.md §9.8
# records from the jsdom URL and, before that, from localStorage.
stub_dir="$(mktemp -d)"
trap 'rm -rf "${stub_dir}"' EXIT
cat >"${stub_dir}/docker" <<'STUB'
#!/usr/bin/env bash
set -Eeuo pipefail
case "$1 ${2:-}" in
  "image inspect")
    for known in ${STUB_IMAGES:-}; do
      [[ "$known" == "$3" ]] && exit 0
    done
    echo "Error: No such image: $3" >&2
    exit 1
    ;;
  "compose -f")
    # …ps -q api
    if [[ -n "${STUB_RUNNING:-}" ]]; then echo "container-abc123"; fi
    exit 0
    ;;
  "inspect --format")
    [[ -n "${STUB_RUNNING:-}" ]] || { echo "no such object" >&2; exit 1; }
    echo "${STUB_RUNNING}"
    exit 0
    ;;
esac
echo "unexpected docker invocation: $*" >&2
exit 99
STUB
chmod +x "${stub_dir}/docker"
PATH="${stub_dir}:${PATH}"

compose=./docker-compose.prod.yml

# ---------------------------------------------------------------------------
# The checkout's image exists — use it, which is the ordinary case
# ---------------------------------------------------------------------------
check "prefers the requested tag when its image is present" \
  "abc1234" \
  "$(STUB_IMAGES="ds-education/api:abc1234" STUB_RUNNING="" \
     ds_resolve_image_tag "$compose" abc1234)"

# ---------------------------------------------------------------------------
# The checkout is ahead of the host — use what is running, do not build
#
# This is the case that cost a debugging round. `git pull` moved the clone to
# ebab45b, no image existed for it, and compose built one: forty seconds, and a
# container from a commit that was not the one serving traffic.
# ---------------------------------------------------------------------------
check "falls back to the running container's tag" \
  "old9999" \
  "$(STUB_IMAGES="ds-education/api:old9999" STUB_RUNNING="ds-education/api:old9999" \
     ds_resolve_image_tag "$compose" ebab45b)"

# ---------------------------------------------------------------------------
# Nothing on the disk — refuse, so the caller can name `./deploy.sh`
# ---------------------------------------------------------------------------
if STUB_IMAGES="" STUB_RUNNING="" ds_resolve_image_tag "$compose" abc1234 >/dev/null 2>&1; then
  failed=$((failed + 1))
  echo "FAIL: resolves a tag on a host with no API image at all" >&2
else
  passed=$((passed + 1))
fi

# ---------------------------------------------------------------------------
# A running container that is not one of ours is not an answer
#
# Compose projects share a daemon. Reading a tag off whatever `ps` returned and
# trusting the prefix is how `./dsc seed` would end up running `postgres:16`.
# ---------------------------------------------------------------------------
if STUB_IMAGES="" STUB_RUNNING="postgres:16-alpine" \
   ds_resolve_image_tag "$compose" abc1234 >/dev/null 2>&1; then
  failed=$((failed + 1))
  echo "FAIL: accepted a non-ds-education image as the API" >&2
else
  passed=$((passed + 1))
fi

# ---------------------------------------------------------------------------
# It emits the tag and nothing else
#
# The caller substitutes the result into an image name and an `env` assignment.
# A diagnostic on stdout would become part of one.
# ---------------------------------------------------------------------------
check "emits exactly one line" \
  "1" \
  "$(STUB_IMAGES="ds-education/api:abc1234" STUB_RUNNING="" \
     ds_resolve_image_tag "$compose" abc1234 | wc -l | tr -d ' ')"

echo "images.test.sh: ${passed} passed, ${failed} failed"
[[ "$failed" -eq 0 ]]
