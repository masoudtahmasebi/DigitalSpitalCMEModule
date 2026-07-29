# Architecture

How the DS Education Platform is put together, and why it is put together that
way. The individual irreversible decisions have their own records in
[`adr/`](adr/README.md); this document is the map that says which one applies
where, and it covers the reasoning that is spread across several of them.

`CLAUDE.md` is the enforced version of the rules below. Where the two disagree,
`CLAUDE.md` wins and this file is out of date.

---

## 1. The constraint that shapes everything

A CME point is not a score in a learning app. It is reported under a
Veranstaltungsnummer to a Landesärztekammer, credited against a named
physician's Fortbildungskonto through their EFN, and evidenced by a
Teilnahmebescheinigung that may be inspected years later. The Ärztekammer
Westfalen-Lippe's Anerkennungsbescheid sets conditions — at least 70 % correct
answers, reporting within 8 days of the Veranstaltungsende, a 7-day correction
window, then permanent closure.

Two things follow, and almost every structural decision in this repository is
one of them applied somewhere:

**A wrong compliance answer is not a bug, it is a false attestation.** So every
decision that affects a point is made in one place, on the server, and is
testable in isolation.

**Some mistakes cannot be undone.** A Punktemeldung cannot be withdrawn after
the correction window closes. An erasure cannot be reversed. So the code refuses
rather than guesses, and the places where it refuses are the places worth
reading first.

---

## 2. Shape

```
   WordPress (customer's site)     Portal (ours)      Admin console (Vite SPA)
              │                          │                        │
     <ds-lms> custom element   <ds-lms>, same bundle              │
     shadow root, no cookies             │                        │
              │  token from              │  token from            │  token from
              │  /wp-json/…/token        │  OIDC + PKCE           │  OIDC + PKCE
              ▼                          ▼                        ▼
      ┌──────────────────────────────────────────────────────────────┐
      │                        API (NestJS)                          │
      │     AuthGuard → RolesGuard → TenantTransactionInterceptor     │
      │            every decision that affects a CME point            │
      └──────────────────────────────────────────────────────────────┘
              │                    │                    │
              ▼                    ▼                    ▼
      PostgreSQL 16          Redis (limits,      accreditationReporter
      RLS per tenant          cache)             → EIV-FOBI (Ärztekammer)
```

Everything the learner and the admin see is a rendering of what the API
returned. No frontend holds a rule.

The two learner surfaces are **host adapters** and are equals
([ADR-0007](adr/0007-headless-core-and-host-adapters.md)): a page that mounts
`<ds-lms>` and supplies a token. They load the same bundle, built once. The API
cannot tell them apart, and that is the property being asserted — a second host
that shares no code with the first is how "headless" stops being a claim and
becomes a test.

`accreditationReporter` is drawn as a seam because it is one
([ADR-0010](adr/0010-extension-points.md)). EIV-FOBI is the implementation; the
platform decides _whether_ a Punktemeldung is due and the reporter only carries
it.

### Requests, in order

1. **`AuthGuard`** reads `X-DS-Project`, resolves the project binding through a
   `SECURITY DEFINER` function (there is no tenant context yet — that is the
   chicken-and-egg it solves), then validates the bearer token against _that
   project's_ Keycloak realm: signature, issuer, audience, expiry. WordPress's
   word that somebody is signed in is never evidence
   ([ADR-0003](adr/0003-keycloak-session-bridge.md)).
2. **`RolesGuard`** checks the role assigned **locally**, not a claim in the
   token. A crafted claim cannot escalate.
3. **`TenantTransactionInterceptor`** opens a transaction, sets
   `app.customer_id` transaction-locally, and — importantly — writes the
   response only after `COMMIT`. A learner must never hold a certificate the
   database has no record of issuing.
4. The controller parses input with zod, calls a service, and returns a value.
   Controllers make no decisions.

---

## 3. Layering, and why it is enforced mechanically

`interface → application → infrastructure`, with `packages/domain` beneath all
three and depending on nothing.

| Layer          | Contains                              | May import                   |
| -------------- | ------------------------------------- | ---------------------------- |
| Interface      | controllers, guards, DTO parsing      | application, domain          |
| Application    | services, use cases                   | infrastructure ports, domain |
| Infrastructure | repositories, HTTP clients, renderers | domain                       |
| Domain         | the rules                             | nothing                      |

