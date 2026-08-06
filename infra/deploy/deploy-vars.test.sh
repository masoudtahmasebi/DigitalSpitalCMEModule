#!/usr/bin/env bash
#
# Every variable `deploy.sh` reads is one somebody guarantees (P18-01).
#
# ## Why this file exists
#
# `deploy.sh` runs under `set -u`, so reading an unset variable does not
# produce an empty string — it kills the deploy. That is the right behaviour
# and it has one blind spot: **`--check` exits before two thirds of the
# script**, so a bad reference in the migrate or verify sections is invisible
# to the preflight, to CI, and to any amount of reading, and shows up as an
# aborted production deploy at the step after the database has been migrated.
#
# That is not hypothetical. Splitting `PROJECT_SLUG` into
# `PORTAL_PROJECT_SLUG` and `ADMIN_DEFAULT_PROJECT_SLUG` left three
# `${PROJECT_SLUG}` references behind in the Keycloak-consistency block, which
# is after the migrations and therefore past `--check`'s exit. The preflight
# passed; the deploy would have died having already migrated.
#
# So this asserts statically what `set -u` only asserts at the moment of
# reading: every configuration-shaped name `deploy.sh` reads **unguarded** is
# one of
#
#   * a required key the preflight refuses to start without,
#   * a credential `secrets.sh` generates,
#   * a value `domains.sh` derives and exports,
#   * something `deploy.sh` assigns itself, or
#   * a variable the shell or the environment always provides.
#
# A reference with a `:-` default is not checked, because a default is exactly
# the promise this makes: it cannot be unset.
#
# Static, and deliberately so — a test that actually ran a deploy would need
# Docker, a database and twenty minutes, and would still only cover the paths
# it happened to take. This covers every line, including the rollback branch
# nobody exercises until the night they need it.
#
# Run: ./infra/deploy/deploy-vars.test.sh   (CI runs it in the lint job)

# The failure messages quote shell syntax at the reader — `${NAME}`, `${NAME:-}`
# — so the single quotes around them are the point rather than an oversight.
# shellcheck disable=SC2016

set -Eeuo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

failed=0

# Names the shell or the container image always provides. Short on purpose: a
# long allowlist is how a real omission gets waved through.
readonly ALWAYS_SET=(
  HOME LINENO BASH_SOURCE PATH PWD IFS
  # Set by `deploy.sh` itself before use, as an exported knob for compose.
  COMPOSE_BAKE
  # Passed to psql on the command line in the same statement that reads it.
  PGPASSWORD
)

# --- what the preflight guarantees -----------------------------------------

