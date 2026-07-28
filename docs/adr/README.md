# Architecture Decision Records

ADRs record decisions that are **irreversible or expensive to reverse**. A choice
that can be changed in an afternoon does not need an ADR; a choice that would
require a data migration, a renegotiation with the client, or a rewrite of a
compliance-sensitive path does.

Each record states the context that forced the decision, the decision itself, why
it was made over the alternatives, and what it costs. The consequences section is
not decoration — a record without honest negatives is not a decision, it is an
advertisement.

## Index

| ADR                                             | Title                                                          | Status   |
| ----------------------------------------------- | -------------------------------------------------------------- | -------- |
| [0001](0001-monorepo-and-stack.md)              | Monorepo and technology stack                                  | Accepted |
| [0002](0002-tenant-isolation-rls.md)            | Tenant isolation via PostgreSQL row-level security             | Accepted |
| [0003](0003-keycloak-session-bridge.md)         | WordPress ↔ Keycloak session bridge                            | Accepted |
| [0004](0004-efn-system-of-record.md)            | EFN is stored in our PostgreSQL as system of record            | Accepted |
| [0005](0005-eiv-contract-first.md)              | EIV-FOBI integration is built contract-first, behind a harness | Accepted |
| [0007](0007-headless-core-and-host-adapters.md) | Headless core, host adapters at the edge                       | Accepted |
| [0006](0006-layered-architecture.md)            | Enforced layered architecture                                  | Accepted |
| [0008](0008-erasure-is-pseudonymisation.md)     | Erasure means pseudonymisation, not deletion                   | Accepted |
| [0009](0009-no-third-party-frontend-assets.md)  | No third-party frontend assets; fonts are uploaded             | Accepted |

## Writing a new one

Copy the structure of an existing record: Status / Date / Ticket / Deciders,
then Context, Decision, Rationale, Consequences (positive **and** negative),
Alternatives considered.

Number sequentially. Never edit an accepted record to change its decision —
supersede it with a new one and set the old record's status to
`Superseded by ADR-NNNN`.
