#!/usr/bin/env bash
#
# One base domain, every hostname derived from it (P16-01).
#
# ## Why this file exists
#
# The stack is four public hostnames, and eight variables used to name them:
# `API_DOMAIN`, `ADMIN_DOMAIN`, `PORTAL_DOMAIN`, `WIDGET_DOMAIN`,
# `API_DOMAIN_URL`, `PORTAL_BASE_URL`, `STAFF_COOKIE_DOMAIN` and
# `CORS_ALLOWED_ORIGINS` — plus, until this change, four GitHub *variables*
# repeating three of them in a different place with different names.
#
# Twelve values that all say "digitalspital.com" is twelve chances to say it
# differently once. The failures are not loud:
#
#   * `API_DOMAIN_URL` disagreeing with `API_DOMAIN` puts the wrong origin in a
#     Content-Security-Policy, and the console's every request is blocked by the
#     browser with no server-side trace at all.
#   * `CORS_ALLOWED_ORIGINS` missing the portal is a blank page and a red
#     console, on the frontend only, discovered by a learner.
#   * `STAFF_COOKIE_DOMAIN` not being a parent of both the console and the API
#     means every staff sign-in succeeds and is then reported as expired.
#
# So there is one value — `BASE_DOMAIN` — and this derives the rest. Anything
# set explicitly still wins, because a derivation that cannot be overridden is
# a rule you eventually have to delete.
#
# ## Sourced, not executed
#
# `source domains.sh && ds_derive_domains` mutates the caller's environment on
# purpose: `deploy.sh` exports the result to `docker compose`, and the compose
# file interpolates it. Running it as a program would derive values into a
# process that then exits.

