# ADR-0003 — WordPress ↔ Keycloak session bridge

- **Status:** Accepted
- **Date:** 2026-07-27
- **Ticket:** P1-01, P1-04, P6-02
- **Deciders:** Masoud Tahmasebi

## Context

The learner experience lives inside MEDICE's existing ADHS WordPress site. That
site already authenticates users through `keycloakWordPressPlugin`
(`class-keycloak.php`), which obtains an access token from the Keycloak token
endpoint and reads the profile from `/protocol/openid-connect/userinfo`.

A physician who is already logged into the ADHS site must not be asked to log in
again to start a CME course. A second login would be both a conversion problem and
an identity-reconciliation problem — we would then have two notions of who the
user is, and CME points are legally attached to a specific person.

At the same time, the Education Platform is a separate service holding
accreditation records. It cannot delegate the question "is this user
authenticated?" to a WordPress plugin it does not control and cannot audit.

## Decision

**Reuse the existing Keycloak session; validate the token independently in the
API; never trust WordPress's assertion.**

Flow:

1. The user logs into the ADHS WordPress site as today. The existing plugin holds
   a valid Keycloak access token in the WP session.
2. Our thin WP plugin renders `<ds-lms>`. The token is **not** printed into the
   page HTML. The widget fetches it at runtime from a WordPress REST endpoint that
   serves only logged-in sessions and requires a nonce.
3. The widget sends the token as a bearer to the DS API.
4. The API validates the token **independently against Keycloak JWKS**:
   signature, issuer, audience and expiry, with the JWKS cached in Redis and key
   rotation handled.
5. Identity resolution: Keycloak `sub` is the primary user key; `email` is the
   documented fallback for pre-existing records. Profile data (name, email) is
   taken from the validated token, so no separate profile maintenance exists.
6. The widget refreshes by calling the same WP endpoint before expiry, so a
   learner is never interrupted mid-video.

The extension to the production plugin is exactly one additive, nonce-protected,
feature-flagged endpoint. Nothing else in that plugin changes.

## Rationale

**Independent validation is the whole point.** If the API accepted "WordPress says
this user is logged in", then any XSS on the WordPress site, any plugin
vulnerability, or any misconfiguration in a theme would translate directly into
forged CME participation records. Validating the JWT signature against Keycloak's
published keys means the trust anchor is Keycloak, and WordPress is reduced to a
transport. Checking issuer and audience — not just the signature — is what stops a
validly-signed token minted for a different client or a different realm from being
replayed here.

**The token is fetched, not embedded.** Printing an access token into page HTML
puts it into browser caches, into any full-page cache in front of WordPress, into
the DOM where any script on the page can read it, and potentially into CDN logs.
A nonce-protected endpoint scoped to the logged-in session keeps the token out of
all of those.

**`sub` over `email` as the primary key.** Email addresses change — physicians
move practice, take a new name. A CME record must survive that without splitting
into two identities or merging two people. Keycloak's `sub` is stable and opaque.
Email is retained as a documented fallback only for reconciling records that
predate this decision, and that path is audited.

**Additive and feature-flagged, because the target is production.** The plugin
being extended runs the live MEDICE ADHS site. An additive endpoint behind a flag
can be deployed and then enabled, and disabled instantly if anything is wrong,
without touching the login path that the site depends on.

## Consequences

**Positive**

- No second login; the learner journey starts where the physician already is.
- Compromise of the WordPress site does not by itself yield forged CME records.
- No user profile synchronisation to build or maintain — profile data arrives in
  the validated token.
- The integration surface is one endpoint, so the review conversation with the
  MEDICE team is small and concrete.

**Negative**

- **The API's availability is coupled to Keycloak's.** Mitigated by caching JWKS
  in Redis, so a brief Keycloak outage does not immediately reject valid tokens.
- Access-token lifetime is set by MEDICE's realm configuration, not by us; the
  refresh path must be robust to a short lifetime.
- We depend on write access to a production WordPress plugin repository. **This
  is currently unresolved** (roadmap §12 item 5) and is the critical-path risk for
  M1 on 09.08.
- The widget must handle three distinct states — logged out, token expired,
  refresh failed — each with its own copy.

## Alternatives considered

**Own login in the widget** — a second Keycloak client with its own redirect
flow. Rejected: a second login inside a page the user is already authenticated on
is a poor experience, and it creates a second session to reason about.

**Server-to-server token exchange between WordPress and the DS API** — WordPress
authenticates itself to the API and asserts a user identity. Rejected: this makes
WordPress a trusted identity provider for CME records, which is precisely the
trust relationship this ADR exists to avoid.

**Signed handoff (WordPress signs a short-lived assertion with a shared secret)**
— workable and avoids exposing the Keycloak token to the browser, but it still
makes WordPress the authority on identity, and it introduces a shared secret to
rotate. Rejected for the same reason, with the note that if the MEDICE team
refuses the token-fetch endpoint, this is the fallback to negotiate.