This is enforced by ESLint `no-restricted-imports` scoped by file glob, not by
convention ([ADR-0006](adr/0006-layered-architecture.md)). The reason is
specific to how this codebase is written: most of it is generated by agents
against written specs, and **generated code converges on whatever shape it
already sees**. One controller that queries the database directly becomes twenty
before a human notices. A rule that fails the build is the only kind that holds
at that speed.

### `packages/domain` is pure

Zero I/O, zero framework imports, no clock and no randomness — time is always an
argument. Everything that decides a compliance outcome lives there:

| Module                        | Decides                                             |
| ----------------------------- | --------------------------------------------------- |
| `watch.ts`, `coverage.ts`     | how much of a video was actually watched            |
| `gating.ts`                   | whether a chapter is reachable                      |
| `progress.ts`                 | the rollup every screen and report reads            |
| `assessment.ts`               | whether a quiz was passed                           |
| `completion.ts`               | whether a course is finished                        |
| `eiv.ts`, `eiv-retry.ts`      | when a Punktemeldung is due, and when to retry      |
| `certificate.ts`              | whether a certificate can be issued at all          |
| `berlin.ts`                   | German calendar arithmetic and presentation         |
| `authorization.ts`            | which tenant a principal may act within             |
| `storage-key.ts`              | whether an object-storage key belongs to a customer |
| `branding.ts`, `font-file.ts` | what a white-label value may contain                |

`purity.test.ts` enforces this mechanically: it asserts the package declares no
runtime dependencies, imports nothing outside itself, and contains no clock,
randomness, environment or console read — and it has its own tests proving the
check still fires on real code and does not fire on the same words inside a
comment. A guard that cries wolf gets disabled.

Purity buys three things. The rules are exhaustively testable without a
database, which is why the fast suite is a fast suite. They are readable as
rules rather than as queries. And — the reason that actually matters here — they
are safe to generate, because a pure function with total test coverage either
works or does not, and the test says which.

---

## 4. Tenant isolation

`customer_id` on every tenant-scoped table, `ENABLE` **and** `FORCE ROW LEVEL
SECURITY`, one policy shape repeated verbatim, and an application role that is
**not** `BYPASSRLS` and owns nothing ([ADR-0002](adr/0002-tenant-isolation-rls.md)).

`current_setting('app.customer_id', true)` returns NULL when unset and NULL
matches nothing, so a request that somehow reaches the database without a tenant
context sees zero rows rather than everything. The system fails closed.

Application code that also filters by `customer_id` is defence in depth. It is
never the defence, and a dedicated integration suite attempts cross-tenant reads
and asserts zero rows.

**Two roles bypass RLS, deliberately, and neither can be connected as:**

- `ds_binding_resolver` owns the pre-authentication lookups — resolving which
  tenant a project slug belongs to, before a tenant context can exist, plus the
  public branding and font reads. Column-level grants, so it cannot see the
  Keycloak binding or the SMTP settings on the same row.
- `ds_erasure` owns `erase_subject`. A GDPR erasure is cross-tenant by nature —
  one physician has one EFN and may hold enrolments at several customers — so
  there is no tenant context in which the operation is even expressible
  ([ADR-0008](adr/0008-erasure-is-pseudonymisation.md)).

An earlier draft of the erasure ran as `ds_migrator` and every UPDATE matched
zero rows under `FORCE ROW LEVEL SECURITY`, reporting success having erased only
the columns that are not tenant-scoped. That failure is why the roles are shaped
this way and not by preference.

---

## 5. Contract-first

`contracts/openapi.yaml` is written **before** the implementation. From it:

```
contracts/openapi.yaml
  → openapi-typescript → packages/sdk/src/generated/schema.ts
      → type-level parity assertions (apps/api/test/contract)
          → zod DTOs validated at runtime
```

The parity test is a compile-time assertion that the server's zod schema and the
contract's generated type are mutually assignable. A field added to the database
and the DTO but not the contract — or the reverse — fails the build rather than
a reviewer's attention. It has caught real mistakes, including a `nullable: true`
written in a 3.1 document where it means nothing.