# Derive every unset hostname variable from BASE_DOMAIN.
#
# Idempotent: running it twice changes nothing, because every assignment is
# guarded by `:-`. That matters because deploy.sh sources the env file and then
# calls this, and a rollback path may do both again.
ds_derive_domains() {
  if [[ -z "${BASE_DOMAIN:-}" ]]; then
    echo "BASE_DOMAIN is not set. It is the one domain everything else derives from," >&2
    echo "e.g. BASE_DOMAIN=digitalspital.com — see infra/deploy/config.env.example." >&2
    return 1
  fi

  # A hostname, not a URL and not a hostname with a port. Checked because the
  # most natural mistake — pasting https://digitalspital.com — would otherwise
  # produce `api.https://digitalspital.com` and fail four steps later inside
  # Caddy's ACME client, where the message is about a certificate.
  if [[ ! "$BASE_DOMAIN" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]]; then
    echo "BASE_DOMAIN='${BASE_DOMAIN}' is not a bare domain name." >&2
    echo "No scheme, no port, no path, no trailing dot — e.g. digitalspital.com" >&2
    return 1
  fi

  # The labels. Overridable so a customer who wants `admin.` rather than
  # `verwaltung.` does not have to abandon the derivation to get it — the German
  # names are DigitalSpital's convention, not a property of the software.
  : "${API_LABEL:=api}"
  : "${ADMIN_LABEL:=verwaltung}"
  : "${PORTAL_LABEL:=fortbildung}"
  : "${WIDGET_LABEL:=widget}"

  : "${API_DOMAIN:=${API_LABEL}.${BASE_DOMAIN}}"
  : "${ADMIN_DOMAIN:=${ADMIN_LABEL}.${BASE_DOMAIN}}"
  : "${PORTAL_DOMAIN:=${PORTAL_LABEL}.${BASE_DOMAIN}}"
  : "${WIDGET_DOMAIN:=${WIDGET_LABEL}.${BASE_DOMAIN}}"

  # Everywhere an origin rather than a hostname is wanted. Always https: the
  # only http these hosts speak is Caddy's redirect to https.
  : "${API_DOMAIN_URL:=https://${API_DOMAIN}}"
  : "${PORTAL_BASE_URL:=https://${PORTAL_DOMAIN}}"
  : "${WIDGET_URL:=https://${WIDGET_DOMAIN}/ds-lms.js}"

  # The staff session cookie's Domain (ADR-0012). The leading dot makes the
  # console and the API same-site so the browser attaches it.
  #
  # This is the one derived value with a security consequence worth stating out
  # loud: every host under BASE_DOMAIN receives this cookie. It is httpOnly, so
  # no script can read it, but a subdomain someone else operates would see it in
  # its access logs. Putting the platform under its own second-level name —
  # BASE_DOMAIN=cme.example.com — narrows that to the platform's own hosts and
  # is the safer shape where the DNS allows it.
  : "${STAFF_COOKIE_DOMAIN:=.${BASE_DOMAIN}}"

  # Our own two browser origins, always. `EXTRA_CORS_ORIGINS` is where a
  # customer's WordPress origin goes — that one cannot be derived, because it is
  # somebody else's domain.
  local ours="https://${ADMIN_DOMAIN},https://${PORTAL_DOMAIN}"
  if [[ -n "${EXTRA_CORS_ORIGINS:-}" ]]; then
    : "${CORS_ALLOWED_ORIGINS:=${ours},${EXTRA_CORS_ORIGINS}}"
  else
    : "${CORS_ALLOWED_ORIGINS:=${ours}}"
  fi

  # What the browser bundles are told at container start (see the frontends'
  # `config.ts`). Derived here so the console and the portal cannot be pointed
  # at a different API than the one Caddy is serving — which was possible while
  # these lived in GitHub repository variables, hundreds of lines from the
  # domain they had to agree with.
  : "${DS_ADMIN_API_BASE:=${API_DOMAIN_URL}}"
  : "${DS_PORTAL_API_BASE:=${API_DOMAIN_URL}}"
  : "${DS_PORTAL_REDIRECT_URI:=${PORTAL_BASE_URL}/}"

  # Which project each frontend acts within, sent as `X-DS-Project`.
  #
  # **Per surface, not per platform.** There was one `PROJECT_SLUG` and it named
  # a customer — `medice-adhs` — in a file that describes an installation which
  # is supposed to serve many. The two are genuinely different questions:
  #
  #   * The **portal** is a customer's front door. `fortbildung.…` shows one
  #     project's catalogue, so a project is what that hostname *is*. A second
  #     customer gets a second portal hostname, or the portal learns to pick
  #     from the host header — either way it is a property of the surface.
  #   * The **console** spans customers: a super administrator's first screen is
  #     the customer registry, which deliberately sends no project header at
  #     all. What it needs is a *default* for the tenant-scoped screens until
  #     the operator has chosen one — see P18-03, which makes that a choice in
  #     the interface rather than a line in a file.
  : "${DS_ADMIN_PROJECT_SLUG:=${ADMIN_DEFAULT_PROJECT_SLUG:-}}"
  : "${DS_PORTAL_PROJECT_SLUG:=${PORTAL_PROJECT_SLUG:-}}"

  # The portal's CSP names the realm's *origin* — scheme, host, optional port —
  # so that the browser will let it redirect a learner to Keycloak. Cut from the
  # portal's issuer rather than written again: two spellings of the same host is
  # how one of them ends up with a `/realms/...` path in a `connect-src`, where
  # it is silently ignored and the sign-in fails with nothing in any log.
  #
  # The *portal's* issuer, not a deployment-wide one: the API has no Keycloak
  # configuration at all and reads the realm off the project row (P17-02).
  if [[ -z "${KEYCLOAK_ORIGIN:-}" && -n "${PORTAL_KEYCLOAK_ISSUER:-}" ]]; then
    if [[ "$PORTAL_KEYCLOAK_ISSUER" =~ ^(https?://[^/]+) ]]; then
      KEYCLOAK_ORIGIN="${BASH_REMATCH[1]}"
    fi
  fi
  : "${KEYCLOAK_ORIGIN:=}"

  # Where the generated Caddy site blocks live — outside the git clone, so a
  # `git checkout` can never touch them and `git status` on the server stays
  # clean. Absolute, because compose resolves a relative bind mount against the
  # compose file's directory rather than the caller's.
  : "${DS_SITES_DIR:=${DS_STATE_DIR:-${HOME}/ds-education}/sites}"

  export BASE_DOMAIN API_LABEL ADMIN_LABEL PORTAL_LABEL WIDGET_LABEL
  export API_DOMAIN ADMIN_DOMAIN PORTAL_DOMAIN WIDGET_DOMAIN
  export API_DOMAIN_URL PORTAL_BASE_URL WIDGET_URL
  export STAFF_COOKIE_DOMAIN CORS_ALLOWED_ORIGINS
  export DS_ADMIN_API_BASE DS_PORTAL_API_BASE DS_PORTAL_REDIRECT_URI
  export DS_ADMIN_PROJECT_SLUG DS_PORTAL_PROJECT_SLUG
  export KEYCLOAK_ORIGIN DS_SITES_DIR
}

# Check the parts a derivation cannot: values a human still has to supply, and
# the invariants that hold however they were arrived at.
#
# Separate from the derivation because it also has to run against a deployment
# that sets every hostname explicitly — the checks are about the *result*, not
# about how it was reached.
ds_check_domains() {
  local failures=0
  complain() { echo "xx $*" >&2; failures=1; }

  case "${STAFF_COOKIE_DOMAIN:-}" in
    .*) ;;
    *) complain "STAFF_COOKIE_DOMAIN must start with a dot, e.g. .${BASE_DOMAIN:-example.com}" ;;
  esac

  local host
  for host in "${ADMIN_DOMAIN:-}" "${API_DOMAIN:-}"; do
    [[ "$host" == *"${STAFF_COOKIE_DOMAIN:-__unset__}" ]] || complain \
      "STAFF_COOKIE_DOMAIN (${STAFF_COOKIE_DOMAIN:-unset}) is not a parent of ${host}"
  done

  # The console and the portal call the API from a browser. Missing here, the
  # app loads and every request is refused by CORS — a blank screen, server-side
  # silence.
  local origin
  for origin in "https://${ADMIN_DOMAIN}" "https://${PORTAL_DOMAIN}"; do
    [[ ",${CORS_ALLOWED_ORIGINS:-}," == *",${origin},"* ]] || complain \
      "CORS_ALLOWED_ORIGINS does not contain ${origin}"
  done

  # The CSP's connect-src. A mismatch here blocks the console's requests in the
  # browser with nothing in any server log.
  [[ "${API_DOMAIN_URL:-}" == "https://${API_DOMAIN}" ]] || complain \
    "API_DOMAIN_URL (${API_DOMAIN_URL:-unset}) does not match https://${API_DOMAIN}"

  # The frontends' containers refuse to start without a project slug, which is
  # a container restart loop rather than a message. Said here instead.
  [[ -n "${DS_ADMIN_PROJECT_SLUG:-}" ]] || complain \
    "ADMIN_DEFAULT_PROJECT_SLUG is not set — the console needs a default project"
  [[ -n "${DS_PORTAL_PROJECT_SLUG:-}" ]] || complain \
    "PORTAL_PROJECT_SLUG is not set — the portal serves one project's catalogue"

  # The portal redirects learners to Keycloak, and its CSP has to allow that
  # origin. Empty, the redirect is blocked by the browser and sign-in fails
  # with nothing server-side to look at.
  [[ -n "${KEYCLOAK_ORIGIN:-}" ]] || complain \
    "KEYCLOAK_ORIGIN is empty — it is cut from PORTAL_KEYCLOAK_ISSUER, so check that"

  # All four hostnames distinct: two services on one name means Caddy serves
  # whichever block it parsed last, and the other is simply gone.
  local dupes
  dupes="$(printf '%s\n' "$API_DOMAIN" "$ADMIN_DOMAIN" "$PORTAL_DOMAIN" "$WIDGET_DOMAIN" \
    | sort | uniq -d)"
  [[ -z "$dupes" ]] || complain "two services share a hostname: ${dupes//$'\n'/, }"

  return "$failures"
}
