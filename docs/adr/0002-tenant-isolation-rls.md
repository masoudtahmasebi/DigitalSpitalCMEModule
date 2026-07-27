# ADR-0002 — Tenant isolation via PostgreSQL row-level security

- **Status:** Accepted
- **Date:** 2026-07-27
- **Ticket:** P0-04, verified by P10-02
- **Deciders:** Masoud Tahmasebi

## Context

The platform is multi-tenant from day one: MEDICE is the first customer,
Trommsdorf is the named second. Tenant data includes CME participation records
tied to named physicians and their EFN — personal data under GDPR, held for an
accreditation purpose.

A cross-tenant data leak here is not a bug with a patch; it is a reportable data
protection incident involving health-professional records.

The natural implementation under time pressure — every repository method takes a
`customerId` and puts it in the `WHERE` clause — fails in exactly one way: it
works until someone writes a query that forgets. There is no compile-time signal
and no runtime signal. The failure is silent, and most of this code is generated.

## Decision

**Tenant isolation is enforced by PostgreSQL row-level security. Application-level
filtering is defence in depth, never the only defence.**

Concretely:

1. `customer_id uuid not null` is denormalised onto **every** tenant-scoped table,
   including deeply nested ones (`chapters`, `contents`, `quiz_answers`,
   `content_progress`), even though it is derivable by joining upward.

2. Every such table carries the same policy shape:

   ```sql
   alter table <t> enable row level security;
   alter table <t> force row level security;

   create policy <t>_tenant_isolation on <t>
     using (customer_id = current_setting('app.customer_id', true)::uuid)
     with check (customer_id = current_setting('app.customer_id', true)::uuid);
   ```

3. Two database roles:
   - `ds_migrator` — owns the schema, runs migrations. Not used by the application.
   - `ds_app` — used by the API. **Not** `BYPASSRLS`, and not the table owner
     (hence `force row level security`, so that ownership can never quietly
     exempt it).

4. A NestJS interceptor sets `app.customer_id` (and `app.role`) via
   `set_config(..., true)` — transaction-scoped — at the start of every request's
   transaction, derived from the validated token, never from a client-supplied
   parameter.

5. Super-admin access (DigitalSpital operating across customers) is **not** a
   `BYPASSRLS` role. It is an explicit, audited code path that sets
   `app.customer_id` to the customer being acted upon, one customer at a time.

## Rationale

**The denormalised `customer_id` is the price of a uniform policy.** Without it,
the policy on `quiz_answers` would need a three-join subquery to reach
`customers`, evaluated per row. That is both slow and — more importantly — a
different policy expression on every table, which means each one is a separate
opportunity to write it wrong. One shape, repeated verbatim, is reviewable at a
glance. The cost is that `customer_id` must be set correctly on insert, which the
`with check` clause enforces: an insert carrying the wrong tenant is rejected by
the database.

**`force row level security` is not optional.** Table owners bypass RLS by
default. Without `force`, an environment where `ds_app` happened to own the tables
would silently have no isolation at all — and that is exactly the kind of drift a
staging or a hastily-provisioned Hetzner box produces.

**Transaction-scoped `set_config` matters because connections are pooled.** A
session-scoped setting would leak the previous request's tenant to the next
request that borrows the same connection. That is the most likely real-world
failure mode of this design, and the `true` (local) flag is what prevents it.

**Super admin is deliberately awkward.** A `BYPASSRLS` super-admin role would make
DigitalSpital's own operations easy and would also mean one bug in role resolution
exposes every customer. Forcing super admin through "act as this one customer"
keeps the blast radius of any such bug to a single tenant and produces an audit
trail of which customer was accessed.

## Consequences

**Positive**

- A generated repository method that forgets its tenant filter returns zero rows
  rather than another customer's data. The failure mode becomes loud.
- The isolation guarantee is testable as a property of the database: set
  `app.customer_id` to customer B, query customer A's data, assert zero rows.
  This is the dedicated suite in P10-02.
- GDPR posture is defensible in writing — isolation is a schema-level control, not
  a code-review convention.

**Negative**

- `customer_id` must be maintained on every insert down the hierarchy; a missing
  value is a runtime rejection, not a compile error. Mitigated by `not null` plus
  `with check`.
- Every request needs a transaction, including simple reads. Accepted.
- Debugging with a plain `psql` session shows no rows until `app.customer_id` is
  set. Documented in the runbook.
- Migrations must run as a different role than the application, which the deploy
  pipeline has to handle explicitly.

## Alternatives considered

**Application-level filtering only** — the fastest to build and the standard
approach. Rejected: silent failure mode, no test that can prove absence of a leak,
and a codebase where most queries are generated.

**Database-per-tenant** — the strongest isolation available. Rejected as
disproportionate at two known customers: it multiplies migration, backup,
connection-pool and provisioning work across every phase, and P10 has 10 h total
for all of hardening and deployment.

**Schema-per-tenant** — a middle ground. Rejected for the same operational reason,
and because it makes cross-tenant super-admin reporting (P9) materially harder
than the "act as one customer" path chosen above.
