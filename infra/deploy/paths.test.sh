#!/usr/bin/env bash
#
# The deploy scripts must not care what directory you ran them from (P45-02).
#
# ## The failure
#
# ```
# deploy@DS-CME:~$ ./Repositories/DigitalSpitalCMEModule/infra/deploy/deploy.sh
# ...
# ==> Ensuring database roles
# deploy.sh: line 436: ../postgres/init-roles.sql: No such file or directory
# xx failed at line 436. The previous version is still running.
# ```
#
# One line read a file by a path relative to `$PWD` — `< ../postgres/…` — while
# every other path in the script was built from `$SCRIPT_DIR`. It worked for
# everybody who had `cd`-ed into `infra/deploy` first, which is what the runbook
# says to do, and failed the first time somebody typed the full path from their
# home directory. The deploy had already built four images and taken a backup.
#
# ## Why a static check rather than a run
#
# The failing line is two thirds of the way down, past the backup and the
# migration. `--check` exits long before it, so a dry run from another directory
# would have been green (CLAUDE.md §9.1: a check that cannot go red). The
# property wanted is textual — *no path in these scripts is resolved against the
# caller's working directory* — and it is decidable by reading them.
#
# Run: ./infra/deploy/paths.test.sh   (CI and `pnpm verify` both run it)

set -Eeuo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

passed=0
failed=0

# The scripts an operator invokes directly, by whatever path they like.
# `*.test.sh` are excluded: they `cd` to their own directory on line 3, which is
# the correct idiom for a test and not for a tool somebody types the full path
# to.
for script in deploy.sh dsc domains.sh secrets.sh images.sh; do
  # Comments are stripped first: several of them legitimately discuss relative
  # paths, and a check that flagged its own explanation would be turned off.
  # Heredoc bodies would need the same treatment if any of these grew one.
  offenders="$(sed 's/#.*//' "$script" \
    | grep -nE '(<|>|source|\.|-f|-d|-e)[[:space:]]+"?\.{1,2}/' \
    | grep -v 'SCRIPT_DIR' || true)"

  if [[ -n "$offenders" ]]; then
    failed=$((failed + 1))
    echo "FAIL: ${script} resolves a path against \$PWD:" >&2
    printf '    %s\n' "${offenders}" >&2
    echo "  Use \"\${SCRIPT_DIR}/...\" — the script must work from any directory." >&2
  else
    passed=$((passed + 1))
  fi
done

echo "paths.test.sh: ${passed} passed, ${failed} failed"
[[ "$failed" -eq 0 ]]
