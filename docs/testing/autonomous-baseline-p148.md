# Autonomous session baseline — P148

Recorded before any change, per the session's Phase 0.

## Commit

```
$ git rev-parse HEAD
d31759576b01648384a937932e2a800f206b70c2

$ git branch --show-current
claude/education-platform-roadmap-3vgrqh

$ git status --short
(clean)
```

## Is P147 on `main`?

**No.** This corrects a premise in the session brief.

```
$ git branch -r --contains HEAD
  origin/claude/education-platform-roadmap-3vgrqh
```

`origin/main` exists and does **not** contain this work. Nothing on this branch
has ever been merged. The deploys were `workflow_dispatch` runs against the
branch head, which `deploy.yml` supports by design ("Manually: Actions → Deploy →
Run workflow, choosing any branch").

## Is it deployed?

Yes — verified from the run history rather than assumed.

| Created (UTC)        | head_sha   | Conclusion |
| -------------------- | ---------- | ---------- |
| 2026-09-01T15:43:52Z | `d3175957` | success    |
| 2026-09-01T15:13:58Z | `58e9bfb2` | success    |
| 2026-08-31T12:56:39Z | `16c8852a` | success    |

`d3175957` is the P147 head, so production carries P140–P147.

## Baseline gate

```
$ TEST_DB_HOST=127.0.0.1:5433 \
  POSTGRES_SUPERUSER_URL=postgres://postgres:postgres@127.0.0.1:5433/postgres \
  pnpm verify
…
 Test Files  22 passed (22)
      Tests  577 passed (577)
PHASE0_VERIFY_EXIT=0
```

Matches the 577-green state P147 ended on. Proceeding.

## Documents named in the brief that do not exist

`find` over the repository returns nothing for any of:

- `DEP-ClaudeCode-QA-Prompt.md`
- `DEP-QA-Journey-v2.md`
- `Claude-Code-Verification-Protocol.md`

The QA prompt was supplied in conversation and never committed; the verification
protocol was adopted into `CLAUDE.md` §11 and `docs/verifier-prompt.md`. The
repository's own test pack is `docs/testing/` (`00-README.md` … `17-…`), which is
the DEP-6…DEP-21 mapping described in `CLAUDE.md` §10.
