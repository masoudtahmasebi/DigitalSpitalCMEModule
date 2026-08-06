# ADR-0012 · Two identity planes: local staff accounts, federated learners

- **Status:** accepted
- **Date:** 2026-08-05
- **Supersedes in part:** ADR-0003 (which assumed one Keycloak realm authenticates
  everybody, staff included)
- **Review gate:** human — auth

## Context

ADR-0003 established that the API never trusts WordPress and validates every
bearer token against Keycloak's JWKS. That is correct and stays correct — for
**learners**. It was also applied to the admin console, and that is the part
this ADR revisits.

Two facts made the single-realm model wrong:

1. **The admin console belongs to the platform, not to a customer.** Its users
   are DigitalSpital staff and customer administrators. They exist before any
   customer's Keycloak does, they persist if a customer changes identity
   provider, and a super administrator spans customers — so there is no realm
   that could own them. Binding them to MEDICE's realm would mean DigitalSpital
   staff cannot sign in to their own product unless MEDICE's Keycloak is up, and
   that MEDICE's Keycloak administrators can mint DigitalSpital super admins.

2. **Keycloak is MEDICE's choice, not the platform's.** The next customer may
   run Azure AD, a different OIDC provider, or a SAML IdP. Learner
   authentication has to be replaceable per project without touching the guard,
   the schema or any endpoint.

The trigger was mundane and worth recording: getting a single audience claim
added to one Keycloak client (`docs/show-stoppers.md` S17) blocked every admin
screen as well as every learner. One customer's identity configuration should
never be able to lock the platform's operators out of the platform.

## Decision

**There are two identity planes. They share the authorization model and share
nothing else.**

### Plane 1 — staff, local to the platform

Administrators authenticate against this platform's own account store.

- `admin_users` holds the account: email, Argon2id password hash, display name,
  status, failed-attempt counter, TOTP secret.
- Sessions are **opaque server-side rows**, not JWTs, so a session can be
  revoked the instant an account is disabled. A signed token cannot be.
- The session id travels in an httpOnly, Secure, `SameSite=Lax` cookie scoped to
  the parent domain, so the console (`verwaltung.…`) and the API (`api.…`) are
  same-site and the browser sends it without the token ever being reachable
  from JavaScript. A double-submit CSRF token guards state-changing requests.
- TOTP second factor is **required for `super_admin`** and optional below it. A
  super administrator can read the participation records of every physician on
  the platform; a password alone is not a proportionate control for that.

  _Amended by P22-02:_ this is now the **default** rather than a constant. The
  reasoning above is unchanged and the platform still ships `required` for
  accounts belonging to no customer, but the value is a row in
  `admin_2fa_policy` that a super administrator may change, per customer and for
  the platform, with every change audited. A policy nobody can change is not a
  policy — and the same ticket added the reset path this ADR left out, without
  which a lost authenticator locked an enrolled operator out permanently.

- No self-registration. Accounts are created by invitation from an existing
  administrator at or above the invitee's scope.

### Plane 2 — learners, federated per project

Learners keep ADR-0003 exactly: the API independently validates every bearer
token — signature, issuer, audience, expiry — and never trusts the host page.

What changes is that the verification sits behind an `IdentityProvider` port.
`projects.identity_provider` names the implementation and the existing
`keycloak_*` columns become that implementation's configuration. `keycloak` is
the only implementation today; adding a second is a new class and a row value,
not a change to the guard.

### What the two planes share

`Principal` remains the single resolved identity for a request, and
`resolveTenantContext` in `packages/domain` remains the single authorization
rule. Both planes end at the same place:

```
staff:   cookie → session row → admin_user → grants ─┐
                                                     ├→ resolveTenantContext → Principal → RLS
learner: bearer → IdentityProvider → user   → grants ─┘
```

`Principal.keycloakSub` is renamed `subject` and gains `identity: "staff" |
"learner"`. Nothing downstream branches on it — RLS, audit and role checks all
read the same fields as before — but a record of _which plane_ authenticated is
what lets the EIV audit log say whether a submission was triggered by a
physician or by an operator.

That record is a stored column, `audit_log.actor_identity` (migration 0020), and
not a lookup against the two tables. Both populations are erasable — learners by
`erase_subject`, operators under the same subject-rights obligation — so a
lookup performed years later answers "neither", which is the one answer that is
certainly wrong. An append-only log has to be readable without the system that
produced it.

In application code the pair is a single discriminated union, `AuditActor`, so
an id without a population and a population without an id are both
unrepresentable; `audit_log_actor_identity_agrees` enforces the same rule at the
database. The duplication is deliberate — one of the two catches the mistake
before it is written, the other catches it if the first is ever bypassed.

## Consequences

**Good.**

- A customer's identity outage or misconfiguration cannot lock operators out.
- Learner authentication becomes a per-project choice, which is what makes a
  second customer possible without a fork.
- Staff sessions are revocable, which JWT-based admin auth is not.
- The blast radius of a compromised customer Keycloak stops at that customer's
  learners.

**Costs, accepted.**

- The platform now stores password hashes and is responsible for their
  handling: Argon2id, no password in any log, lockout after repeated failure,
  and a reset flow that does not reveal whether an address exists.
- Two authentication paths to keep correct instead of one. Mitigated by their
  meeting at `resolveTenantContext`, which is pure and exhaustively tested, so
  the _authorization_ half cannot diverge even though the _authentication_ half
  is deliberately separate.
- Cookie-based auth brings CSRF, which bearer tokens do not have. Handled by
  `SameSite=Lax` plus a double-submit token, and by the API refusing any
  state-changing request whose `Origin` is not in the allow-list.

**Explicitly rejected.**

- _A Keycloak realm of our own for staff._ It removes the customer-outage
  coupling but keeps an external dependency in the login path of our own
  operations tooling, and adds a realm to run, patch and back up for what is a
  few dozen accounts.
- _JWTs for staff sessions._ Revocation is the whole point. An access token
  short enough to make revocation lag acceptable is short enough to need a
  refresh flow, which is a session by another name with worse properties.
- _Storing the session id in `localStorage`._ Reachable from any script that
  gets into the console's origin; an httpOnly cookie is not.

## Notes

Learners are never given a platform password. A physician's identity stays with
the customer's IdP, which is what keeps this platform out of scope as an
identity provider for medical professionals and keeps ADR-0004's
data-minimisation position intact.
