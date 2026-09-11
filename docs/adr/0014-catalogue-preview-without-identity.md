# ADR-0014 · A reading room for a visitor the platform cannot name

- **Status:** accepted
- **Date:** 2026-09-11
- **Ticket:** P213-01
- **Extends:** ADR-0012 (two identity planes), ADR-0002 (tenant isolation by RLS)
- **Review gate:** human — auth

## Context

MEDICE's site has two sign-ins. One is the Keycloak realm ADR-0003 and ADR-0012
describe, and its access token is what every learner-facing route validates.
The other is **DocCheck**: a cookie the site sets to record that a visitor is a
healthcare professional, involving no realm of ours, and yielding nothing the
API can validate.

The platform has always handled such a visitor correctly and unhelpfully. The
WordPress plugin renders `signed-in="no"` for them — `DS_LMS_Token_Source` has
no token to offer — and the widget draws one sentence inviting them to sign in.
A physician who has already proved they are a physician is told to log in, with
no way to see what they would be logging in _for_.

The client asked for the catalogue and the course descriptions to be readable
by that visitor, with participation still behind the MEDICE account.

That is a request to serve **tenant-scoped data to a caller with no principal**,
which every other rule in this repository exists to prevent. It is worth an ADR
because the wrong version of it is small, plausible, and permanent.

## Decision

**There is a third state — no identity at all — and it is a property of the
request rather than a role, a filter or a flag.**

### 1. The permission is a column on the project, and the gate is in SQL

`projects.doccheck_login_allowed` decides. It is read by
`resolve_catalogue_preview(text)` — `SECURITY DEFINER`, owned by the BYPASSRLS
role `ds_binding_resolver`, bounded by `GRANT SELECT (slug, customer_id,
doccheck_login_allowed)`, predicate `doccheck_login_allowed` — which is the only
thing in the system that turns a project slug into a customer id for an
unauthenticated caller.

The same shape as `resolve_project_branding` (0007), `resolve_project_signin`
(0028) and `resolve_public_image` (0054), and for the same reason: a controller
check is one line and can be edited in a hurry, while widening this one is a
migration in a diff.

### 2. Permitting DocCheck and opening the preview are one switch

Not two columns. A DocCheck login produces no platform token, so "this project
offers DocCheck" and "a tokenless visitor may read this project's catalogue" are
the same fact stated twice — and a pair of columns saying one thing is a pair
that eventually disagrees (CLAUDE.md §9.10b).

### 3. The preview reads through the ordinary catalogue query

`runInTenant(pool, { customerId, role: "learner" })`, then the same repository
and the same service the signed-in catalogue uses. RLS applies exactly as it
does for a learner, and the published and validity rules are one implementation.
A second "what is in the catalogue" would be §4 invariant 6 broken in the place
where the two answers are hardest to compare.

### 4. What bounds a preview reader is having no user, not a list of refusals

There is no `isPreview` flag threaded through the screens and no allowlist of
permitted actions. The user id is `undefined`; `CatalogService` therefore runs
no enrolment query, and every route that advances a Fortbildung — enrolment,
watch progress, the Lernerfolgskontrolle, the Evaluationsbogen, the EFN, the
Punktemeldung, the certificate — lives on a controller that requires a
principal and is untouched.

A list of refusals is a list somebody forgets to extend. Having nobody to act as
cannot be forgotten.

### 5. A separate route, not `@Public()` on the existing one

`@Public()` makes the auth guard skip the route entirely, so a signed-in
learner's valid token would be **ignored** and their own enrolment state would
vanish from their own catalogue. Two audiences needing different answers from
the same data is two routes over one service.

### 6. The refusal discloses nothing

A project that does not exist, a project that has not opted in, and a request
with no `X-DS-Project` header all answer the same 404. The platform's customers
are named pharmaceutical companies; a route that told them apart would enumerate
them for the price of one request (CLAUDE.md §9.5).

The widget does not distinguish them either — all three render the signed-out
notice, which is precisely the screen such a visitor saw before this existed.

## Consequences

- **A visitor with no account can read a course description of a project that
  opted in.** That is the intended disclosure and it is per project, off by
  default, and one tick in Verwaltung → Organisation to change.
- **A project must permit at least one sign-in method.** Refused by the domain
  rule, by `updateProject` against the merged pair, and by a CHECK constraint.
- **No CME point can be earned without Keycloak, and nothing here changes
  that.** DocCheck cannot name a physician to the Ärztekammer; a preview reader
  who reaches for participation gets a dialog explaining which account is
  needed and why.
- **The platform still never accepts a DocCheck cookie.** It cannot: DocCheck
  authenticates to the customer's site, not to us. Nothing is parsed, verified
  or trusted from it, and the preview is opened by the project's own setting.
- **Widening this is a migration.** Serving anything else to a tokenless caller
  means changing the function's predicate or its column grant, both of which
  appear in a diff a reviewer reads.
