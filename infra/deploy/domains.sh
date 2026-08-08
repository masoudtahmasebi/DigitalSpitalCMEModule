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

  # Our own two browser origins, and only ours.
  #
  # A customer's site is `projects.embed_origins` now, resolved by the API at
  # request time (P18-04). This deployment cannot know them and should not: one
  # env-file list is the union across every customer on the installation.
  : "${CORS_ALLOWED_ORIGINS:=https://${ADMIN_DOMAIN},https://${PORTAL_DOMAIN}}"

  # What the browser bundles are told at container start (see the frontends'
  # `config.ts`). Derived here so the console and the portal cannot be pointed
  # at a different API than the one Caddy is serving — which was possible while
  # these lived in GitHub repository variables, hundreds of lines from the
  # domain they had to agree with.
  : "${DS_ADMIN_API_BASE:=${API_DOMAIN_URL}}"
  : "${DS_PORTAL_API_BASE:=${API_DOMAIN_URL}}"

  # Neither frontend is told which project it is any more.
  #
  # The portal reads its tenant from the first path segment (P21-03) and the
  # console picks one in the interface (P22-03). There used to be a single
  # `PROJECT_SLUG` naming a customer — `medice-adhs` — in a file that describes
  # an installation meant to serve many.

  # No Keycloak origin in the portal's CSP, because the portal never contacts a
  # Keycloak. It has not run an OIDC flow since P21-03: a federated tenant gets
  # a link to the customer's own login, which is a top-level navigation and not
  # a `connect-src`. Naming a realm here would widen the policy for a request
  # the page cannot make.

  # What the bare domain does.
  #
  # ## Why this has a default at all
  #
  # It did not, and the consequence was a browser security error on the
  # customer's own domain. `deploy.sh` writes an apex site block only when this
  # is set, and removes it when it is not — with a comment explaining that a
  # stale block would keep redirecting a domain the client had since pointed at
  # a marketing site.
  #
  # That reasoning is sound only while the DNS does **not** point here. This
  # deployment's does: an A record on `@` and a wildcard on `*`. So "no site
  # block" does not mean "nothing happens" — it means Caddy receives the
  # connection, finds no site matching the name, has no certificate for it, and
  # the TLS handshake fails. `ERR_SSL_PROTOCOL_ERROR`, before any HTTP.
  #
  # The portal is the right destination: it is the learner-facing front door,
  # and someone typing the bare domain is looking for the Fortbildungen.
  #
  # ## Turning it off
  #
  # `APEX_REDIRECT_URL=none` — explicitly, because an empty value now means
  # "you did not choose" rather than "you chose nothing". Use it when the apex
  # is served elsewhere: point the DNS away first, or Caddy will answer for a
  # name it has no site for and you are back where this started.
  : "${APEX_REDIRECT_URL:=${PORTAL_BASE_URL}}"

  # Where the generated Caddy site blocks live — outside the git clone, so a
  # `git checkout` can never touch them and `git status` on the server stays
  # clean. Absolute, because compose resolves a relative bind mount against the
  # compose file's directory rather than the caller's.
  : "${DS_SITES_DIR:=${DS_STATE_DIR:-${HOME}/ds-education}/sites}"

  export BASE_DOMAIN API_LABEL ADMIN_LABEL PORTAL_LABEL WIDGET_LABEL
  export API_DOMAIN ADMIN_DOMAIN PORTAL_DOMAIN WIDGET_DOMAIN
  export API_DOMAIN_URL PORTAL_BASE_URL WIDGET_URL
  export STAFF_COOKIE_DOMAIN CORS_ALLOWED_ORIGINS
  export DS_ADMIN_API_BASE DS_PORTAL_API_BASE
  export DS_SITES_DIR APEX_REDIRECT_URL
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

  # The portal redirects learners to Keycloak, and its CSP has to allow that
  # origin. Empty, the redirect is blocked by the browser and sign-in fails
  # with nothing server-side to look at.

  # A value that is neither a URL nor the opt-out is a typo, and the failure
  # would be a Caddy block with a nonsense redirect target rather than an
  # error — the browser follows it and lands nowhere.
  case "${APEX_REDIRECT_URL:-}" in
    none | http://* | https://*) ;;
    *) complain "APEX_REDIRECT_URL must be a full URL or 'none', not '${APEX_REDIRECT_URL:-}'" ;;
  esac

  # All four hostnames distinct: two services on one name means Caddy serves
  # whichever block it parsed last, and the other is simply gone.
  local dupes
  dupes="$(printf '%s\n' "$API_DOMAIN" "$ADMIN_DOMAIN" "$PORTAL_DOMAIN" "$WIDGET_DOMAIN" \
    | sort | uniq -d)"
  [[ -z "$dupes" ]] || complain "two services share a hostname: ${dupes//$'\n'/, }"

  return "$failures"
}
