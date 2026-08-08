# Backlog — work orders P0–P29

One file per phase. Each file is an **Epic**; each entry inside it is a **Task**
written so it can be handed to Claude Code verbatim.

| Phase                                          | File             | Budget    | Weeks |
| ---------------------------------------------- | ---------------- | --------- | ----- |
| P0 · Foundations & AI-first setup              | [P0.md](P0.md)   | 10 h      | 1     |
| P1 · Auth & user profile                       | [P1.md](P1.md)   | 10 h      | 1–2   |
| P2 · Backend core: hierarchy & catalog         | [P2.md](P2.md)   | 16 h      | 2     |
| P3 · Learning engine                           | [P3.md](P3.md)   | 14 h      | 3     |
| P4 · Assessment & evaluation                   | [P4.md](P4.md)   | 10 h      | 4     |
| P5 · Learner frontend widget                   | [P5.md](P5.md)   | 28 h      | 1–5   |
| P6 · WordPress integration                     | [P6.md](P6.md)   | 5 h       | 2     |
| P7 · EIV-FOBI & EFN                            | [P7.md](P7.md)   | 12 h      | 1, 5  |
| P8 · Certificates & email                      | [P8.md](P8.md)   | 7 h       | 5     |
| P9 · Admin console                             | [P9.md](P9.md)   | 18 h      | 5–6   |
| P10 · Hardening, Hetzner deploy & launch       | [P10.md](P10.md) | 10 h      | 6     |
| **Total (the plan)**                           |                  | **140 h** |       |
| P11 · Second host and extension points         | [P11.md](P11.md) | 12 h ⚠    | —     |
| P12 · Two identity planes, full admin          | [P12.md](P12.md) | 30 h ⚠    | —     |
| P15 · Course behaviour: length, resuming       | [P15.md](P15.md) | 11 h ⚠    | —     |
| P16 · One base domain, runtime config          | [P16.md](P16.md) | 11 h ⚠    | —     |
| P17 · Server-owned secrets, per-project IdP    | [P17.md](P17.md) | 5 h ⚠     | —     |
| P18 · Build on the host, no customer in config | [P18.md](P18.md) | 19 h ⚠    | —     |
| P19 · The mobile layout                        | [P19.md](P19.md) | 12 h ⚠    | —     |
| P20 · A second customer                        | [P20.md](P20.md) | 3 h ⚠     | —     |
| P21 · Participants, memberships, tenants       | [P21.md](P21.md) | 24 h ⚠    | —     |
| P22 · The console's own way in                 | [P22.md](P22.md) | 17 h ⚠    | —     |
| P23 · Uploads, and what makes them safe        | [P23.md](P23.md) | 19 h ⚠    | —     |
| P25 · Seeing it, and finding out why not       | [P25.md](P25.md) | 16 h ⚠    | —     |
| P26 · An installation with something in it     | [P26.md](P26.md) | 4 h ⚠     | —     |
| P27 · The last six layout pages                | [P27.md](P27.md) | 15 h ⚠    | —     |
| P28 · One test that walks the whole system     | [P28.md](P28.md) | 10 h ⚠    | —     |
| P29 · The same walk, in a real browser         | [P29.md](P29.md) | 10 h ⚠    | —     |

⚠ **Everything below the 140 h line is outside the plan.** Each was built on an explicit
instruction and is recorded rather than absorbed: `CLAUDE.md` §3 says the rest of
the plan is not negotiable, so those hours came from somewhere. See the header of
[P11.md](P11.md), which also states that its work orders were written after the
code — a process violation, named rather than hidden.

**Two ID ranges have no file here.** `P13-01` (course presentation fields —
which hero image, subtitle and description a physician sees, authorable rather
than seeded) is specified in [`../content-model.md`](../content-model.md) §8, and
`P14-01` (the first super administrator) in
[`../deployment.md`](../deployment.md). They are named in code comments with
those IDs; the work order is the section, not a file in this directory. Anything
new under those numbers belongs in a file here.

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
require a deferred item, stop and flag it rather than widening scope.

The declared trade lever under date pressure was P9 (admin console, 18 h) — and
**it has been put back on an explicit instruction**, so P9 is built in full and
nothing is currently held in reserve. See the header of [P9.md](P9.md). It
remains the item that would be traded first if the date came under pressure
again, but as of P28 it is delivered, not deferred, and P28-03 is what that
decision cost: the console became the authoring path anyone would actually use,
and a field missing from it stopped being cosmetic.
