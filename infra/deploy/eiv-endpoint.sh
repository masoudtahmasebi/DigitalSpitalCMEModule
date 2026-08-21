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
# `EIV_ALLOW_LIVE=yes`. Failing closed on an unknown host is deliberate: it
# might be a proxy in front of the real register, and guessing wrong costs a
# false CME credit on a real physician's record.

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