The point is not documentation. It is that the frontend and the backend can be
built in parallel against something that cannot drift silently, which is what
makes the schedule possible.

---

## 6. The learner widget, and its two hosts

A **Shadow-DOM custom element**, not a mounted SPA
([ADR-0007](adr/0007-headless-core-and-host-adapters.md)).

It runs inside somebody else's WordPress theme. A theme will ship
`* { box-sizing: content-box }` or a reset that lands after our stylesheet; an
open subtree would inherit all of it and the widget's appearance would depend on
the customer's next theme update. A closed shadow root ends that in both
directions — the host's CSS cannot reach in, and Tailwind's utilities cannot
leak out onto the host's markup.

`mode: "closed"` specifically: nothing outside needs to reach in, and a page
script that could would be able to read a physician's participation data out of
the DOM.

Things that surprise people:

- **The token is never in the page HTML.** The plugin attaches a token provider
  function; the widget fetches from `/wp-json/ds-lms/v1/token` with a nonce.
- **The token is held in a closure.** No cookie, no `localStorage`, no
  `sessionStorage` — so §25 TTDSG has nothing to consent to.
- **`@font-face` is injected into the document, not the shadow root.** Chrome
  ignores font faces declared inside a shadow root; the rule parses, the file
  never loads, and it reads as a broken upload rather than a scoping rule.
- **Navigation is component state, not the URL.** The page's history belongs to
  the host theme.

---

### The two hosts

A host adapter is a page that mounts `<ds-lms>` and answers one question: _what
is the current bearer token?_ That is very nearly the whole contract; the other
half-question is _who owns the URL?_ — see the row on routing below.

|                   | `wordpress/ds-lms`                                                      | `apps/portal`                                                                                |
| ----------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Token comes from  | `/wp-json/ds-lms/v1/token`, nonce-protected, minted from the WP session | Keycloak directly, Authorization Code + PKCE (`@ds/oidc`)                                    |
| On a 401          | Re-fetch with `refresh=1`                                               | Back through Keycloak — the portal holds no refresh token, deliberately                      |
| Around the widget | The customer's theme                                                    | A sign-in header and a back link, nothing else                                               |
| Routing           | The widget navigates itself; the page's URL belongs to the theme        | Listens for `ds-lms:course-open` and cancels it, so each course has its own bookmarkable URL |
| Widget bundle     | Copied into `assets/` by `scripts/bundle-widget.mjs`                    | Copied into `public/` by the same script                                                     |

Both load the **artifact** the widget build produced, never its source. The
widget's Tailwind is scoped under `.ds-lms-root` and inlined as a string for the
shadow root; a host that re-compiled it with its own config would style it
differently in each host, which is precisely what the shadow root exists to
prevent.

The portal renders **no learner screen of its own** — not even the catalogue,
which it used to. That was a second React implementation of approved layout
§4.1, and it had already drifted from the widget's. `ds-lms:course-open`
(ADR-0007 Contract 3) is what let it go: the widget shows the catalogue when
given no `course` attribute, and a host that routes cancels the event to say so.
The portal's job is now exactly authentication, routing and mounting, and it
makes no API call of its own.

The portal is not privileged for being ours. It appears in
`CORS_ALLOWED_ORIGINS` like any other origin, its Keycloak client is a separate
public client from the console's, and the API validates its tokens the same way.
Building it is what turns "the core is headless" from an intention into
something that fails visibly if it stops being true.

## 7. Compliance paths worth reading before changing

### Watched percentage

Reported as intervals, merged into a stored union, recomputed server-side. Never
taken from the request, never a maximum position. The client sends what it
played; the server decides what that is worth. `validateSegments` additionally
rejects more playback than wall-clock time since the last report, which is what
a scripted client produces.

### The EIV submission

Completion queues a submission; a worker sweeps. Every attempt — including every
failure — is written to an append-only audit log. Retries are bounded, and a
submission approaching its deadline raises an alert rather than failing
silently, because the Bescheid's fallback (a paper Original-Anwesenheitsliste)
is only open while the 8-day window has not passed.

`EIV_ALLOW_LIVE` must be set explicitly for a non-local endpoint. Otherwise
submissions are held. Pointing a test environment at the real Punktemeldung
interface should take a deliberate act.

