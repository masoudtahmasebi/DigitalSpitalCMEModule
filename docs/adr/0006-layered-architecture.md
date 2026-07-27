# ADR-0006 — Enforced layered architecture

- **Status:** Accepted
- **Date:** 2026-07-27
- **Ticket:** P0-07
- **Deciders:** Masoud Tahmasebi

## Context

Most of this codebase will be written by AI agents against written specs. That
is the delivery model (roadmap §1) and it is what makes 140 h viable. It also
creates a failure mode that a human-only team does not have, at least not at the
same speed:

**Generated code converges on whatever shape it already sees.** An agent asked to
"add an endpoint" will copy the nearest existing endpoint. If that endpoint
happens to query the database directly from a controller, the next twenty will
too. Nobody decided that; it accreted. By the time a human notices, the pattern
is load-bearing in thirty files and refactoring it costs more than the feature
did.

The second-order problem is throughput. Code arrives faster than a single
reviewer can read it carefully. Review degrades into skimming, and skimming
catches style but not structure. The reviewer becomes the bottleneck and the
quality gate simultaneously, and fails at both.

Three properties are therefore required of the structure itself, not of the
people working in it:

1. A new contributor — human or agent — must be able to infer where a file goes
   without asking.
2. An architectural violation must fail **mechanically**, in CI, not depend on a
   reviewer noticing.
3. Compliance-critical logic must stay isolated from framework and I/O concerns,
   so it remains exhaustively testable no matter how much surrounding code
   accumulates.

## Decision

**Four layers, with dependencies pointing strictly inward, enforced by lint.**

```
   interface   HTTP controllers, DTOs, the widget, the admin console
       ↓       may import: application, and shared types only
  application  use cases, orchestration, transactions
       ↓       may import: domain, and infrastructure PORTS (not adapters)
    domain     compliance rules — pure, zero dependencies
       ↑
infrastructure adapters: Drizzle repositories, Redis, EIV client, SMTP
               may import: domain (to satisfy a port), never application/interface
```

Concretely, in `apps/api/src`:

```
modules/<feature>/
  <feature>.controller.ts     interface   HTTP only: parse, authorise, delegate
  <feature>.service.ts        application use case; owns the transaction
  <feature>.repository.ts     infrastructure Drizzle; the only place SQL lives
  <feature>.dto.ts            interface   zod schemas in and out
  <feature>.module.ts         wiring
  <feature>.service.test.ts   unit, with a faked repository
```

Three rules make this real rather than aspirational:

1. **`packages/domain` stays pure** (already ADR-0001/§4-invariant-4, enforced by
   `purity.test.ts`). Every compliance rule lives there and nowhere else.
2. **Controllers never touch a repository or the database.** They call a service.
   A controller that imports a repository fails lint.
3. **Repositories never contain a business rule.** They read and write rows. A
   decision about whether a learner passed belongs in `packages/domain`, invoked
   by a service.

**Ports and adapters at the edges.** Anything external — the CMS, EIV, SMTP,
object storage — is reached through an interface defined by the application
layer and implemented in infrastructure. That is what keeps "we must support any
CMS" a configuration change rather than a rewrite (see ADR-0007).

## Rationale

**Boundaries that are checked are the only boundaries that exist.** A convention
in a style guide is advice; `import/no-restricted-paths` in the lint config is a
build failure. The difference matters more with generated code than with
hand-written code, because an agent has no memory of the style guide but always
sees the CI result. This ADR is therefore paired with mechanical enforcement, and
without that enforcement it would be worthless.

**The layering is chosen for testability, not elegance.** The reason controllers
must not query the database is that a service with a faked repository is testable
in milliseconds with no docker, and a controller with embedded SQL is not
testable at all without one. Given that `packages/domain` must be exhaustively
covered and the API integration suite needs a real Postgres, keeping the middle
layer fast and fake-able is what lets the pyramid stay wide at the bottom.

**One module template, repeated.** Uniformity is more valuable than local
optimisation here. When every feature has the same five files in the same order,
an agent asked to add a sixth feature produces something a reviewer can check by
diffing against the shape they already know. Novelty in structure costs review
attention that should be spent on the compliance logic.

**Why not a single-layer "pragmatic" NestJS app**, with services querying
directly? It is faster for the first ten endpoints and slower for every endpoint
after that, and it makes the compliance logic reachable only through a database.
Given that a wrong result in assessment or EIV is a reportable incident rather
than a bug, the isolation is worth the ceremony.

**Why not full hexagonal/clean architecture with a mapper at every boundary?**
Because 140 h. Mapping every entity to a domain object and back would be
defensible in a larger budget; here it would consume the phases that deliver the
product. The chosen middle ground — pure domain, thin services, repositories
returning typed rows — captures most of the benefit at a fraction of the cost.

## Consequences

**Positive**

- Where a file goes is answerable from the directory listing alone, so
  onboarding a contributor or an agent costs a link to `CONTRIBUTING.md`.
- Architectural drift fails CI on the pull request that introduces it, when it
  costs minutes, instead of in month three when it costs a refactor.
- Review attention moves from "is this in the right place" to "is this rule
  correct", which is where a human reviewer is actually irreplaceable.
- Business logic is testable without infrastructure, so the fast suite stays fast
  and therefore stays green.

**Negative**

- More files per feature than a direct implementation. A trivial read endpoint
  still costs a controller, a service and a repository.
- The indirection is genuinely unnecessary for the simplest CRUD, and will feel
  like bureaucracy on those. Accepted deliberately: the cost of the uniform shape
  is paid on easy features and repaid on hard ones.
- Lint rules encoding paths are themselves a thing to maintain, and will need
  updating whenever the module layout legitimately changes.
- A determined contributor can still route around the rules (dynamic import, a
  re-export barrel). The enforcement raises the cost of drift; it does not make
  drift impossible.

## Alternatives considered

**Convention documented in `CLAUDE.md` only, enforced in review.** Zero tooling
cost. Rejected: it fails precisely under the conditions this project operates in
— high volume, generated code, one reviewer. A rule that depends on a tired
human noticing is not a rule.

**Nx with enforced module boundaries.** A stronger, more mature version of the
same idea, with tags and a dependency graph. Rejected for this budget: migrating
the existing turborepo setup and learning the tag system costs more than the
`import/no-restricted-paths` rules deliver here. Worth revisiting if the repo
grows past a handful of apps.

**Separate published packages per layer**, so boundaries are enforced by npm
resolution. The strongest enforcement available. Rejected: versioning and release
overhead for internal layers would dominate a six-week schedule.
