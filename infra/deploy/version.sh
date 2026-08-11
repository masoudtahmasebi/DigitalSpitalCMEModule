#!/usr/bin/env bash
#
# The release number, which goes up on its own (P47-01).
#
# ## Why the commit was not enough
#
# `DS_COMMIT` answers "which build" exactly and answers "is this newer than
# what I saw yesterday" not at all: `0a177c7` and `e258c8d` are unordered, so
# comparing two deployments means asking git. The footer needs a number a person
# can read as *later*.
#
# ## Where the number comes from
#
#   major.minor  from the workspace's `package.json`, hand-bumped for a release
#                that means something to the client.
#   patch        `git rev-list --count HEAD` — the number of commits behind this
#                one.
#
# So `1.0.482` is "the 482nd commit on this line", and the next deploy is
# necessarily `483` or higher. Three properties earn this over the obvious
# alternatives:
#
#   * **It needs no state.** A counter in a file is a merge conflict on every
#     parallel branch and a number that lies whenever somebody forgets to bump
#     it. A git tag needs push permission from CI and a new failure mode.
#   * **It is the same everywhere.** `github.run_number` increments per workflow
#     run, so a manual `./deploy.sh` on the host could not produce a comparable
#     value — two sources of "the version" that cannot be compared is worse than
#     none.
#   * **It is deterministic.** Re-deploying a commit yields the same version,
#     which is correct: same code, same release.
#
# ## The failure this refuses rather than reports quietly
#
# `git rev-list --count` on a **shallow** clone returns the depth, not the
# history — a plausible small number, silently wrong, and decreasing relative to
# the last full-clone deploy. GitHub's `actions/checkout` is shallow by default,
# which is exactly the environment this runs near. So a shallow repository is a
# hard refusal here (CLAUDE.md §9.1: a number that cannot be trusted is worse
# than no number).
#
# Sourced by `deploy.sh` and `dsc`; tested by `version.test.sh`.

# Sets DS_VERSION, and exports it for compose.
#
# Argument: the repository root. Defaults to the directory this file lives in,
# which is inside the checkout either way.
ds_derive_version() {
  local repo="${1:-${BASH_SOURCE[0]%/*}}"

  if ! git -C "$repo" rev-parse --git-dir >/dev/null 2>&1; then
    echo "version.sh: ${repo} is not a git checkout — cannot derive a version" >&2
    return 1
  fi

  if [[ "$(git -C "$repo" rev-parse --is-shallow-repository 2>/dev/null)" == "true" ]]; then
    echo "version.sh: this is a shallow clone, so the commit count is the clone" >&2
    echo "  depth rather than the history — it would produce a version *lower*" >&2
    echo "  than the last one deployed. Run: git fetch --unshallow" >&2
    return 1
  fi

  local base count
  base="$(ds_version_base "$repo")" || return 1
  count="$(git -C "$repo" rev-list --count HEAD)"

  DS_VERSION="${base}.${count}"
  export DS_VERSION
}

# `major.minor` out of the workspace package.json, without a JSON parser.
#
# `node -p` is not used: this runs on a host where the deploy must work whether
# or not a node happens to be on the PATH — the whole point of the container
# build is that the host needs no toolchain.
ds_version_base() {
  local repo="$1" pkg version
  pkg="${repo}/package.json"

  [[ -f "$pkg" ]] || {
    echo "version.sh: no package.json at ${pkg}" >&2
    return 1
  }

  # The first `"version": "x.y.z"` in the file. The workspace root's own version
  # is at the top, above any dependency block that might carry the same key.
  version="$(sed -n 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"\([0-9]*\.[0-9]*\)\..*/\1/p' "$pkg" | head -1)"

  [[ -n "$version" ]] || {
    echo "version.sh: could not read a major.minor from ${pkg}" >&2
    return 1
  }

  printf '%s' "$version"
}
