---
name: writing-plans
description: Use right after the person approves a backlog ticket written by brainstorming, or when asked to plan an approved ticket in docs/backlog/ — adds a step-by-step plan (files, signatures, failing test first, break-it-on-purpose, P-number commits) to that ticket. Not for tickets that are not yet approved.
license: MIT
---

# Writing the plan into the ticket

Adapted from Superpowers by Jesse Vincent (MIT, commit `8ca22db`); what was
changed and why is in `.claude/skills/THIRD-PARTY.md`. **CLAUDE.md wins every
conflict with this file.**

**Input:** an approved ticket in `docs/backlog/P<N>.md`, usually from
`/brainstorming`. If there is no ticket, stop — CLAUDE.md §2: no ticket, no
code.

**Output:** a `### Plan` section under each `## P<N>-NN` task in that same file.
Not a separate plan document: the ticket is the one home of the work order.

**Announce at start:** "I'm using writing-plans to add the implementation plan
to P<N>."

Write for an engineer who has not seen this codebase or this ticket. They write
idiomatic TypeScript once they know the exact interface and the exact test.
What they cannot know is what was decided: which files, which names and
signatures, which values the ticket fixes, which test proves each step. The plan
is those decisions and nothing more.

## Scope check

If the ticket covers several independent subsystems, propose splitting it into
separate tasks (`P<N>-01`, `P<N>-02`, …), each producing something that works
and is tested on its own.

## Before the steps: what the task touches

Map which files are created or modified and what each is responsible for, in
the repository's existing layout:

| Kind of change              | Where it goes                                                                                             |
| --------------------------- | --------------------------------------------------------------------------------------------------------- |
| A compliance decision       | `packages/domain/src/`, pure, time as an argument; unit test beside it                                    |
| API surface                 | `contracts/openapi.yaml` **first**, then the SDK regenerated, then the module                             |
| Schema                      | a new ordered file in `db/migrations/`, with RLS for tenant-scoped tables                                 |
| API behaviour               | `apps/api/src/modules/<feature>/`; integration test in `apps/api/test/integration/` against real Postgres |
| Learner-facing copy         | `apps/widget/src/locale/` — never inline                                                                  |
| A rule nobody should forget | a script in `scripts/` wired into `pnpm verify` (§9.11)                                                   |

## Task shape

```markdown
## P<N>-01 — <title>

**Review gate:** human | none · **Depends on:** P<M>-NN

**Interfaces**

- Consumes: <exact signatures from earlier tasks>
- Produces: <exact names, parameter and return types later tasks rely on>

### Plan

- [ ] **1. Write the failing test** — `<path>`, `<test name>`, asserting
      `<exact values from the ticket>`.
- [ ] **2. Watch it fail** — `<command>`; expected: `<the failure that proves
the test reaches the code>`.
- [ ] **3. Implement** `<signature>` in `<path>`. One line on the approach
      only where the signature and test leave a real choice.
- [ ] **4. Watch it pass** — `<command>`; expected: `<output>`.
- [ ] **5. Break it on purpose** — <what to break>; the test goes red; restore.
- [ ] **6. Commit** — `P<N>-01: <imperative summary>`.
```

Step 5 is this repository's, not upstream's: a green test is only evidence if it
could have been red (CLAUDE.md §9.1, §11.6).

## What a step contains

A step is done when the implementer can write exactly one reasonable thing
from it.

- **A test step:** the test's name and assertions, with the ticket's exact
  values.
- **A code step:** the signature, the file, the values the ticket pins. The
  implementer writes the body.
- **A verification step:** the command and the output that means it passed.
  Use the repository's own commands: `pnpm --filter @ds/domain test`,
  `pnpm --filter @ds/api test`, `pnpm test:integration`, `pnpm test:e2e`,
  `pnpm check:static`, `pnpm verify`.
- **A reference to another task:** point at its Interfaces block; do not
  repeat its code.

A plan longer than the code it describes has written the code instead. Lines
that decide nothing — "TBD", "handle edge cases", "add appropriate validation",
"write tests for the above" — are the opposite failure.

## Review focus

Under the ticket's last task, add `### Review focus`: up to five inputs or
failure modes the ticket implies but no step's test exercises, most likely to
bite first. On this platform look specifically at: a second tenant (§9.6), N+1
concurrent callers on a pooled resource (§11.10), a course edited after
somebody enrolled (§9.10b), an expired or replayed token or link (§9.5), the
screen offering what the API refuses (§9.2). For each line, add its test to the
task that owns the code.

## Self-review

1. **Coverage:** can every acceptance criterion be pointed to a step that
   proves it?
2. **Step scan:** every step decides exactly one thing — no empty lines, no
   transcribed bodies.
3. **Consistency:** names and types match across tasks.
4. **Can it go red?** Every verification step names an observable failure
   first.
5. **Proportion:** if code blocks are most of the plan, replace bodies with
   signatures and assertions.
6. **The gates:** the global definition of done in `docs/backlog/README.md`
   applies to every task; do not repeat it, do not contradict it.

Fix inline; if a criterion has no task, add one.

## Handoff

> "The plan is in `docs/backlog/P<N>.md`. Please review it — does it capture
> what you want?"

Wait for the review. Then implement in this session, task by task, in order.
Anything touching auth, assessment, eiv, certificates or uploads also gets the
fresh-session adversarial pass (`scripts/verify-loop.sh`, CLAUDE.md §11) and the
`needs-human-review` label on its PR (§2).