# The required keys, read out of deploy.sh rather than repeated here. A copy
# would be a second list to keep in step, and the failure of *that* is this
# test passing while the real list has moved on.
mapfile -t required < <(
  sed -n '/^readonly REQUIRED_CONFIG=(/,/^)/p' deploy.sh \
    | grep -oE '\b[A-Z][A-Z0-9_]+\b' \
    | grep -v '^REQUIRED_CONFIG$'
)
[[ ${#required[@]} -gt 0 ]] || { echo "xx could not read REQUIRED_CONFIG out of deploy.sh" >&2; exit 1; }

# What secrets.sh generates: the names in the `for name in …` loop that writes
# them, read out of the file for the same reason as REQUIRED_CONFIG above.
mapfile -t generated < <(
  sed -n '/^  for name in POSTGRES_SUPERUSER_PASSWORD/,/; do$/p' secrets.sh \
    | grep -oE '\b[A-Z][A-Z0-9_]+\b'
)
[[ ${#generated[@]} -ge 4 ]] || { echo "xx could not find the generated credentials in secrets.sh" >&2; exit 1; }

# And what `ds_export_url_passwords` derives from them: the percent-encoded
# forms, for the two places a password lands inside a URL. Read from its
# `export` line for the same reason `domains.sh`'s exports are — that line is
# also what makes the names visible to `docker compose`.
mapfile -t url_forms < <(
  sed -n '/^ds_export_url_passwords()/,/^}/p' secrets.sh \
    | sed -n '/^  export /p' | sed 's/^  export //' | tr ' ' '\n' | grep -E '^[A-Z]'
)
[[ ${#url_forms[@]} -ge 2 ]] || { echo "xx could not read the exports out of ds_export_url_passwords" >&2; exit 1; }
generated+=("${url_forms[@]}")

# What domains.sh derives: exactly its `export` lines, which is also what makes
# those names visible to `docker compose`.
mapfile -t derived < <(
  sed -n '/^  export /p' domains.sh | sed 's/^  export //' | tr ' ' '\n' | grep -E '^[A-Z]'
)
[[ ${#derived[@]} -gt 0 ]] || { echo "xx could not read the exports out of domains.sh" >&2; exit 1; }

# What deploy.sh assigns itself, in any of the forms it uses.
mapfile -t assigned < <(
  {
    grep -oE '^\s*(readonly |export |local )?[A-Z][A-Z0-9_]*=' deploy.sh | grep -oE '[A-Z][A-Z0-9_]*'
    grep -oE '^\s*for [A-Z][A-Z0-9_]* in' deploy.sh | grep -oE '\b[A-Z][A-Z0-9_]*\b' | grep -v '^for$'
    # `DS_COMMIT="$(...)"` inside an `if`, and the same shape elsewhere.
    grep -oE '\bif [A-Z][A-Z0-9_]*=' deploy.sh | grep -oE '[A-Z][A-Z0-9_]*'
  } | sort -u
)

known=("${ALWAYS_SET[@]}" "${required[@]}" "${generated[@]}" "${derived[@]}" "${assigned[@]}")

# --- what deploy.sh actually reads, unguarded -------------------------------
#
# `${VAR}` and `$VAR`, but not `${VAR:-…}`, `${VAR:=…}`, `${VAR:?…}` or
# `${VAR+…}`: those cannot be unset by construction, which is the whole point
# of writing them that way.
mapfile -t referenced < <(
  grep -oE '\$\{[A-Z][A-Z0-9_]*\}|\$[A-Z][A-Z0-9_]*' deploy.sh \
    | sed -E 's/^\$\{?//; s/\}$//' \
    | sort -u
)

for name in "${referenced[@]}"; do
  found=0
  for k in "${known[@]}"; do
    [[ "$name" == "$k" ]] && { found=1; break; }
  done
  if [[ "$found" == "0" ]]; then
    failed=$((failed + 1))
    printf 'xx deploy.sh reads ${%s} unguarded, and nothing guarantees it is set.\n' "$name" >&2
    printf '   Under `set -u` that aborts the deploy at the line that reads it —\n' >&2
    printf '   which, past the `--check` exit, is after the database has migrated.\n' >&2
    printf '   Add it to REQUIRED_CONFIG, derive it in domains.sh, generate it in\n' >&2
    printf '   secrets.sh, or give the reference a default: ${%s:-}\n\n' "$name" >&2
  fi
done

# --- and the reverse: a required key nobody reads ---------------------------
#
# Weaker than the check above — an unread key costs a line in a template, not a
# deploy — but it is the residue the rename left behind, and it is free here.
#
# All three readers, not just deploy.sh: `ADMIN_DEFAULT_PROJECT_SLUG` is a
# required key that only `domains.sh` reads, on its way to becoming
# `DS_ADMIN_PROJECT_SLUG`.
for name in "${required[@]}"; do
  grep -qE "\\\$\{?${name}\b" deploy.sh domains.sh docker-compose.prod.yml || {
    printf '!! REQUIRED_CONFIG names %s, which none of deploy.sh, domains.sh or\n' "$name" >&2
    printf '   the compose file reads. Either something stopped using it, or it\n' >&2
    printf '   is misspelt.\n' >&2
  }
done

# --- and the compose file, which is what both entry points must satisfy -----
#
# `deploy.sh` is not the only thing that runs `docker compose` here — `dsc` is
# the other, and it is what an operator uses for `run --rm`, `logs` and `exec`.
#
# Checking only `deploy.sh` missed exactly that. `ds_export_url_passwords` was
# called from `deploy.sh` and not from `dsc`, so `${DS_APP_PASSWORD_URL}`
# interpolated blank for anything started through the wrapper, and
# `bootstrap-admin` met
#
#     SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string
#
# which reads as a broken credential and is a missing one. The compose file is
# the contract, so the compose file is what to check — and against **both**
# loaders, because a variable only one of them exports is a variable that works
# until somebody uses the other.

# Everything the compose file may legitimately rely on: the same sources as
# above, plus every key the template offers — those are optional-with-a-default
# in compose and set from `config.env` in practice.
mapfile -t template_keys < <(grep -oE '^[A-Z][A-Z0-9_]+=' config.env.example | tr -d '=')
compose_known=("${known[@]}" "${template_keys[@]}")

# A `${VAR:-default}` in compose cannot be unset by construction, exactly as in
# the shell — so only bare `${VAR}` references are checked.
mapfile -t compose_bare < <(
  grep -oE '\$\{[A-Z][A-Z0-9_]*\}' docker-compose.prod.yml \
    | sed -E 's/^\$\{//; s/\}$//' | sort -u
)

for name in "${compose_bare[@]}"; do
  found=0
  for k in "${compose_known[@]}"; do
    [[ "$name" == "$k" ]] && { found=1; break; }
  done
  if [[ "$found" == "0" ]]; then
    failed=$((failed + 1))
    printf 'xx docker-compose.prod.yml interpolates ${%s}, which nothing exports.\n' "$name" >&2
    printf '   compose substitutes a blank string and warns; the container then\n' >&2
    printf '   starts with an empty value, which fails somewhere further in and\n' >&2
    printf '   reads as a broken setting rather than a missing one.\n\n' >&2
  fi
done

if [[ "$failed" == "0" ]]; then
  printf '\n%s shell + %s compose references checked, all guaranteed\n' \
    "${#referenced[@]}" "${#compose_bare[@]}"
else
  printf '\n%s unguaranteed reference(s)\n' "$failed" >&2
fi
[[ "$failed" == "0" ]]
