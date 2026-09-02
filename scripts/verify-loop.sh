#!/usr/bin/env bash
#
# The adversarial pass, as a command (CLAUDE.md §11).
#
# Runs a **fresh** Claude Code session over the current diff and a PR body, with
# the verifier prompt from `docs/verifier-prompt.md`, and refuses to pass while
# any claim is CONTRADICTED or UNVERIFIABLE.
#
# ## Why this is not part of `pnpm verify`
#
# `pnpm verify` executes code. The failures this catches are **sentences** — a
# timeout justified by a transaction that does not wrap that path, a flag named
# in a warning that the script never accepted, a check reported as green while
# scanning prose. None of those is executed by anything, so no amount of test
# coverage reaches them. This needs a reader, and it needs one that did not
# write the text.
#
# ## What it does not do
#
# It does not fix anything, and it does not merge anything. It produces a list.
# The §2 human review gate on auth, assessment, eiv and certificates is
# untouched by this — the loop only reduces how much reaches that person.
#
# Usage:
#   scripts/verify-loop.sh [--base <ref>] [--body <file>]
#
#   --base   what to diff against (default: origin/HEAD, else the merge-base
#            with the default branch, else HEAD~1)
#   --body   the claims to check (default: the last commit's message)

set -Eeuo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

BASE=""
BODY_FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base) BASE="${2:-}"; [[ -n "$BASE" ]] || { echo "--base needs a ref" >&2; exit 2; }; shift 2 ;;
    --body) BODY_FILE="${2:-}"; [[ -n "$BODY_FILE" ]] || { echo "--body needs a file" >&2; exit 2; }; shift 2 ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "unknown option: $1
Valid options: --base <ref> --body <file> --help" >&2; exit 2 ;;
  esac
done

command -v claude >/dev/null 2>&1 || {
  echo "verify-loop: the 'claude' CLI is not on PATH." >&2
  echo "  This script shells out to a second, non-interactive session" >&2
  echo "  (claude -p). Without it, run the pass by hand: paste" >&2
  echo "  docs/verifier-prompt.md into a new session with the diff." >&2
  exit 1
}

# The base to compare against, in decreasing order of confidence about what the
# reviewer actually cares about.
if [[ -z "$BASE" ]]; then
  BASE="$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null || true)"
fi
if [[ -z "$BASE" ]]; then
  BASE="HEAD~1"
fi

DIFF="$(git diff "$BASE"...HEAD)"
if [[ -z "$DIFF" ]]; then
  echo "verify-loop: no diff against ${BASE} — nothing to verify." >&2
  exit 1
fi

if [[ -n "$BODY_FILE" ]]; then
  BODY="$(cat "$BODY_FILE")"
else
  BODY="$(git log -1 --format=%B)"
fi

REPORT="${TMPDIR:-/tmp}/ds-verifier-report.md"

echo "==> Verifying claims against ${BASE}...HEAD ($(git diff --name-only "$BASE"...HEAD | wc -l | tr -d ' ') files)"

# The verifier gets the prompt, the claims and the diff — and nothing about how
# any of it was arrived at. That absence is the whole mechanism.
{
  cat docs/verifier-prompt.md
  printf '\n\n## The claims to check\n\n%s\n' "$BODY"
  printf '\n\n## The diff\n\n```diff\n%s\n```\n' "$DIFF"
} | claude -p --output-format text > "$REPORT" 2>&1 || {
  echo "verify-loop: the verifier session failed. Its output:" >&2
  cat "$REPORT" >&2
  exit 1
}

cat "$REPORT"
echo
echo "==> Report saved to ${REPORT}"

# Refuse on anything unresolved. `grep -c` rather than a plain match so the
# count is in the message: "one unresolved claim" and "eleven" are different
# conversations.
unresolved="$(grep -cE 'CONTRADICTED|UNVERIFIABLE' "$REPORT" || true)"

if [[ "${unresolved:-0}" -gt 0 ]]; then
  echo "==> ${unresolved} unresolved claim(s). Resolve each by reading the code or"
  echo "    fetching the evidence the verifier asked for — never by rewording."
  exit 1
fi

# A report with no verdicts in it at all is not a pass. It is a verifier that
# did not run properly, and treating it as green is the §9.1 trap this whole
# section exists for.
if ! grep -q 'PROVEN' "$REPORT"; then
  echo "==> The report contains no PROVEN verdicts. That is not a pass — it is a" >&2
  echo "    verifier that did not do its job. Read ${REPORT}." >&2
  exit 1
fi

echo "==> All claims PROVEN. Now run: pnpm verify"
echo "==> And if this touches auth, assessment, eiv or certificates, it still"
echo "    needs the human review gate (CLAUDE.md §2). This does not replace it."
