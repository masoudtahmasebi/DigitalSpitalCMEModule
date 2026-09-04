#!/usr/bin/env bash
# Which sender will carry a Teilnahmebescheinigung on this installation?
# (P188-03, extracted P189-01)
#
# ## Why this is a file and not a string in the workflow
#
# The query was inline in `deploy.yml`, inside an `ssh "..."` inside a YAML
# block scalar. Getting an empty SQL string literal through those three layers
# needs `''` — which cannot appear inside the single-quoted `bash -lc '...'`
# the read now uses — and the escape that avoids it (`$$$$`, Postgres
# dollar-quoting) is unreviewable. `eiv-endpoint.sh` already solved this for the
# EIV posture by putting the SQL in a function; this is the same answer for the
# same reason.
#
# It also makes the query testable, which a string in a workflow is not.
#
# ## What it answers, and what it deliberately does not
#
# Three fields, `|`-separated, matching what `deliverySender` in `@ds/domain`
# decides:
#
#   <projects with a sender of their own>|<projects>|<the platform's From address>
#
# The third is empty unless the platform's sender is **complete** — a host and a
# From address together, which is `canSend` in `apps/api/src/shared/mailer.ts`.
# A From address stored beside no host sends nothing, and reporting it would
# have the deploy promise a fallback the worker refuses (§9.2).
#
# No host, no username and above all no password. The address is on every
# certificate that arrives anyway; the credential is not a thing to put in a CI
# log.

# The query. One line per field so a reader can see the three answers line up
# with the three the console gives.
ds_mail_posture_sql() {
  cat <<'SQL'
SELECT (SELECT count(*) FROM projects
         WHERE btrim(coalesce(smtp_host, '')) <> ''
           AND btrim(coalesce(smtp_from_address, '')) <> '')
    || '|' || (SELECT count(*) FROM projects)
    || '|' || coalesce((SELECT from_address FROM platform_smtp
                         WHERE id = true
                           AND btrim(coalesce(host, '')) <> ''
                           AND btrim(coalesce(from_address, '')) <> ''), '');
SQL
}

# How many projects the platform sends for, given the first two fields.
#
# Separate from the printing so it can be driven over a table. It is one
# subtraction, and it is the number an operator acts on: those are the
# certificates that go nowhere if the platform has no sender.
ds_mail_posture_fallback_count() {
  local own="$1" total="$2"

  # Numeric before arithmetic. A psql that answered a notice, a partial line or
  # a connection error would otherwise reach `$(( ))` and abort the step with a
  # shell syntax error — which reads as "the deploy broke" rather than "the
  # question could not be answered" (§9.6).
  case "${own}${total}" in
    *[!0-9]* | "") return 1 ;;
  esac

  printf '%s' "$(( total - own ))"
}
