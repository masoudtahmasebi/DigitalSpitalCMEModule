# Contributing

Written for **humans and AI agents alike**. Most implementation here is
generated, so this file exists to make the right thing the obvious thing: if you
follow the template below, your change will pass CI and be reviewable in
minutes. If you invent a new shape, it will not.

Read `CLAUDE.md` first for the standing rules. This file is the _how_.

---

## The one-minute version

```bash
pnpm install
pnpm infra:up          # postgres, redis, keycloak, mailpit
pnpm verify            # lint + format + typecheck + test + audit — run before every push
```

Every change needs: a ticket in `docs/backlog/`, tests, and a commit message
starting with the task ID (`P3-02: …`).

---

## Where code goes — ADR-0006 in one diagram

Dependencies point **strictly inward**. Boundaries are enforced by lint, not by
review, so a violation fails your build rather than a reviewer's attention.

```
   interface   controllers, DTOs, widget, admin console
       ↓
  application  services — use cases, orchestration, transactions
       ↓
    domain     packages/domain — compliance rules, pure, zero dependencies
       ↑
infrastructure repositories, Redis, EIV client, SMTP
```

| If you are writing…               | It goes in                | It may import                |
| --------------------------------- | ------------------------- | ---------------------------- |
| An HTTP route                     | `<feature>.controller.ts` | its service, its DTOs        |
| A use case, a transaction         | `<feature>.service.ts`    | `@ds/domain`, its repository |
| SQL, an external API call         | `<feature>.repository.ts` | `@ds/domain`, drizzle        |
| A rule that decides a CME outcome | **`packages/domain`**     | nothing                      |
| Request/response shapes           | `<feature>.dto.ts`        | zod                          |

**The single most important rule:** if the code decides whether a learner
watched enough, passed, completed, or when an EIV deadline falls — it belongs in
`packages/domain`, as a pure function, with exhaustive tests. Not in a service,
not in a controller, never in the frontend.

---

## Adding a feature — the template

Copy this shape exactly. Uniformity is worth more than local cleverness: a
reviewer checking your fifth feature should be diffing against a shape they
already know.

```
apps/api/src/modules/enrolment/
  enrolment.controller.ts     HTTP: parse, authorise, delegate. No SQL, no rules.
  enrolment.service.ts        The use case. Owns the transaction. Calls domain.
  enrolment.repository.ts     Drizzle only. Returns rows. No decisions.
  enrolment.dto.ts            zod schemas in and out.
  enrolment.module.ts         Wiring.
  enrolment.service.test.ts   Unit test with a faked repository.
```

### 1. Start from the ticket

No ticket, no code (`CLAUDE.md` §2). The ticket carries acceptance criteria; your
PR ticks them off. If the ticket is ambiguous about a **compliance rule**, stop
and ask — `CLAUDE.md` §7. An invented rule that ships is worse than a delay.

### 2. Contract first, if the API surface changes

Update `contracts/openapi.yaml` **before** implementing, then
`pnpm --filter @ds/sdk generate`. CI fails if the generated SDK drifts from the
contract. This is what lets frontend and backend proceed in parallel.

### 3. Write the domain rule first, if there is one

Pure function in `packages/domain`, with tests covering the boundaries — not
just the happy path. Exactly at the threshold, one below it, empty input, and
the degenerate case. That suite runs in milliseconds with no infrastructure,
which is why it stays green.

### 4. Then the layers outward

Service orchestrates and owns the transaction. Repository does data access.
Controller does HTTP. Each has one job.

### 5. Tests

| Layer                         | Test style                     | Needs infrastructure |
| ----------------------------- | ------------------------------ | -------------------- |
| `packages/domain`             | Unit, exhaustive               | No                   |
| Service                       | Unit, faked repository         | No                   |
| Repository / tenant isolation | Integration, **real Postgres** | Yes                  |
| Contract                      | Derived from `openapi.yaml`    | Runs in CI           |

Never mock the database to test a repository. Tenant isolation is a property of
PostgreSQL RLS (ADR-0002) and a mock will happily "prove" an isolation guarantee
that does not exist.

---

## Definition of done

Your PR is ready when:

- [ ] Acceptance criteria from the ticket are met and ticked in the PR body
- [ ] `pnpm verify` passes locally
- [ ] New compliance logic lives in `packages/domain` and is exhaustively tested
- [ ] No secret in code, in logs, or in an API response
- [ ] No personal data (EFN, name, free-text evaluation) in any log
- [ ] `contracts/openapi.yaml` updated first if the API changed, SDK regenerated
- [ ] Commit messages are `<TASK-ID>: imperative summary`
- [ ] Docs touched by the change are updated in the same PR

---

## The human review gate

Anything touching **auth**, **assessment**, **eiv** or **certificates** requires
human review before merge. A wrong result in those four areas is a compliance
incident, not a bug. `CODEOWNERS` enforces this automatically — you cannot
self-merge those paths.

---

## Commits and branches

```
Branch:  P3-02-watched-segment-ingestion
Commit:  P3-02: reject segments claiming more playback than wall-clock elapsed
```

Write the commit body to explain **why**, not what — the diff already says what.
If you made a judgement call, record it there or in an ADR.

---

## When to write an ADR

Write one for decisions that are **expensive to reverse**: a schema shape, a
trust boundary, an external contract, a layering rule. Not for choices you could
change in an afternoon.

Copy the structure of an existing record in `docs/adr/`. A record without honest
negatives in its Consequences section is not a decision, it is an advertisement.

---

## Notes specifically for AI agents

- **Do not widen scope.** The deferred list in `docs/roadmap.md` §4 is
  contractual. If a task seems to need a deferred item, stop and flag it.
- **Do not invent compliance semantics.** EIV deadlines, CME point rules and
  certificate content come from the Anerkennungsbescheid and
  `docs/requirements/medice-adhs.md`. If it is not written down, ask.
- **Copy the module template, not the nearest file.** The nearest file may
  predate a convention.
- **Read `docs/show-stoppers.md`** before starting anything touching
  certificates or the WordPress bridge — parts of both are blocked on external
  answers, and building ahead of them wastes the budget.
- **Prove your guard rails fire.** If you add a lint rule or a validation, write
  the case that should fail and confirm it does. An unenforced rule is worse
  than none, because it is trusted.
