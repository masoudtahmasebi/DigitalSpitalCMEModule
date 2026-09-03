#!/usr/bin/env bash
#
# The two guards that decide what reaches production (P155-01/02, P173, P175-01).
#
# Both rows that earn this file come from a real run rather than from reading
# the workflow: `workflow_dispatch` deployed a feature branch to production on
# 2026-09-02, and the post-deploy step read the served commit without ever
# comparing it to the one it had just installed.
#
# Run: ./infra/deploy/release-guards.test.sh   (CI and `pnpm verify` both run it)

set -Eeuo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

# shellcheck source=./release-guards.sh
source ./release-guards.sh

passed=0
failed=0

check() {
  local expected="$1" label="$2"
  shift 2
  local actual="no"
  if "$@"; then actual="yes"; fi
  if [ "$actual" = "$expected" ]; then
    passed=$((passed + 1))
  else
    failed=$((failed + 1))
    echo "xx $label: expected $expected, got $actual"
  fi
}

# ---------------------------------------------------------------------------
# Which event may deploy
# ---------------------------------------------------------------------------

check yes "CI on main deploys" \
  ds_release_ref_allowed workflow_run refs/heads/main main main

# ---------------------------------------------------------------------------
# The rows P173-01 earns: a `workflow_run` deploy is judged by the branch CI
# actually ran on, never by this run's own ref.
#
# Deploy runs 103–105 on 2026-09-03 each fired from a push to
# `claude/education-platform-roadmap-3vgrqh`, deploying a feature-branch commit
# to production, while the workflow's `branches: [main]` filter and this file's
# own comment both said that could not happen.
# ---------------------------------------------------------------------------

check no "CI on a feature branch does not deploy, whatever this run's ref says" \
  ds_release_ref_allowed workflow_run refs/heads/main main \
  claude/education-platform-roadmap-3vgrqh

check no "nor does CI on a branch merely prefixed with the default branch" \
  ds_release_ref_allowed workflow_run refs/heads/main main main-hotfix

check no "nor does a triggering run whose branch is unknown" \
  ds_release_ref_allowed workflow_run refs/heads/main main ""

check yes "and the triggering branch may carry the refs/heads/ prefix" \
  ds_release_ref_allowed workflow_run refs/heads/main main refs/heads/main

check no "CI on main does not deploy to a repository whose default is trunk" \
  ds_release_ref_allowed workflow_run refs/heads/trunk trunk main

check no "an event nobody has thought about is refused, not waved through" \
  ds_release_ref_allowed push refs/heads/main main main

# ---------------------------------------------------------------------------
# The row P175-01 earns, and it cost a refused deploy to find.
#
# The workflow fed this function `github.event.repository.default_branch`, and
# on this repository that is not `main` — it is the feature branch. So the first
# real run printed
#
#     TRIGGERING_BRANCH: main
#     DEFAULT_BRANCH:    claude/education-platform-roadmap-3vgrqh
#
# and refused a deploy of `main` for not being the default branch. The manual
# arm, reading the same expression, would have done the opposite: allowed a
# hand-picked deploy of the feature branch and refused `main`.
#
# The parameter is the **deploy branch** for that reason. What reaches
# production is a decision this repository makes in one literal, not a
# repository setting somebody can change in a dropdown.
# ---------------------------------------------------------------------------

check yes "CI on main deploys whatever the repository default happens to be" \
  ds_release_ref_allowed workflow_run \
  refs/heads/claude/education-platform-roadmap-3vgrqh main main

check no "and the feature branch does not, even when it is the repository default" \
  ds_release_ref_allowed workflow_run \
  refs/heads/claude/education-platform-roadmap-3vgrqh main \
  claude/education-platform-roadmap-3vgrqh

check no "a manual run of the repository default is refused when it is not the deploy branch" \
  ds_release_ref_allowed workflow_dispatch \
  refs/heads/claude/education-platform-roadmap-3vgrqh main
check yes "a manual run from main deploys — rollback needs this" \
  ds_release_ref_allowed workflow_dispatch refs/heads/main main
check yes "a manual run naming the branch without the ref prefix" \
  ds_release_ref_allowed workflow_dispatch main main

# The row this file exists for. Run 33615653131 did exactly this.
check no "a manual run from a feature branch is refused" \
  ds_release_ref_allowed workflow_dispatch \
  refs/heads/claude/education-platform-roadmap-3vgrqh main
check no "a manual run from a tag is refused" \
  ds_release_ref_allowed workflow_dispatch refs/tags/v1.2.3 main
check no "a branch merely starting with the default branch's name is refused" \
  ds_release_ref_allowed workflow_dispatch refs/heads/main-hotfix main

# The default branch is a parameter, not a literal: a repository that renames
# it must not silently lose the guard.
check yes "honours a differently named default branch" \
  ds_release_ref_allowed workflow_dispatch refs/heads/trunk trunk
check no "and refuses main when the default branch is not main" \
  ds_release_ref_allowed workflow_dispatch refs/heads/main trunk

# ---------------------------------------------------------------------------
# Did the host actually take the commit
# ---------------------------------------------------------------------------

check yes "the short commit /health reports is a prefix of the deployed SHA" \
  ds_release_commit_matches cc65b7a282b0797cc586677698ecc6153a3fc09e cc65b7a
check yes "identical full SHAs match" \
  ds_release_commit_matches cc65b7a282b0797cc586677698ecc6153a3fc09e \
  cc65b7a282b0797cc586677698ecc6153a3fc09e

# The case the whole check exists for: the deploy swapped nothing and the API
# is still serving the previous release.
check no "a stale commit is a mismatch" \
  ds_release_commit_matches cc65b7a282b0797cc586677698ecc6153a3fc09e d1a351f
check no "an API that reports no commit fails rather than passing" \
  ds_release_commit_matches cc65b7a282b0797cc586677698ecc6153a3fc09e ""
check no "an empty expected SHA fails" \
  ds_release_commit_matches "" cc65b7a
check no "a one-character 'commit' cannot match everything" \
  ds_release_commit_matches cc65b7a282b0797cc586677698ecc6153a3fc09e c
check no "a matching tail is not a match — the prefix is anchored" \
  ds_release_commit_matches cc65b7a282b0797cc586677698ecc6153a3fc09e 3fc09e1

echo
if [ "$failed" -gt 0 ]; then
  echo "release-guards.test.sh: $passed passed, $failed failed"
  exit 1
fi
echo "release-guards.test.sh: $passed passed, 0 failed"
