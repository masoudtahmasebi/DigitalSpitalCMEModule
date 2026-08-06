# ADR-0007 — Headless core, host adapters at the edge

- **Status:** Accepted
- **Date:** 2026-07-27
- **Ticket:** P0-08
- **Deciders:** Masoud Tahmasebi

## Context

The first customer, MEDICE, is delivered inside an existing WordPress site.
Future customers may use a different CMS, a different framework, or no CMS at
all. The requirement is therefore: build WordPress-first without making
WordPress structural.

There is a natural but wrong way to satisfy that, which is worth naming because
it is the shape most codebases reach for: define a `ContentSource` interface,
implement a `WordPressContentSource`, and plan a `StoryblokContentSource` later.

That would be abstracting the wrong thing. **WordPress is not the content source
in this system.** Course content — the hierarchy, compliance settings, quiz
questions, expert profiles, Mediathek assets — is authored in our own admin
console (P9) into our own PostgreSQL schema, under row-level security. Storyblok
integration is explicitly deferred (roadmap §4). Nothing reads course content
from WordPress, today or in the deferred plan.

What WordPress actually provides is exactly two things:

1. **A host surface** — the page that mounts `<ds-lms>` and passes it
   configuration.
2. **An identity bridge** — the Keycloak session the learner already has
   (ADR-0003).

## Decision

**The API is headless and knows nothing about any host. Host-specific concerns
live in adapters outside the core, behind two narrow contracts.**

```
   ┌──────────────────────────────────────────┐
   │  Host adapter  (wordpress/ds-lms today)  │
   │  · mounts <ds-lms> with configuration    │
   │  · exposes the session token to it       │
   └───────────────────┬──────────────────────┘
                       │  HostContext + bearer token
   ┌───────────────────▼──────────────────────┐
   │  <ds-lms> widget — host-agnostic          │
   └───────────────────┬──────────────────────┘
                       │  HTTPS, contracts/openapi.yaml
   ┌───────────────────▼──────────────────────┐
   │  Headless API — no host knowledge at all  │
   │  packages/domain · services · repositories│
   └───────────────────────────────────────────┘
```

**Contract 1 — `HostContext`.** What a host must supply to mount the widget:
an API base URL, a project identifier, a locale, and a way to obtain a bearer
token. Nothing else. Declared as widget input, not as an API concept.

**Contract 2 — token acquisition.** The host exposes an async function
returning a currently-valid token. WordPress implements it by calling a
nonce-protected REST endpoint (P6-02). Another host might use a different
mechanism. The API neither knows nor cares — it validates the token against
Keycloak JWKS regardless (ADR-0003).

**Contract 3 — one outbound event, added by P5-11.** Picking a course in the
catalogue dispatches a cancelable `ds-lms:course-open` carrying
`{ slug, intent }`, where `intent` is `"start"` or `"resume"` (P15-04).

It exists because hosts differ on exactly one thing: **who owns the URL.** A
WordPress page's URL belongs to the theme, so the widget navigates internally
and the host hears nothing it needs to act on. The portal gives each course an
address a learner can bookmark, so it listens, calls `preventDefault()` — which
is the host saying "I am routing" — and pushes a history entry.

The shape is deliberate. It is an event rather than a mode attribute, so there
is no configuration to set wrong and no second code path: a host that does not
listen gets the pre-existing behaviour unchanged. And it is _cancelable_ rather
than notify-only, because both parties navigating would render the course twice.

This is what removed the portal's own catalogue screen — a second React
implementation of the same approved layout, calling the same endpoint. It was
the one place the portal was not behaving like a host adapter.

`intent` was added later, and only because the catalogue has **two** buttons:
_Zur Fortbildung_ opens the course's start page and _Fortbildung fortsetzen_
opens the player at the resume point. A routing host that received only the slug
had no way to tell them apart, so the second button became decorative the moment
the host took over navigation — the widget honoured it and the portal did not.

