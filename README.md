# DS Education Platform

A multi-tenant CME platform for German medical education. A physician watches
accredited course material, passes a Lernerfolgskontrolle, completes an
Evaluationsbogen, supplies their EFN, and receives CME points reported to the
Ärztekammer through the EIV-FOBI interface plus a Teilnahmebescheinigung.

First customer: **MEDICE**, therapeutic area **ADHS**, delivered inside their
existing WordPress site.

---

## The one thing to understand first

**Every decision that affects a CME point is made by the API, in PostgreSQL, and
nowhere else.** How much of a video was watched, whether a quiz was passed,
whether a course is complete, whether a Punktemeldung is due — all server-side.
The learner widget renders those verdicts; it never reaches one.

That is not defensive coding. A CME point is a legal artefact: it is reported to
a Kammer under a Veranstaltungsnummer, credited against a named physician's
Fortbildungskonto, and evidenced by a certificate that may be inspected. A
client-side gate is not a bug in this system, it is a false attestation.

Four consequences you will meet within an hour of reading the code:

|                                                                          |                                                                                     |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| **Watched percentage is a union of intervals**, never a maximum position | A max-position gate is defeated by dragging the scrub bar                           |
| **Tenant isolation is PostgreSQL RLS**, not a `WHERE customer_id`        | Application code that filters is defence in depth. The database is the defence      |
| **One rollup path** feeds the learner's screen and the admin's report    | Two implementations would eventually disagree, on a record already sent to a Kammer |
| **WordPress is never believed** about who is signed in                   | The API validates every token against Keycloak's JWKS itself                        |

The rules are in [`CLAUDE.md`](CLAUDE.md) §4, and they are enforced — by lint
boundaries, by database constraints, and by tests that fail when a guard is
removed.

---

## Layout

```
contracts/openapi.yaml   the API contract — written before the implementation
db/                      ordered SQL migrations, and the ADHS seed
docs/                    roadmap, ADRs, GDPR record, open questions, backlog
infra/                   local docker-compose, Keycloak dev realm, nginx, deploy
apps/api                 NestJS API — the only thing that decides anything
apps/widget              the learner's <ds-lms> custom element
apps/admin               the admin console (Vite SPA)
apps/portal              our own learner frontend — a host adapter, like the plugin
apps/eiv-harness         EIV-FOBI contract test CLI and mock server
packages/domain          pure compliance logic — no I/O, no clock, no framework
packages/sdk             API client, generated from the contract
packages/oidc            Keycloak login (PKCE), shared by the console and the portal
packages/plugin-api      the extension contracts — and what may not be extended
packages/eiv-client      the EIV-FOBI protocol client, and its reporter plugin
packages/config          shared eslint / tsconfig / tailwind presets
scripts/                 repository tooling (the widget bundler)
wordpress/ds-lms         the WordPress plugin that mounts the widget
```

`packages/domain` is where to look first. It is pure, exhaustively tested, and
every rule that decides a compliance outcome lives there — watch coverage,
gating, scoring, EIV deadlines, certificate completeness. Everything else is
plumbing around it.

---

## Running it

Node 22 (`.nvmrc`), pnpm 10, Docker, and PHP only if you want to run the
WordPress plugin's tests.

```bash
pnpm install
pnpm infra:up          # Postgres, Redis, Keycloak, Mailpit
pnpm db:migrate        # as ds_migrator — never as the superuser, see below
pnpm db:seed           # the ADHS course, its quiz and its evaluation
pnpm dev               # API on :3000, widget on :5173, admin on :5174
```

`pnpm infra:reset` throws the database away and starts again, which is usually
faster than reasoning about a half-migrated schema.

### Checks

```bash
pnpm verify            # lint, format, typecheck, unit tests, prod audit
pnpm test:integration  # against a real Postgres — needs infra:up
pnpm test:wp           # the WordPress plugin's security checks (needs php)
```

`pnpm verify` is what CI runs first. Run it before pushing; it is faster than a
round trip through Actions and it fails in the same order.

### Why `db:migrate` connects as `ds_migrator`

`ALTER DEFAULT PRIVILEGES FOR ROLE ds_migrator` only grants `ds_app` on objects
**ds_migrator** creates. Migrating as the superuser leaves `ds_app` with no
grants at all — which presents as "permission denied" rather than as RLS
filtering rows, and looks like isolation working until you read the error.

---

## The database roles, and why there are four

| Role                  | Can log in | BYPASSRLS | Owns                           |
| --------------------- | ---------- | --------- | ------------------------------ |
| `ds_migrator`         | yes        | no        | the schema                     |
| `ds_app`              | yes        | **no**    | nothing                        |
| `ds_binding_resolver` | no         | yes       | the pre-authentication lookups |
| `ds_erasure`          | no         | yes       | `erase_subject`                |

