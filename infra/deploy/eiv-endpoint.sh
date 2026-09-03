#!/usr/bin/env bash
#
# Which EIV endpoint needs consent before a Punktemeldung (P104-01).
#
# The shell reading of `packages/eiv-client/src/endpoint.ts`. Two
# implementations of one rule is what §9.11 warns about, so `eiv-endpoint.test.sh`
# drives this one over the same fixture table the TypeScript unit tests use.
#
# The rule, in one line: loopback and `backend-test.eiv-fobi.de` are safe;
# everything else — including a host this file does not recognise — needs
# explicit consent. Failing closed on an unknown host is deliberate: it might be
# a proxy in front of the real register, and guessing wrong costs a false CME
# credit on a real physician's record.
#
# Since P180-01 the consent is a row in `platform_settings` with the operator's
# id on it, not the string `yes` in a file. What this module does is unchanged;
# where its inputs come from is not, and `ds_eiv_settings_sql` at the bottom is
# the single query that reads them.

# The two hosts the console's words resolve to. The twins of `EIV_TEST_HOST` and
# `EIV_LIVE_HOST` in `@ds/eiv-client`, kept here because the deploy answers this
# question before any of that code is running.
DS_EIV_TEST_HOST="backend-test.eiv-fobi.de"
DS_EIV_LIVE_HOST="backend.eiv-fobi.de"

# Prints nothing. Returns 0 when consent is required.
ds_eiv_requires_live_consent() {
  local url="$1" host

  # Strip the scheme, then anything from the first `/`, `?` or `#`.
  host="${url#*://}"
  host="${host%%[/?#]*}"

  # Then the port — but only on an unbracketed host. `[::1]:4010` is an IPv6
  # literal, and `%%:*` on it leaves `[`, which matched nothing and quietly
  # sent the dev stack's own mock down the "needs consent" path.
  case "$host" in
    \[*\]*) host="${host%%\]*}]" ;;
    *) host="${host%%:*}" ;;
  esac

  host="$(printf '%s' "$host" | tr '[:upper:]' '[:lower:]')"

  case "$host" in
    127.0.0.1 | localhost | "[::1]" | ::1 | eiv-mock) return 1 ;;
    backend-test.eiv-fobi.de) return 1 ;;
    *) return 0 ;;
  esac
}

# Which URL each of the console's three words resolves to (P180-01).
#
# The shell twin of `eivEndpointUrl` in `@ds/eiv-client`, and it exists for the
# reason the tier function next to it does: the deploy has to answer "will this
# installation file live?" before the API is up, with nothing but `psql` and
# `bash`. Kept beside the tier function so the two are read together, and
# `eiv-endpoint.test.sh` asserts they agree with the TypeScript.
ds_eiv_endpoint_url() {
  local choice="${1:-}" mock="${2:-}"

  case "$choice" in
    mock) printf '%s' "$mock" ;;
    test) printf 'https://%s' "$DS_EIV_TEST_HOST" ;;
    live) printf 'https://%s' "$DS_EIV_LIVE_HOST" ;;
    # An unrecognised word is not treated as the mock. A typo that resolved to
    # loopback would report "not live" for an installation whose setting the
    # application will reject — the guard would be quiet about the one state
    # nobody has checked.
    *) printf 'about:unknown' ;;
  esac
}

# Will the worker file a Punktemeldung the Ärztekammer keeps?
#
# ## What changed in P180-01
#
# The arguments used to be `EIV_BASE_URL` and `EIV_WORKER_ENABLED`, read out of
# `config.env`. Both moved into `platform_settings` at the client's request, so
# the caller now reads them from the database — see `ds_eiv_settings_sql` below
# — and passes the three columns in.
#
# The **consent** argument is new and is not a convenience: with the setting in
# a file, "armed against live" was the whole question. With it in a table, an
# installation can be pointed at `live` with the worker on and *no consent on
# record*, in which case the application refuses every submission. Reporting
# that as "will file live" would cry wolf on every deploy of a half-configured
# host, and a warning that fires when nothing will happen is a warning people
# learn to skip.
ds_eiv_worker_will_file_live() {
  local choice="${1:-}" worker="${2:-}" consented="${3:-}" mock="${4:-}"

  # `t` is what psql prints for a true boolean with -tAX.
  [[ "$worker" == "t" || "$worker" == "true" || "$worker" == "yes" ]] || return 1
  [[ "$consented" == "t" || "$consented" == "true" ]] || return 1

  ds_eiv_requires_live_consent "$(ds_eiv_endpoint_url "$choice" "$mock")"
}

# The one query that answers all three, so the deploy and the smoke cannot read
# the setting two different ways.
ds_eiv_settings_sql() {
  printf '%s' \
    "SELECT eiv_endpoint || '|' || eiv_worker_enabled || '|' ||
            (eiv_live_confirmed_at IS NOT NULL)
       FROM platform_settings WHERE singleton"
}
