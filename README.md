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
packages/seed            the seeded tenants, runnable from a checkout or the image
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

There are two ways to run it, and the difference matters.

```bash
./run-on-local.sh      # the production containers, on this machine
```

builds and runs the **same images the server runs**, with the same entrypoints
and the same runtime configuration — then migrates, seeds all three tenants,
creates a console account and prints what to open. It needs nothing but Docker.

```bash
pnpm install
pnpm start             # .env, dependencies, schema, tenants, a console account
pnpm dev               # the apps from source, with watchers
```

runs the applications from source with hot reload. Faster to iterate in, and it
never exercises the containers.

| Want                                          | Use                      |
| --------------------------------------------- | ------------------------ |
| Write code, see it reload                     | `pnpm start && pnpm dev` |
| Check it will start the way the server starts | `./run-on-local.sh`      |
| No Node or pnpm installed                     | `./run-on-local.sh`      |

Use both. Every deployment failure this project has had lived in the gap between
"the code works" and "the image starts" — a variable the nginx entrypoint
required and compose never set, a config value the API rejects at boot, a path
resolved against the wrong directory. A Vite dev server cannot see any of them;
`./run-on-local.sh` fails on all three in under a minute.

```bash
./run-on-local.sh --logs     follow the containers
./run-on-local.sh --down     stop, keeping the data
./run-on-local.sh --fresh    start again from an empty database
```

Both write `.env` from `.env.example` if you have none, generate a local
`SECRETS_KMS_KEY` so the encrypted-at-rest path behaves the way it does in
production, and name the one prerequisite that is missing rather than a generic
"check your setup". `pnpm start --keep` skips dropping the database.

### The containerised stack: one port block, 5539x

`./run-on-local.sh` publishes everything on `localhost:5539x` — one range to
remember, and nothing standard on a laptop is sitting there.

| URL                                | What                                     |
| ---------------------------------- | ---------------------------------------- |
| `http://localhost:55390/health`    | the API — its version and commit         |
| `http://localhost:55391`           | the admin console                        |
| `http://localhost:55392/medice`    | the learner portal, MEDICE's tenant      |
| `http://localhost:55392/ds`        | the learner portal, the DS test tenant   |
| `http://localhost:55392/dsproject` | the neutral default tenant               |
| `http://localhost:55393`           | the widget on its own                    |
| `http://localhost:55394`           | Mailpit — every email the platform sends |
| `localhost:55395`                  | PostgreSQL                               |
| `localhost:55396`                  | Redis                                    |
| `localhost:55397`                  | Keycloak                                 |
| `localhost:55398`                  | Mailpit's SMTP port                      |

**Inside the stack they reach each other by service name** — `postgres:5432`,
`redis:6379`, `mailpit:1025` — on the compose network. The 5539x ports are for
your browser and your `psql`, and nothing in the stack uses them.

The one place that distinction bites is `DS_API_BASE`: it is written into
`/config.js` and fetched by the _browser_, so it has to be `localhost:55390`
rather than `api:3000`. `ALLOWED_ORIGINS` is the mirror image. Getting either
wrong fails every request with CORS and leaves nothing in the API log —
`pnpm check:local-ports` is what stops that reaching a commit.

Move the whole block with `DS_LOCAL_API_PORT`, `DS_LOCAL_ADMIN_PORT` and the
rest in `.env`.

### The source stack: the ports `pnpm dev` has always used

| URL                               | What                                     |
| --------------------------------- | ---------------------------------------- |
| `http://localhost:5174`           | the admin console                        |
| `http://localhost:5175/medice`    | the learner portal, MEDICE's tenant      |
| `http://localhost:5175/ds`        | the learner portal, the DS test tenant   |
| `http://localhost:5175/dsproject` | the neutral default tenant               |
| `http://localhost:5173`           | the widget on its own                    |
| `http://localhost:3000/health`    | the API                                  |
| `http://localhost:8025`           | Mailpit — every email the platform sends |

Both modes share one compose project, so switching re-creates the four
dependency containers with the other port mapping. That is a few seconds and no
data loss — `postgres-data` is a named volume.

Mailpit is where password-reset, invitation and certificate emails land. Nothing
in development reaches a real inbox.

The three tenants are seeded rather than one because the portal takes its tenant
from the URL path: `/medice`, `/ds` and `/dsproject` are only exercisable when
all three exist.

The individual steps are still there when you want one on its own —
`pnpm db:dev:reset` (drop, migrate, seed), `pnpm db:dev:seed` (the same without
dropping), `db:migrate`, `db:seed`, `db:seed:ds`, `db:seed:default`, and
`pnpm --filter @ds/api exec node dist/bootstrap-admin.js` for a staff account.
Migration runs as `ds_migrator`, never as the superuser — see below. A `psql` on
your machine is optional: without one, the database commands use the postgres
container's own client.

### Checks

```bash
pnpm verify            # lint, format, typecheck, unit tests, prod audit
pnpm test:integration  # against a real Postgres — needs infra:up
pnpm test:wp           # the WordPress plugin's security checks (needs php)
```

`test:integration` provisions its own database, `ds_education_test`, and never
touches the one `pnpm dev` runs against. It builds the workspace first and
truncates before every file, so a run means the same thing on the hundredth day
as the first — CONTRIBUTING.md §Tests says what each of those guards is for and
which failure bought it.

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
| How do I put this on a server the first time?                     | [`docs/deployment.md`](docs/deployment.md)                                      |
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

Omit `course` and the widget opens the catalogue instead. A host that wants each
course to have its own URL listens for `ds-lms:course-open` and calls
`preventDefault()` — that is the portal, and it is why the portal has no learner
screen of its own.

The event's detail carries `{ slug, intent }`. `intent` is `"resume"` when the
learner pressed **Fortbildung fortsetzen** rather than **Zur Fortbildung**; a
routing host honours it by mounting the element with `open-at="resume"`, which
opens the player at the point they left off instead of the course's start page.
Ignoring it is safe — both buttons then land on the start page, as before.

---

## Status

Pre-launch. Target **06.09.2026**, budget fixed at 140 h.

The admin console is complete: compliance settings, certificate assets,
branding, participant reporting, **and** authoring — departments and projects,
course creation, the module/chapter/content tree with reordering, the
Lernerfolgskontrolle and the Evaluationsbogen. It was the plan's declared trade
lever and was for a while partly unbuilt; [`docs/backlog/P9.md`](docs/backlog/P9.md)
records what changed and what the hours cost.

A fresh installation is not empty: the deploy creates **DSCustomer** with one
project and one complete Lorem-ipsum course, carrying no VNR, no accreditation
body and no CME points, so nothing it seeds can reach EIV. It exists so the
console's screens have a filled-in example to copy from rather than four things
to create in the right order. `db/seed/adhs.ts` still creates MEDICE's real ADHS
course. The console is how either is _changed_ after launch — and the rules that matter still refuse from the server:
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