`ds_app` runs every HTTP request and owns nothing, so `FORCE ROW LEVEL SECURITY`
applies to it without exception. The two BYPASSRLS roles cannot be connected as
and each owns a fixed, reviewed function: one resolves which tenant a request
belongs to _before_ a tenant context can exist, the other performs a GDPR
erasure, which is cross-tenant by nature. See
[ADR-0002](docs/adr/0002-tenant-isolation-rls.md) and migrations `0002` / `0009`.

---

## Where the answers are

| Question                                                          | File                                                                            |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| What are the standing rules for changing this code?               | [`CLAUDE.md`](CLAUDE.md)                                                        |
| How is the system put together, and why that way?                 | [`docs/architecture.md`](docs/architecture.md)                                  |
| Why was _this_ decided?                                           | [`docs/adr/`](docs/adr/README.md)                                               |
| What is being built, in what order, for how many hours?           | [`docs/roadmap.md`](docs/roadmap.md), [`docs/backlog/`](docs/backlog/README.md) |
| What personal data exists and what happens on an erasure request? | [`docs/gdpr.md`](docs/gdpr.md)                                                  |
| What is still unanswered and blocking?                            | [`docs/show-stoppers.md`](docs/show-stoppers.md)                                |
| How do I add a module without breaking the layering?              | [`CONTRIBUTING.md`](CONTRIBUTING.md)                                            |
| How is this deployed, and how do I roll it back?                  | [`infra/deploy/README.md`](infra/deploy/README.md)                              |
| How does the WordPress side work?                                 | [`wordpress/ds-lms/README.md`](wordpress/ds-lms/README.md)                      |
| How do I extend it — and what may I not extend?                   | [`docs/adr/0010-extension-points.md`](docs/adr/0010-extension-points.md)        |
| What did the security review find, and what is accepted risk?     | [`docs/security-audit.md`](docs/security-audit.md)                              |
| What did the code-quality review find?                            | [`docs/best-practices-audit.md`](docs/best-practices-audit.md)                  |

---

## Embedding the widget

The learner frontend is one custom element. It carries its own styles in a
closed shadow root, so a host theme cannot reach into it and its Tailwind cannot
leak out onto the host page.

```html
<script type="module" src="https://widget.example.de/ds-lms.js"></script>

<!-- One course -->
<ds-lms
  api-base="https://api.example.de"
  project="medice-adhs"
  course="adhs-akademie-adult"
  token-endpoint="/wp-json/ds-lms/v1/token"
></ds-lms>

<!-- Or the catalogue: omit `course` -->
<ds-lms api-base="https://api.example.de" project="medice-adhs"></ds-lms>
```

`project` is the `X-DS-Project` header. It tells the API which host surface is
calling, which resolves the Keycloak realm the token is validated against and
pins the tenant. It is not a secret and grants nothing on its own.

In WordPress none of this is written by hand — the plugin renders the element,
supplies the token provider, and keeps the token out of the page HTML. Our own
portal (`apps/portal`) does the same thing in React, with a token it obtained
from Keycloak itself. Those two are the whole of what a **host adapter** is
(ADR-0007): mount the element, hand it a way to get a token.

---

## Status

Pre-launch. Target **06.09.2026**, budget fixed at 140 h.

The admin console is complete: compliance settings, certificate assets,
branding, participant reporting, **and** authoring — departments and projects,
course creation, the module/chapter/content tree with reordering, the
Lernerfolgskontrolle and the Evaluationsbogen. It was the plan's declared trade
lever and was for a while partly unbuilt; [`docs/backlog/P9.md`](docs/backlog/P9.md)
records what changed and what the hours cost.

`db/seed/adhs.ts` still creates the ADHS course. The console is how it is
_changed_ after launch — and the rules that matter still refuse from the server:
a pass threshold below the accredited minimum, a video with no duration, a quiz
question nobody could answer correctly, and the deletion of anything a learner
has already touched.

There are two learner frontends and they are equals. `wordpress/ds-lms` embeds
the widget in a customer's site; `apps/portal` is our own. Neither is
privileged — the API validates every token against Keycloak JWKS and cannot tell
them apart, which is the point of ADR-0007.

Open questions that need an answer from outside the team — including what
`Veranstaltungsende` means for an on-demand course, which decides when a
statutory reporting clock starts — are in
[`docs/show-stoppers.md`](docs/show-stoppers.md). They are tracked there rather
than guessed at in code: `CLAUDE.md` §7 is explicit that an invented compliance
rule that ships is worse than a delay.
