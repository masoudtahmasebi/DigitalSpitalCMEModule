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
already know. This is the pattern used by `apps/api/src/modules/catalog/` —
copy that module, not this description.

```
apps/api/src/modules/enrolment/
  enrolment.controller.ts     HTTP: parse, authorise, delegate. No SQL, no rules.
  enrolment.service.ts        The use case. Calls domain. Exposes fromDb(db).
  enrolment.repository.ts     Drizzle only. Returns rows. No decisions.
  enrolment.dto.ts            zod schemas in and out.
  enrolment.module.ts         Wiring — controllers only, see below.
  enrolment.service.test.ts   Unit test with a faked repository.
```

**Controller and service/repository are plain classes, not NestJS
request-scoped providers, and this is deliberate — not a simplification.**
`@TenantDb()` (`db/tenant-db.decorator.ts`) reads the tenant-scoped `Db` off
the request; the controller passes it to a `static fromDb(db)` factory on the
service, which constructs its own repository:

```ts
@Get(":id")
@Roles("learner", "customer_admin")
async get(@Param("id") id: string, @TenantDb() db: Db) {
  return EnrolmentService.fromDb(db).getById(id);
}
```

```ts
// enrolment.service.ts
export class EnrolmentService {
  constructor(private readonly repository: EnrolmentRepositoryPort) {}

  static fromDb(db: Db): EnrolmentService {
    return new EnrolmentService(new EnrolmentRepository(db));
  }
  // ...
}
```

**Why not `scope: Scope.REQUEST`,** which looks like the obvious NestJS
answer? Because it does not work here, and the failure is not a compile error —
it surfaces once at runtime, past the guards. `TenantTransactionInterceptor`
opens the transaction and sets `request.db` _after_ `AuthGuard`/`RolesGuard`
run. But when a controller depends on a request-scoped provider, Nest resolves
that provider's entire dependency subtree — controller, service, repository —
while binding the route handler, which happens _before_ guards run. The
repository ends up constructed from a `request.db` that does not exist yet,
for every request, including ones that should have been rejected by
`AuthGuard` before reaching the controller at all. This was caught by an
end-to-end smoke test that actually booted the app and made real HTTP calls
against a real Postgres — no unit test caught it, because unit tests construct
these classes directly and never exercise Nest's request-scope resolution
order. `static fromDb` sidesteps the whole problem: nothing is Nest-managed
past the controller, so there is no resolution order to get wrong, and it
matches how the unit tests already build these classes.

**Reuse the gate; never re-implement it.** Whether a learner may act on a piece
of content is answered in exactly one place —
`LearningService.requireReachableContent` — which resolves the course, the
enrolment and the sequence gate together and returns the rows it had to load
anyway. The quiz module calls it rather than repeating the checks. Two gates
would eventually disagree, and a gate that disagrees with itself is a
compliance incident, not a bug. The same applies to `requireCourse` and
`requireEnrolment`.

**The repository import belongs in the service file, not the controller.**
`EnrolmentController` imports only `EnrolmentService`; `fromDb` is where
`EnrolmentRepository` gets imported and instantiated. A controller importing a
repository — even only to hand it to a service's constructor — fails lint
(ADR-0006): the interface layer should not know a concrete infrastructure
class exists, only the use case it can ask for.

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

| Layer                         | Test style                     | Where                           | Needs infrastructure |
| ----------------------------- | ------------------------------ | ------------------------------- | -------------------- |
| `packages/domain`             | Unit, exhaustive               | `packages/domain/src/*.test.ts` | No                   |
| Service                       | Unit, faked repository         | `<feature>.service.test.ts`     | No                   |
| Contract (DTO ⇄ SDK)          | Type-level assertions          | `apps/api/test/contract/`       | No                   |
| Repository / tenant isolation | Integration, **real Postgres** | `apps/api/test/integration/`    | Yes                  |

`pnpm test` runs the first three; `pnpm test:integration` runs the last, and CI
gives it its own job with Postgres and Redis services.

Never mock the database to test a repository. Tenant isolation is a property of
PostgreSQL RLS (ADR-0002) and a mock will happily "prove" an isolation guarantee
that does not exist.

**The contract chain, and why each link exists.** `contracts/openapi.yaml` is
the source; the SDK generates from it and CI fails if the checked-in generated
output drifts; `apps/api/test/contract/dto-sdk-parity.test.ts` asserts the zod
DTOs and the generated types are mutually assignable; the service tests parse
real responses against those same zod schemas. Break any one link and a shape
the server produces can stop matching the shape the contract promises. When you
add a DTO, add its assertion — the file is a list, and adding to it is one line.

Its `Normalise` helper exists for one reason: `exactOptionalPropertyTypes` makes
zod's `?: T | undefined` and openapi-typescript's `?: T` non-assignable even
though both describe the same JSON. It cancels that on both sides and nothing
else — a required/optional flip or an extra field still fails.

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

## A NestJS gotcha, and why `apps/api` disables one lint rule

`@typescript-eslint/consistent-type-imports` cannot see that NestJS's
`emitDecoratorMetadata` reads a constructor parameter's type as a **runtime**
value, to build `design:paramtypes` for any class Nest constructs via its own
reflection (a plain `providers: [Foo]` entry, or a controller with no custom
factory). Syntactically, `private readonly service: CatalogService` looks like
a type-only usage either way, so the rule's `--fix` will happily rewrite the
import to `import type` and erase the value Nest needs — and the failure shows
up as a dependency-injection error at request time, not a compile error.

That is why `packages/config/eslint.config.js` turns the rule off for
`apps/api/src/**`. It stays on everywhere else, where there is no decorator
metadata to protect.

**Still worth knowing when writing API code:** a class built via a `useFactory`
provider (most of this codebase — see `auth.module.ts`, `catalog.module.ts`) or
a parameter carrying an explicit `@Inject(TOKEN)` never needs the runtime type
at all, factory or `@Inject` supplies it directly. Only a plain provider or
controller constructor parameter with **no** `@Inject()` depends on the type
import being a real one.

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
