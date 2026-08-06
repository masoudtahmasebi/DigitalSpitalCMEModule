# ADR-0013 · A person is not their credential

- **Status:** accepted
- **Date:** 2026-08-06
- **Ticket:** P21-01
- **Refines:** ADR-0012 (the learner plane), ADR-0004 (one EFN per physician)
- **Review gate:** human — auth

## Context

Since migration 0001, a learner _was_ their Keycloak credential. `users` was
keyed `UNIQUE (keycloak_realm, keycloak_sub)`, and the realm comes from
`projects.keycloak_issuer` per request. That is a reasonable place to start when
there is one customer, and it is wrong the moment there are two.

The client asked for three things that turned out to be one:

1. a **participant** who signs in to `fortbildung.digitalspital.com` directly,
   when it is not embedded in anyone's website;
2. a learner who **belongs to more than one customer**;
3. the **tenant in the URL** — `/medice`, `/ds` — deciding which catalogue that
   learner sees.

All three run into the same wall. A physician who appears in two customers'
realms is **two rows and two `user.id`s**.

That is not a cosmetic duplicate. `efn_profiles` is `PRIMARY KEY (user_id)` —
one EFN per person, deliberately, because ADR-0004 records what divergent EFNs
across courses do: a Punktemeldung credits the wrong physician's Punktekonto,
which looks exactly like success. Two `user.id`s for one physician is two EFNs
on file, and nothing in the platform can tell that anything is wrong.

Asked directly, the client chose **one person, many customers**.

## Decision

**Identity is three things, and they are stored as three things.**

| Table             | Is               | Keyed on                            | Scope         |
| ----------------- | ---------------- | ----------------------------------- | ------------- |
| `users`           | the **person**   | `id`                                | global        |
| `user_identities` | a **credential** | `(provider, realm, subject)` unique | global        |
| `user_customers`  | a **membership** | `(user_id, customer_id)` unique     | tenant-scoped |

Migration 0025 moves `users.keycloak_realm` and `users.keycloak_sub` into
`user_identities` as one row per existing user. No `users.id` changes:
`enrolments`, `efn_profiles` and `certificates` all reference it, and none of
them may be rewritten.

### Two credentials are linked to one person only by an explicit, verified act

Never automatically because two identity providers reported the same e-mail
address. This is the load-bearing half of the decision.

An automatic e-mail match is account takeover. Any provider that does not verify
e-mail addresses can then assert its way into an existing physician's CME
history and EFN — and the platform cannot tell which providers verify. So a
credential the platform has not seen creates a **new person**, always. The merge
is a deliberate, audited operation (P21-05), refused when both sides already
carry different EFNs, because that is not a merge but a question for a human.

The strongest form this rule can take is having no code that could break it, and
that is the form it takes: `provision_learner` resolves a credential or creates
a person, and has no branch that attaches a credential to somebody who already
exists.

### `users` and `user_identities` stay outside RLS; only the membership is scoped

A person is not a tenant's property. Their EFN, their certificates and their
name belong to them across every customer they learn with — that is the whole
point of the decision above, and it is why `users` has been outside RLS since
migration 0001.

A credential is the same, plus one more reason: the auth guard resolves a
credential _before_ a tenant context exists — the chicken-and-egg at the start
of every request. A tenant-scoped policy on `user_identities` would fail closed
on every single request.

What **is** tenant-scoped is the membership. `user_customers` carries the
`customer_id` and the policy, so a customer admin sees that a person learns with
them and learns nothing about anywhere else that person learns.

### Provisioning moves into the database

`provisionOrUpdate` was one `INSERT … ON CONFLICT DO UPDATE`, and that is _why_
it was race-free on the hot path of every authenticated request: the database
resolved concurrent first sights of the same subject, not the application.

Splitting the credential out costs that property. "Insert a person, then insert
their credential" has a window in which two requests both create a person and
one loses the credential insert — leaving a person row nobody can ever sign in
as, which no later request cleans up.

`provision_learner` (migration 0025) buys it back in one round trip. The
PL/pgSQL sub-block is a savepoint, so the loser's person row rolls back with its
credential and the loop re-reads.

## Rationale

The alternative — keeping one row per credential and reconciling afterwards —
was rejected because the reconciliation has to happen _before_ the first
Punktemeldung, and nothing in the system knows when that is. By the time two
EFNs are visibly divergent, points have been credited to a Punktekonto that
cannot be un-credited: the ÄKWL correction window is seven days and then closes
permanently (`docs/requirements/medice-adhs.md`). A model whose failure mode is
irreversible and silent is not a model to defer fixing.

The cost of doing it now is one migration and one round of code changes across
the auth path, the user repository, the erasure CLI and eight integration
suites. The cost of doing it after launch is the same migration against real
learner data, plus whatever has already been reported wrongly.

## Consequences

**Positive**

- One physician is one CME record: one EFN slot, one certificate history, one
  set of enrolments, regardless of how many customers they learn with.
- A second identity provider — `local` for portal participants (P21-02), Azure
  AD for a future customer — is a new `provider` value, not a schema change.
- Erasure keeps working unchanged, and keeps _sticking_: the credential row
  survives so an erased subject signing in again resolves to the same,
  still-erased person rather than to a fresh one with their name written back.
- Membership is now a first-class fact rather than something inferred from
  enrolments at read time, which is what P21-03 needs to decide what `/medice`
  and `/ds` show.

**Negative**

- A join on the hottest path in the system. Every authenticated request resolves
  a credential, and that is now two tables instead of one. Indexed on the unique
  key, so it is an index lookup rather than a scan, but it is not free.
- Compliance logic in PL/pgSQL. `provision_learner` is a database function that
  a reviewer of the auth path has to read, and it is not covered by the
  TypeScript type system. It is covered by the integration suite and by a
  640-way concurrency probe, which is the trade being made.
- Two people who are really one person can now exist, and nothing detects it
  automatically — by design. Fixing an individual case needs P21-05 and a human.
- The backfill derives memberships from `enrolments`. A learner who was
  provisioned but never enrolled has no membership, which is correct and will
  look like a bug to somebody the first time they see it.

## Alternatives considered

- **Key `users` on `(email)` instead.** Same account-takeover exposure as
  automatic merging, permanently, on every sign-in rather than only at merge
  time. A physician's e-mail also changes; their identity does not.
- **One `users` row per credential, with a `merged_into` pointer.** Keeps every
  read path having to follow the pointer, and every path that forgets to is a
  silent wrong answer. The failure mode is the one this ADR exists to remove.
- **Do the two-insert provisioning in TypeScript with a SAVEPOINT.** Correct, but
  it puts a dedicated client, an explicit transaction and a retry loop on the
  hot path of every request to replicate what the database does in one call.
- **Defer until a second customer actually shares a physician.** The event that
  makes it urgent is indistinguishable from success until points land in the
  wrong Punktekonto, and by then the correction window has closed.