It is carried back in through the `open-at` attribute rather than a second
event, so the round trip has the same shape as the rest of the contract:
attributes in, events out. A host that ignores `intent` and omits `open-at` gets
the start page for both buttons, which is the pre-existing behaviour and is not
wrong, only less helpful — the same graceful-degradation property as the event
itself. Anything other than the literal `"resume"` means "start": opening a video
a learner did not ask for is the worse of the two failures.

**The full attribute set** is therefore `api-base`, `project`, `course`
(optional), `open-at` (optional), `token-endpoint` (optional), plus the
`tokenProvider` property. Adding to that list is a change to this contract and
belongs in this ADR, not only in the element.

**Rules the core obeys:**

- No `apps/api` module imports anything WordPress-specific, and no API response
  contains a WordPress identifier, URL or nonce.
- The widget receives its configuration through element attributes and an
  injected token provider. It never reads a WordPress global.
- Every capability the widget needs exists in `contracts/openapi.yaml`. If a
  feature only works because WordPress happens to be the host, it is a defect.

**And if a CMS-authored content source is ever wanted** — Storyblok, say — it
enters as an **ingestion adapter** that writes into our canonical schema, not as
a runtime read path. The compliance core keeps a single source of truth for what
a learner did and what a course requires, because two sources would eventually
disagree, and disagreeing numbers on a CME record is a compliance problem.

## Rationale

**Abstracting content would be abstracting the thing we own.** An interface earns
its keep when it has, or credibly will have, more than one implementation.
`ContentSource` would have exactly one forever — our own database — because the
deferred CMS work is an import, not a read path. The cost would be real:
indirection through every catalog query, for a second implementation that never
arrives.

**The host boundary, by contrast, will genuinely have two implementations.** A
Vue wrapper is already on the deferred list, and a second customer on a
different platform is the stated growth path. That is where the seam belongs,
and it is naturally thin — configuration plus a token.

**Keeping the API host-ignorant is also a security property, not only a design
one.** The moment an endpoint accepts a WordPress-supplied identifier as
meaningful, WordPress becomes part of the trust boundary — which is precisely
what ADR-0003 exists to prevent. "The API knows nothing about the host" and "the
API never trusts the host" are the same rule stated twice.

**WordPress-first is a delivery order, not an architectural commitment.** Building
the WordPress adapter first is correct: it is the only one with a paying customer
and a fixed date. Building it _behind a contract_ costs a few hours now and is
what makes the second one cheap.

## Consequences

**Positive**

- The API is testable and deployable with no WordPress anywhere, which is how CI
  runs it today.
- A second host is a new adapter plus its token mechanism — no core change.
- The trust boundary stays where ADR-0003 put it.
- No speculative content abstraction to maintain or explain.

**Negative**

- Two contracts to keep honest, and nothing forces a second implementation to
  exist, so they could drift toward WordPress assumptions without anyone
  noticing. Mitigated by the rule that every widget capability must be in the
  OpenAPI contract.
- The widget needs a token-provider indirection that, with one host, looks like
  ceremony.
- If a customer genuinely wants to author courses in their own CMS, this ADR
  does not solve that — it defers it to an ingestion adapter that is not yet
  designed or costed.

## Alternatives considered

**`ContentSource` port with a WordPress adapter.** The conventional answer, and
wrong here: WordPress holds no course content, so the adapter would be empty and
the interface would have one implementation forever.

**Let the widget read WordPress globals directly** (a `window.dsLms` object).
Simpler, and one less indirection. Rejected: it makes the widget unusable
outside WordPress and puts host state on the trust path.

**Ship a WordPress plugin that proxies the API**, so the browser only ever talks
to WordPress. Would simplify CORS and keep the token server-side — genuinely
attractive. Rejected because it makes WordPress a required runtime dependency
for every request, puts a PHP hop in the path of every progress heartbeat, and
makes the API's availability a function of the host's.
