#!/bin/sh
#
# Write /config.js at container start, from the environment (P16-02).
#
# ## Why the frontends are configured at runtime and not at build time
#
# Vite inlines `import.meta.env.VITE_*` into the bundle, so every value the
# console and the portal need — which API to call, which project, which
# Keycloak client — used to be baked into the image. Three consequences, and the
# third is the one that made this worth changing:
#
#  1. **The image was environment-specific.** Staging and production were two
#     builds of the same commit, and a rollback had to find the right one.
#  2. **Moving a domain meant a rebuild.** Not a config change and a restart —
#     a full CI run, for a string.
#  3. **The values lived in a different place from the domain they had to
#     agree with.** They were GitHub repository *variables* (`ADMIN_API_BASE`,
#     `PORTAL_API_BASE`, `PORTAL_REDIRECT_URI`), while the hostnames were lines
#     in a GitHub *secret*. Nothing checked that the two matched, and when they
#     did not the symptom was a console whose every request failed CORS — a
#     browser-side failure with no server-side trace.
#
# Now there is one `BASE_DOMAIN` on the host, `domains.sh` derives the origins
# from it, and this script hands them to the browser at container start. The
# same image runs anywhere.
#
# ## Why the values are validated rather than escaped
#
# This writes JavaScript. A value containing a quote or a `<` would end the
# string or the script tag, and the content comes from a deployment's
# environment — not attacker-controlled, but "not attacker-controlled today" is
# how injection vectors are described right up until they are.
#
# Escaping is the fiddly answer. The robust one is an allow-list: these values
# are origins, slugs and URLs, all of which live comfortably inside a small
# character set, and anything outside it is a typo worth refusing loudly. So a
# rejected value stops the container rather than producing a subtly broken page.
#
# ## Why a missing value stops the container
#
# The alternative is a frontend that loads and then fails every request. The
# apps do detect an incomplete config and say so (`readConfig` returns
# undefined), but a container that will not start is noticed by the deploy
# script in seconds, and a page that says "misconfigured" is noticed by whoever
# opens it next — possibly a physician.

set -eu

target="${DS_CONFIG_PATH:-/usr/share/nginx/html/config.js}"

# The partial file is inside the web root, so a refusal that left it behind
# would publish a half-written config at /config.js.tmp. Removed on every exit
# path; the successful one has already renamed it away.
trap 'rm -f "$target.tmp"' EXIT INT TERM

# Origins, slugs and URLs. Deliberately excludes quotes, backslash, angle
# brackets, whitespace and control characters — everything that could end a
# JavaScript string or an HTML element.
valid() {
  printf '%s' "$1" | grep -Eq '^[A-Za-z0-9:/._@?=&#+~%,-]*$'
}

# `name=value` pairs collected into the object below. Every value is checked
# before it is written; there is no path from the environment to the file that
# skips this.
emit() {
  name="$1"
  value="$2"
  required="$3"

  if [ -z "$value" ]; then
    if [ "$required" = "required" ]; then
      echo "ds-runtime-config: ${name} is empty and is required." >&2
      echo "  The deploy derives it from BASE_DOMAIN — see infra/deploy/domains.sh." >&2
      exit 1
    fi
    return 0
  fi

  if ! valid "$value"; then
    # The value is not printed. It is not a secret — nothing here is — but a
    # log line that echoes an unvalidated string into a terminal is the same
    # class of mistake this function exists to prevent.
    echo "ds-runtime-config: ${name} contains characters that are not allowed" >&2
    echo "  in a URL, an origin or a slug. Expected something like https://api.example.com" >&2
    exit 1
  fi

  printf '  %s: "%s",\n' "$name" "$value" >> "$target.tmp"
}

{
  echo "/* Generated at container start by ds-runtime-config.sh. Do not edit. */"
  echo "window.__DS_CONFIG__ = {"
} > "$target.tmp"

# The one both apps need.
emit apiBase "${DS_API_BASE:-}" required

# `projectSlug` was required here and is now written only when it is set.
#
# ## Why this crash-looped the console and the portal (P44-01)
#
# Nothing supplied it. `docker-compose.prod.yml` gives `admin` and `portal`
# exactly one variable, `DS_API_BASE`; `DS_PROJECT_SLUG` was never in the
# compose file, never in `config.env.example` and never derived by
# `domains.sh`. So this line ran `exit 1` on every container start, which is
# `Restarting (1)` in `docker ps` and — because `caddy` depends on them —
# a deploy that reports the *API* as the thing that failed.
#
# ## Why it is not simply added to compose instead
#
# Because nothing reads it any more, and has not since P21-03/P22-03. The
# console picks its customer from what the operator can actually reach, and the
# portal takes its tenant from the first path segment — `/medice`, `/ds` — which
# is the whole reason one installation can serve several. `readConfig` in both
# apps returns `{ apiBase }` and nothing else; `apps/admin/src/config.ts` even
# carries the comment explaining why `projectSlug` was removed.
#
# So this was a required value that no deployment supplied and no code consumed:
# CLAUDE.md §9.3, a rule written and never enforced, in the one position where
# the enforcement was a container that would not start.
#
# Still emitted when present, because a host adapter embedding the widget may
# legitimately pin one — `scripts/check-runtime-config.mjs` asserts that every
# `required` value here is one compose actually provides, so this cannot drift
# back.
emit projectSlug "${DS_PROJECT_SLUG:-}" optional

# The portal's Keycloak client. Absent in the admin console's container, which
# has not spoken to Keycloak since P12-06 (ADR-0012) — so these are optional
# here rather than duplicated into a second, nearly identical script.
emit issuer "${DS_KEYCLOAK_ISSUER:-}" optional
emit clientId "${DS_KEYCLOAK_CLIENT_ID:-}" optional
emit redirectUri "${DS_REDIRECT_URI:-}" optional

echo "};" >> "$target.tmp"

# Atomic: a browser that fetched /config.js midway through the write would get
# a truncated object and a syntax error, on a file with no cache to fall back on.
mv "$target.tmp" "$target"

echo "ds-runtime-config: wrote ${target}"
