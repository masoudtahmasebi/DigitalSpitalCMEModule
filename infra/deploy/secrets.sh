#!/usr/bin/env bash
#
# Credentials the server generates and owns (P17-01).
#
# ## Why these are not in GitHub
#
# They used to be four lines of a `PRODUCTION_ENV` secret: two database
# passwords, the Postgres superuser password and the KMS key. Nobody reads them,
# nobody types them, and no human decision is encoded in any of them — they are
# 32 random bytes each. Keeping them in a repository secret meant:
#
#   * a human generated them, saw them, and pasted them somewhere;
#   * they existed in two places, and rotating meant remembering both;
#   * anyone who could read the repository's secrets held the database.
#
# So the machine generates them, once, into a file only the deploy user can
# read. GitHub holds an SSH key and nothing else that unlocks anything.
#
# ## Generated once, never regenerated
#
# Every value here is written **only if absent**. That is not a nicety:
#
#   * `SECRETS_KMS_KEY` decrypts the VNR password and the SMTP credentials.
#     Regenerating it does not rotate anything — it makes every encrypted column
#     permanently unreadable, and there is no plaintext fallback by design.
#   * `POSTGRES_SUPERUSER_PASSWORD` is consumed by the Postgres image when it
#     initialises its data directory and never again. A new value after that is
#     simply a value that no longer matches the database.
#
# The two application role passwords *are* safely rotatable —
# `init-roles.sql` runs `ALTER ROLE … PASSWORD` on every deploy — but they are
# still only generated once, because rotating them is a deliberate act and not
# something a redeploy should do behind somebody's back.
#
# ## What this means for backups
#
# **The secrets file is part of the backup.** A database dump without the KMS
# key restores rows whose `_enc` columns can never be read again. `deploy.sh`
# copies it beside each dump for that reason, and `docs/deployment.md` §6 says
# so where somebody planning off-host backups will see it.

# Ensure every generated credential exists in the secrets file, then load it.
#
# `state_dir` is where the deployment keeps everything that is not in git.
ds_ensure_secrets() {
  local state_dir="$1"
  local file="${state_dir}/secrets.env"

  mkdir -p "$state_dir"
  chmod 700 "$state_dir"

  # Created empty rather than assumed: `touch` then `chmod` has a window where
  # the file exists and is world-readable, so the umask does the work instead.
  if [[ ! -f "$file" ]]; then
    (umask 077 && : > "$file")
    echo "  created ${file}"
  fi

  # Refuse a file anyone else can read rather than adding to it. Every
  # credential the platform has is in here.
  local perms
  perms="$(stat -c '%a' "$file")"
  if [[ "$perms" != "600" && "$perms" != "400" ]]; then
    echo "xx ${file} has mode ${perms}; expected 600" >&2
    return 1
  fi

  # `openssl rand -base64 32` for each. The KMS key's length is load-bearing —
  # the API refuses to start unless it decodes to exactly 32 bytes — and the
  # others are simply long.
  local name
  for name in POSTGRES_SUPERUSER_PASSWORD DS_MIGRATOR_PASSWORD DS_APP_PASSWORD \
              SECRETS_KMS_KEY; do
    if grep -q "^${name}=." "$file"; then
      continue
    fi
    local value
    value="$(openssl rand -base64 32)" || {
      echo "xx could not generate ${name}: openssl rand failed" >&2
      return 1
    }
    printf '%s=%s\n' "$name" "$value" >> "$file"
    echo "  generated ${name}"
  done

  set -a
  # shellcheck disable=SC1090 # runtime path, deliberately not resolvable at lint time
  source "$file"
  set +a
}

# What the operator must still decide, checked after the file is loaded.
#
# Separate from generation because these are answers, not randomness: a domain,
# a project slug, an email address for certificate expiry warnings. No default
# is better than a wrong one.
ds_check_secrets() {
  local failures=0

  # 32 bytes, base64. Checked even though this file generated it, because a
  # deployment may have inherited an older secrets file — and the failure it
  # prevents is a container that exits on boot with a message about a cipher.
  local kms_bytes
  kms_bytes="$(printf '%s' "${SECRETS_KMS_KEY:-}" | base64 -d 2>/dev/null | wc -c || true)"
  if [[ "$kms_bytes" != "32" ]]; then
    echo "xx SECRETS_KMS_KEY must decode to 32 bytes (got ${kms_bytes})" >&2
    failures=1
  fi

  local name
  for name in POSTGRES_SUPERUSER_PASSWORD DS_MIGRATOR_PASSWORD DS_APP_PASSWORD; do
    if [[ -z "${!name:-}" ]]; then
      echo "xx ${name} is empty" >&2
      failures=1
    fi
  done

  return "$failures"
}
