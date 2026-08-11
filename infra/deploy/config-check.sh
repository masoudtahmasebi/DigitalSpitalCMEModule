#!/usr/bin/env bash
#
# Telling "the API said no" apart from "the check never ran" (P49-02).
#
# ## The failure
#
# ```
# ==> Checking the API's configuration
# unknown flag: --no-build
# xx the API refuses this configuration — see the message above.
#    Nothing has been changed: no backup taken, no migration run, no container
#    swapped. Fix the value in /home/deploy/ds-education/config.env
# ```
#
# Every word after the first line is wrong. The API said nothing; `docker
# compose run` rejected a flag this host's compose does not have, and P45-01
# treated *any* non-zero exit as a configuration rejection. So a broken check
# blamed a correct `config.env`, and the operator's next move was to go and edit
# a file that had nothing wrong with it.
#
# That is the same shape as P44-03, one layer in: a diagnostic that names the
# wrong thing is worse than no diagnostic, because it is followed.
#
# ## The three outcomes, and why only one of them stops a deploy
#
#   invalid      the API parsed its environment and refused it. Stop: the
#                container would crash-loop, and stopping now means no backup
#                taken and no migration run.
#   old-image    this image predates `dist/check-config.js` — a `--rollback` to
#                a commit from before P45-01. Not a problem; carry on.
#   unavailable  the check itself could not run. **Carry on, loudly.** The API
#                still validates at boot, `deploy.sh` still refuses to swap a
#                container that will not start, and P44-03 still dumps its log.
#                Blocking here would mean a deploy-tooling problem stopping a
#                deployment that is otherwise fine — which is exactly what
#                happened, and cost a release.
#
# Sourced by `deploy.sh`; tested by `config-check.test.sh`, which needs no
# docker because the classification is a pure function of what came back.

# Echo one of: invalid | old-image | unavailable | ok
#
# Arguments:
#   $1  the exit status of the check container
#   $2  everything it wrote, stdout and stderr together
ds_classify_config_check() {
  local status="$1" output="$2"

  [[ "$status" == "0" ]] && { echo "ok"; return 0; }

  # The API's own words. `loadConfig` throws `Invalid configuration:` and lists
  # the offending variables by path — matching that string, rather than any
  # failure, is the whole point of this function.
  if [[ "$output" == *"Invalid configuration"* ]]; then
    echo "invalid"
    return 0
  fi

  # Node could not find the entrypoint: an image built before it existed.
  if [[ "$output" == *"Cannot find module"* ]]; then
    echo "old-image"
    return 0
  fi

  # Anything else — an unknown compose flag, a daemon that went away, a missing
  # image. Not the API's verdict, and not something to blame config.env for.
  echo "unavailable"
}
