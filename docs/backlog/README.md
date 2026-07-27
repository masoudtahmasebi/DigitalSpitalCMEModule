# Backlog — work orders P0–P10

One file per phase. Each file is an **Epic**; each entry inside it is a **Task**
written so it can be handed to Claude Code verbatim.

| Phase                                    | File             | Budget    | Weeks |
| ---------------------------------------- | ---------------- | --------- | ----- |
| P0 · Foundations & AI-first setup        | [P0.md](P0.md)   | 10 h      | 1     |
| P1 · Auth & user profile                 | [P1.md](P1.md)   | 10 h      | 1–2   |
| P2 · Backend core: hierarchy & catalog   | [P2.md](P2.md)   | 16 h      | 2     |
| P3 · Learning engine                     | [P3.md](P3.md)   | 14 h      | 3     |
| P4 · Assessment & evaluation             | [P4.md](P4.md)   | 10 h      | 4     |
| P5 · Learner frontend widget             | [P5.md](P5.md)   | 28 h      | 1–5   |
| P6 · WordPress integration               | [P6.md](P6.md)   | 5 h       | 2     |
| P7 · EIV-FOBI & EFN                      | [P7.md](P7.md)   | 12 h      | 1, 5  |
| P8 · Certificates & email                | [P8.md](P8.md)   | 7 h       | 5     |
| P9 · Admin console                       | [P9.md](P9.md)   | 18 h      | 5–6   |
| P10 · Hardening, Hetzner deploy & launch | [P10.md](P10.md) | 10 h      | 6     |
| **Total**                                |                  | **140 h** |       |

## Global definition of done

Every task inherits this. Task entries list only their **additional** DoD items.

- [ ] Acceptance criteria all met and demonstrably exercised
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` green
- [ ] New behaviour covered by tests at the level appropriate to it — pure logic
      in `packages/domain` unit tests, API behaviour in integration tests against
      a real Postgres, never mocks for the database
- [ ] No compliance decision (watch %, score, gating, completion, deadline) made
      on the client
- [ ] No secret in code, in logs, or in an API response
- [ ] `contracts/openapi.yaml` updated **before** the implementation if the API
      surface changed, and the SDK regenerated
- [ ] Commit messages use `<task-id>: imperative summary`
- [ ] PR description references the task, ticks the acceptance criteria and
      states any deviation from this spec
- [ ] Documentation touched by the change updated in the same PR

## Review gates

Tasks marked **Review gate: human** touch `auth`, `assessment`, `eiv` or
`certificates`. A wrong result in those four areas is a compliance incident, not a
bug. These PRs carry the `needs-human-review` label and are never self-merged.

## Estimating convention

Hours are _elapsed engineering hours including review_, not ideal coding time.
They are budget allocations, not predictions: a task that comes in under
estimate does not release its remainder to another phase, because the 140 h
total is what was sold.

## Interim IDs and remapping to Jira

Jira project **DEP** is not yet populated. Until it is:

- Tasks use the IDs in these files (`P0-01`, `P3-04`, …).
- Branches are `P0-01-short-slug`.
- Commits are `P0-01: imperative summary`.

Each task carries a `jira:` field, currently unassigned.

**One-time remap, when DEP is populated:**

1. Create one Epic per phase file, copying its Epic header as the description.
2. Create one Task per entry, copying context, scope, acceptance criteria and
   estimate verbatim into the Jira ticket.
3. Fill in the `jira:` field in this backlog with the resulting key.
4. From that commit onward, branches and commits use the `DEP-123` form per
   `CLAUDE.md` §2.
5. Historic commits are **not** rewritten. `docs/backlog/` remains the mapping
   between the two schemes.

Per roadmap §13: DEP-1 folds into the P2 Epic; DEP-2 and DEP-3 become foundation
tasks under P0.

## Scope discipline

The deferred list in `docs/roadmap.md` §4 is contractual. If a task appears to
require a deferred item, stop and flag it rather than widening scope. The declared
trade lever under date pressure is P9 (admin console, 18 h) — nothing else.
