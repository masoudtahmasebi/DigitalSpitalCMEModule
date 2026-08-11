#!/usr/bin/env bash
#
# Which API image a one-shot container should run (P43-03).
#
# ## Why this is a decision and not a constant
#
# There is no registry (ADR-0013): images are built on the host and tagged with
# the commit they were built from. `dsc` derives `DS_COMMIT` from the clone it
# is standing in, which is the right answer for `./dsc ps` — it describes the
# checkout — and the wrong one for `./dsc seed`, because a checkout can be ahead
# of what is deployed and usually is.
#
# What happened without this: `git pull` moved the clone to a commit whose image
# did not exist, `docker compose run` quietly built it — forty seconds of the
# whole API compiling, from the wrapper whose header says it deliberately does
# not deploy — and then ran a seed from a *different build* than the API beside
# it. Both halves are bad, and the second is worse: a seed writes rows the
# running API reads, so the schema it expects has to be the running one.
#
# So the rule is: **use an image that is already on this disk, prefer the
# checkout's, fall back to what is running, never build.** The fallback is the
# interesting half — it is what makes `./dsc seed` describe reality rather than
# intent, and it prints the discrepancy rather than papering over it.
#
# Sourced by `dsc`; tested by `images.test.sh` against a stub `docker`.

# Echo the tag to run, or return 1 when this host has no API image at all.
#
# Arguments:
#   $1  path to the compose file
#   $2  the tag to prefer — the clone's commit
#
# Writes nothing but the tag to stdout: the caller substitutes it, so a stray
# `echo` here would become part of an image name.
ds_resolve_image_tag() {
  local compose_file="$1" wanted="$2"

  if docker image inspect "ds-education/api:${wanted}" >/dev/null 2>&1; then
    echo "${wanted}"
    return 0
  fi

  # The *running* container's image, not `docker compose images` — that reports
  # on this compose project's containers and the question is what is serving
  # traffic. Both `ps -q` and `inspect` are allowed to fail: on a host where the
  # stack has never come up there is no container, which is a legitimate answer
  # ("no image") rather than an error to propagate.
  local container running
  container="$(docker compose -f "${compose_file}" ps -q api 2>/dev/null || true)"
  if [[ -n "$container" ]]; then
    running="$(docker inspect --format '{{ index .Config.Image }}' "$container" 2>/dev/null || true)"
    if [[ "$running" == ds-education/api:* ]]; then
      echo "${running#ds-education/api:}"
      return 0
    fi
  fi

  return 1
}
