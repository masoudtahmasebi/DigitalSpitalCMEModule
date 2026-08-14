#!/usr/bin/env bash
#
# Is Caddy serving the Caddyfile in this checkout? (P74-07)
#
# ## The failure this exists to end
#
# `caddy` runs a stock image with `./Caddyfile:/etc/caddy/Caddyfile:ro` — a
# bind mount. `docker compose up -d` recreates a container when its image or
# its compose-level configuration changes, and **a changed mounted file is
# neither**. So Caddy kept serving whatever Caddyfile it read when it last
# started, and a deploy that pulled a new one reported success having applied
# none of it.
#
# Found by the post-deploy journey on 14.08. The browser said:
#
#     Refused to load media from 'https://nbg1.your-objectstorage.com/…'
#     because it violates the following Content Security Policy directive:
#     "default-src 'self'". Note that 'media-src' was not explicitly set…
#
# against a deploy whose checkout *contained* that `media-src`. CLAUDE.md §9.9
# one layer below where it is usually applied: the deploy had copied the file,
# and the process that reads it was never told.
#
# It is not one directive's problem. Every header, route and redirect ever
# changed in that file has had the same fate, and nothing said so.
#
# ## Why the check compares the served header, not the reload's exit code
#
# `caddy reload` returning 0 proves the command ran, not that the running
# server now answers differently — the §9.1 shape exactly. So `deploy.sh`
# reloads and then asks the site itself, and these are the pure functions that
# say what the answer should be.
#
# ## What it covers, and what it does not
#
# The Content-Security-Policy of each site that declares one, including a
# changed value inside an existing directive. **Not** the rest of the
# Caddyfile: a changed route or redirect is applied by the reload and is not
# verified here. Saying so is the point — a check whose reach is overstated is
# how the last several defects survived.

# Caddy's `{$VAR}` placeholders, expanded from the calling shell.
#
# In bash rather than `envsubst`, which is gettext and is not among the tools
# the preflight checks for: a deploy step that dies on a missing binary at the
# very end is worse than the defect it is checking for. An unset variable
# expands to nothing, which is what Caddy does with one too.
ds_expand_caddy_vars() {
  local text="$1" name
  while [[ "$text" =~ \{\$([A-Z0-9_]+)\} ]]; do
    name="${BASH_REMATCH[1]}"
    text="${text//\{\$${name}\}/${!name-}}"
  done
  printf '%s' "$text"
}

# Whitespace differs harmlessly between a file and a header, and a placeholder
# that expanded to nothing leaves a double space which Caddy sends as it finds
# it. Comparing raw would fail on a policy that is materially identical.
ds_normalise_policy() {
  printf '%s' "$1" | tr -d '\r' | sed 's/  */ /g; s/ ;/;/g; s/^ //; s/ $//'
}

# The policy one site block declares, expanded and normalised.
#
# The block is found by its opening `{$SITE} {` marker and read to the next
# top-level `}`, so a directive belonging to the site below is never read as
# this one's — the same bounding `apps/e2e/support/csp.ts` does for the rig.
# Empty output means that site sets no policy, which is a legitimate answer and
# not an error.
ds_expected_csp() {
  local site="$1" caddyfile="${2:-${SCRIPT_DIR:-.}/Caddyfile}" raw

  raw="$(awk -v marker="{\$${site}} {" '
    index($0, marker) == 1 { inside = 1 }
    inside && /^\}/        { exit }
    inside                 { print }
  ' "$caddyfile" | sed -n 's/.*header Content-Security-Policy "\(.*\)".*/\1/p')"

  [[ -n "$raw" ]] || return 0
  ds_normalise_policy "$(ds_expand_caddy_vars "$raw")"
}