**The deadline alarm is separate from all of that.** A submission that cannot be
sent stays queued and looks healthy in every graph while the 8-day window runs
down; the console shows `needs_attention`, but that is a _pull_ signal and over
eight days across a holiday nobody pulls. So the worker raises an alarm at 48 h
and again at 12 h, once each, escalating rather than repeating — the escalation
history lives in the append-only audit log, so an alert that was raised cannot
be un-raised by an UPDATE. It runs **before** the submission sweep and in its
own try/catch: the one thing that must not depend on the EIV interface being
reachable is the alarm about the EIV interface not being reachable.

### The certificate

Refused unless every field the Bescheid requires is present — the check is a
pure function, and the admin console reports "ready" from the same function, so
the console cannot promise what the endpoint would refuse. Issuing is recorded
once; a second download does not mint a new token.

### Erasure

Pseudonymisation, not deletion, because the participation record is retained
under a legal obligation. Refused while a Punktemeldung is open. A database
trigger keeps an erased profile erased when the subject signs in again — without
it, `provisionOrUpdate` would write the name straight back as a side effect of a
normal request. See [ADR-0008](adr/0008-erasure-is-pseudonymisation.md) and
[`gdpr.md`](gdpr.md).

---

## 8. White-labelling

Logo, colours, corner radius and typeface are data on the project row, not
constants in a stylesheet, because the platform is sold to more than one
customer.

The typeface is **uploaded and self-hosted**, never linked
([ADR-0009](adr/0009-no-third-party-frontend-assets.md)). A field asking for a
font URL would be filled in with a Google Fonts link within the week, and a
German healthcare site that loads a webfont from Google transmits every
visitor's IP address to a US service.

Every branding value is validated against a strict grammar in `packages/domain`
before storage **and** again on read, because each one ends up inside a CSS
declaration on a page holding a bearer token. Invalid values are dropped, never
repaired: a repaired value is a value somebody has to reason about, and nobody
will.

---

## 9. Deployment

One Hetzner host in Germany, everything containerised, Caddy terminating TLS
with automatic Let's Encrypt. Postgres, Redis and the API publish no ports and
sit on an `internal: true` Docker network.

`infra/deploy/deploy.sh` is the whole deployment and is runnable by CI or by a
human — a deployment path only CI can execute is one nobody can debug at 22:00.
It backs up before migrating, migrates as `ds_migrator`, and verifies over
public TLS afterwards, because an internal health check passing while the
certificate is broken is a deploy that looks green and serves nothing.

Migrations are additive by convention and are **never** rolled back. That is
what makes rolling an image back safe.

---

## 10. What is deliberately not here

Naming these matters as much as the rest: a reader should be able to tell an
omission from a decision.

- **No analytics, no charts, no dashboards.** Out of scope by `CLAUDE.md` §3.
  Reporting is a list and a CSV.
- **No self-service export endpoint.** Its successful response is a complete
  personal dossier — the highest-value target in the API, for a right the
  documented Auskunft path already satisfies at these volumes.
- **No automatic retention expiry.** The Ärztekammer has not said how long a
  participation record must be kept. A scheduled job deleting CME records on a
  guessed schedule is the worst available outcome.
- **No E2E suite.** Not in this budget. Integration tests run against a real
  Postgres, which is where the properties that matter actually live.
- **No tab deep-linking in the widget**, because the URL belongs to the host.
- **No certificate email yet.** The customer's own SMTP is designed for, the
  credentials are encrypted at rest, and the console edits them — but the
  delivery path is not built (P8-03). The `deliveryChannel` capability is
  declared and deliberately unregistered, so `find()` returns `undefined` and
  nothing is sent; that is the documented behaviour, not a crash. PDF download
  is the launch behaviour.
- **No runtime plugin loading.** There are extension points (ADR-0010) and they
  are compile-time: a workspace package implementing a contract from
  `@ds/plugin-api`, registered in `apps/api/src/plugins.ts`. There is no plugin
  directory and no dynamic import of a configured path, because the process
  being extended holds a non-BYPASSRLS database connection, the KMS key, and the
  audit log that is the evidence behind reported CME points.
