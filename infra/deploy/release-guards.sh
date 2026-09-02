#!/usr/bin/env bash
#
# What may reach production, and how a deploy proves it arrived (P155-01/02).
#
# `deploy.yml` already had most of the release chain: `workflow_run` on CI,
# restricted to `main`, gated on `conclusion == 'success'`, serialised by a
# `concurrency` group, behind the `production` environment, and deploying
# `github.event.workflow_run.head_sha` — the exact commit CI ran against.
#
# Two things it did not have, and both were found by looking at a real run
# rather than at the file.
#
# ## 1. `workflow_dispatch` walked around all of it
#
# The job's condition read
#
#     if: github.event_name == 'workflow_dispatch' ||
#         github.event.workflow_run.conclusion == 'success'
#
# so a manual run satisfied it on any ref, with no CI at all. Run
# 33615653131, 2026-09-02T09:43:19Z, deployed **a feature branch** —
# `claude/education-platform-roadmap-3vgrqh` at `010fea6a` — to production, and
# reported success. Nobody did anything wrong: the button offered it.
#
# A manual deploy still has to exist (that is how a rollback runs, and how an
# operator recovers when Actions is having a bad day). What it must not be is a
# way to put an unreviewed branch on the production host by choosing it from a
# dropdown. So: manual runs are allowed from the default branch only.
#
# ## 2. The post-deploy check read the served commit and never compared it
#
# The smoke step fetched `/health`, pulled `commit` out of it, and printed it in
# the job summary. Its own comment explained why that number matters — *"a
# deploy that swapped nothing would still let this job report the commit it was
# triggered for"* — and then no line compared the two. A deploy that swapped
# nothing was green. §9.1: a check that cannot go red is not evidence, and this
# one had the right sentence and no assertion under it.
#
# That is the whole of "merged but not visible": the workflow could not answer
# *which commit is this host serving?* even though it was holding the answer.
#
# Pure functions, in their own file, because `release-guards.test.sh` has to be
# able to drive them — the logic that decides what reaches production is exactly
# the logic that must be able to fail in a test.

# May this event deploy to production?
#
#   ds_release_dispatch_allowed <event_name> <ref> <default_branch>
#
# Prints nothing. Returns 0 when the deploy may proceed.
ds_release_dispatch_allowed() {
  local event="$1" ref="$2" default_branch="${3:-main}"

  # A `workflow_run` deploy has already been gated by the workflow's own
  # `branches:` filter and its `conclusion == 'success'` condition. It is the
  # ordinary path and needs nothing further here.
  [ "$event" != "workflow_dispatch" ] && return 0

  # A manual run carries whatever ref the person picked in the dropdown.
  [ "$ref" = "refs/heads/${default_branch}" ] && return 0
  [ "$ref" = "$default_branch" ] && return 0

  return 1
}

# Does the running API report the commit this deploy tried to install?
#
#   ds_release_commit_matches <expected_sha> <served_commit>
#
# `/health` reports a short SHA and the workflow holds the full one, so this
# compares on the shorter of the two — a prefix match anchored at the start,
# never a substring. An empty served commit is a mismatch, not a pass: an API
# that cannot say what it is running is the case this exists for.
ds_release_commit_matches() {
  local expected="$1" served="$2" n

  [ -n "$expected" ] || return 1
  [ -n "$served" ] || return 1

  # Refuse a suspiciously short "commit" rather than letting `a` match anything.
  [ "${#served}" -ge 7 ] || return 1

  n="${#served}"
  [ "${#expected}" -lt "$n" ] && n="${#expected}"

  [ "${expected:0:$n}" = "${served:0:$n}" ]
}
