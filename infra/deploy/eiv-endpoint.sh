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

# The hostname a URL names, lowercased and without its port. Factored out of
# `ds_eiv_requires_live_consent` when `ds_eiv_choice_for_url` needed the same
# parsing (P182-05): two copies of this would be two answers to "is that the
# live register", which is the one question that must have exactly one.
ds_eiv_host_of() {
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

  printf '%s' "$host" | tr '[:upper:]' '[:lower:]'
}

# Prints nothing. Returns 0 when consent is required.
ds_eiv_requires_live_consent() {
  case "$(ds_eiv_host_of "$1")" in
    127.0.0.1 | localhost | "[::1]" | ::1 | eiv-mock) return 1 ;;
    backend-test.eiv-fobi.de) return 1 ;;
    *) return 0 ;;
  esac
}

# Which of the console's three words does this URL mean? (P182-05)
#
# The inverse of `ds_eiv_endpoint_url`, and it exists for exactly one job: the
# deploy that carries a pre-P180 `EIV_BASE_URL` out of `config.env` and into
# `platform_settings`. Answering `unknown` is a real answer and the caller
# refuses on it — a host this file does not recognise might be a proxy in front
# of the real register, and P104-01 is the record of what guessing costs.
ds_eiv_choice_for_url() {
  case "$(ds_eiv_host_of "$1")" in
    127.0.0.1 | localhost | "[::1]" | ::1 | eiv-mock) printf 'mock' ;;
    "$DS_EIV_TEST_HOST") printf 'test' ;;
    "$DS_EIV_LIVE_HOST") printf 'live' ;;
    *) printf 'unknown' ;;
  esac
}

# The spellings a person writes for "on" in a config file. Returns 0 for each.
#
# `EIV_WORKER_ENABLED` was documented as `yes`, and `true`/`1`/`on` were all
# written into somebody's file at some point. Reading only `yes` here would
# carry a *disabled* worker forward from an installation that was reporting,
# which is the silent half of the failure this whole carry-forward exists to
# prevent.
ds_eiv_truthy() {
  case "$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')" in
    yes | y | true | t | 1 | on) return 0 ;;
    *) return 1 ;;
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

# What should the deploy do with a pre-P180 `config.env`? (P182-05)
#
# Pure, and separate from the deploy's `ds_eiv_carry_forward`, which performs
# it. The decision is the part that can be wrong in a way nobody sees: it
# chooses whether a real physician's Punktemeldung starts flowing again, stays
# stopped, or — the one that must never happen — starts flowing to the live
# Ärztekammer because a script inferred a consent. `eiv-endpoint.test.sh` drives
# it over a table; the performing half needs a host and a database.
#
# Prints exactly one of:
#
#   none                        nothing left in config.env — the normal state
#   refuse-endpoint <choice>    `live`, or a host this file does not recognise
#   carry <choice> <armed> <stale-allow>
#                               safe to apply: `mock` or `test`, worker
#                               true/false, and whether an EIV_ALLOW_LIVE was
#                               found and dropped (`yes`/`no`)
#
# The **endpoint** is judged first, and that ordering is what makes the third
# field right rather than a refusal (P182-05, corrected before its first
# deploy).
#
# The first version refused when `EIV_ALLOW_LIVE` was set, on the reasoning that
# a consent needs a named person. That reasoning is sound and the branch was
# still wrong, because of where it sat: `live` and `unknown` have already
# returned by the time it is reached, so it could **only ever fire at `mock` or
# `test`** — the two registers that reach no real record. It was unreachable in
# the case it was written for and reachable only in the case where it is wrong.
#
# And at a safe register the flag does not mean what its name says. Until
# P104-01 the rule matched `*eiv-fobi.de*`, so **reaching EIV's own test system
# required `EIV_ALLOW_LIVE=yes`** — that ticket exists because a safety flag you
# must switch off to do ordinary work is a flag that is always off. An
# installation configured before it therefore carries the flag meaning "I may
# talk to a non-loopback host", not "I consent to the live register". Refusing a
# deploy over it blocks on a flag that grants nothing, at a register that files
# nothing.
#
# So it is **dropped**, loudly: the caller says so in the log, and the console
# is where a live consent is given — to one register, cleared when the register
# changes (P180-01). A consent to `test` is not a thing that exists.
ds_eiv_carry_plan() {
  local worker="${1:-}" base="${2:-}" allow="${3:-}"

  [[ -n "$worker" || -n "$base" || -n "$allow" ]] || { printf 'none'; return 0; }

  # No EIV_BASE_URL with the other two present means the installation was on
  # the compiled-in default, which was the mock. Reading that as `unknown` would
  # refuse a deploy over a variable nobody set.
  local choice="mock"
  if [[ -n "$base" ]]; then choice="$(ds_eiv_choice_for_url "$base")"; fi

  case "$choice" in
    live | unknown)
      printf 'refuse-endpoint %s' "$choice"
      return 0
      ;;
  esac

  local armed="false" stale="no"
  if ds_eiv_truthy "$worker"; then armed="true"; fi
  if ds_eiv_truthy "$allow"; then stale="yes"; fi
  printf 'carry %s %s %s' "$choice" "$armed" "$stale"
}

# The one query that answers all three, so the deploy and the smoke cannot read
# the setting two different ways.
ds_eiv_settings_sql() {
  printf '%s' \
    "SELECT eiv_endpoint || '|' || eiv_worker_enabled || '|' ||
            (eiv_live_confirmed_at IS NOT NULL)
       FROM platform_settings WHERE singleton"
}
