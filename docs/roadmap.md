# DS – Education Platform: Delivery Roadmap 140 h (WordPress-first, AI-first)

**Project:** DS – Education Platform (Jira: DEP) · **Parent:** MEDICE-292 ·
**First client:** MEDICE ADHS (WordPress) · **Owner:** Masoud Tahmasebi ·
**Plan start:** 27.07.2026 · **Target launch:** 06.09.2026 · **Budget:** 140 h

This is the committed copy of the Confluence delivery plan, versioned alongside
the code so that a given commit can always be read against the plan that was in
force when it was written. Architecture decisions live in `docs/adr/`; the work
orders derived from this plan live in `docs/backlog/`.

> **Open discrepancies against the Confluence source** are recorded in
> §14 at the end of this file. They are not silently corrected here — the
> Confluence page remains the contractual document until it is amended.

---

## 1. The constraint, stated honestly

140 hours between 27.07.2026 and 06.09.2026 is six working weeks at roughly
23 h/week. The full multi-tenant product was estimated at ~337 h. Fitting it into
140 h is possible only because of three deliberate choices:

1. **Claude Code does the volume work.** Contract-first specs and a tested
   pure-logic core mean the agent writes most of the implementation. Human hours
   go into specification, review and the compliance modules.
2. **Depth over breadth.** Every entity, screen and rule listed here is built.
   Nothing beyond this list is built — the deferred list in §4 is contractual,
   not aspirational.
3. **The riskiest integration is de-risked in week 1**, not week 5, so it cannot
   blow up the fixed date.

**What 140 h means for quality:** the security baseline, tenant isolation,
server-side compliance logic and responsive/a11y floor are not negotiable and are
costed in. What is reduced is polish surface: the admin console is functional
rather than beautiful, reporting is a list rather than a dashboard, and the second
CMS remains structural readiness rather than working code. If the date slips or
scope grows, the honest lever is the admin console (18 h) — DigitalSpital seeds
content manually instead.

## 2. Confirmed decisions

| Topic | Decision |
|---|---|
| **Video completion rule** | Configurable percentage per course (`required_watch_percent`, 0–100). MEDICE ships at 100 %. The layout currently says 80 % on the Zertifizierung tab — the copy must be aligned to whatever MEDICE sets before launch. |
| **EFN storage** | We store it. `efn_profiles` in our PostgreSQL is the system of record. No dependency on a MEDICE Keycloak attribute. Salesforce `vDMC_EFN__c` sync stays possible later. |
| **Certificate assets** | Kept as-is for now; signature/stamp asset supplied by MEDICE before P8. |
| **Hosting** | Hetzner Cloud (EU/Germany — good for GDPR posture), containerised and portable. |
| **Email delivery** | SMTP settings come from the existing ADHS platform PHP configuration. We bind SMTP credentials per project in the Education Platform, seeded from that file. |
| **Hierarchy** | Department added between Customer and Project (see §3). |
| **Auth** | The WordPress Keycloak plugin session is bridged — a user logged into the ADHS WordPress site is automatically logged into the Education Platform (see §5). |
| **Documentation model** | Jira tickets are the documentation source of truth. Commits, PRs and generated docs all reference the ticket key (see §6). |

## 3. Domain hierarchy

```
Super Admin              (DigitalSpital — Masoud)
 └─ Customer             MEDICE
     └─ Department       ADHS
         └─ Project      "ADHS Plattform"   ← SMTP, branding, Keycloak realm bind here
             └─ Course   "ADHS bei Erwachsenen"  ← VNR, CME points, thresholds
                 └─ Module    "Modul 3 – Pharmakotherapie"
                     └─ Chapter   "Kapitel 3 – Nebenwirkungen"
                         └─ Content: Video + Text + Quiz + Details
                                     (status: not started | in progress | completed,
                                      score, watched %)
```

**Why Department earns its place:** MEDICE is one customer with several
therapeutic areas. Without Department, either every area becomes a separate
customer (breaking billing and admin access) or everything lands in one flat
project list. Department gives per-area admin scoping and per-area reporting at
almost no schema cost.

**Where configuration lives:** Project holds SMTP, branding and the Keycloak
binding. Course holds compliance settings — VNR, encrypted VNR password, CME
points and category, accreditation body, validity window, Fortbildungsnummer,
`pass_threshold_percent` (70 for MEDICE), `required_watch_percent` (100 for
MEDICE), retry policy.

**Progress** is tracked at every level and rolled up: chapter content status →
chapter → module → course. Both the learner view and the customer admin view read
the same rollup, so the numbers can never disagree.

## 4. Scope

| In scope (140 h) | Deferred |
|---|---|
| Full hierarchy incl. Department, multi-tenant with row-level isolation | Storyblok integration layer |
| Learner frontend: course list with filters, detail with 4 tabs, Mediathek with lock states, player with module/chapter nav | Vue wrapper |
| Per-level status visible to the learner (course → module → chapter → content, with score and watched %) | Analytics dashboards, charts, exports beyond CSV |
| Configurable video % gate, sequential gating, quiz, Evaluationsbogen | SCORM/xAPI, gamification |
| EFN capture + EIV-FOBI Punktemeldung with deadline handling | Self-service customer signup and billing |
| Certificate PDF + email via project-bound SMTP | Salesforce sync |
| Admin console (React + Tailwind): own auth, customer creation, content authoring, participant status list | Rich WYSIWYG authoring, media transcoding pipeline |
| WordPress plugin with automatic Keycloak session bridge | Second customer onboarding (Trommsdorf) |

## 5. WordPress ↔ Keycloak session bridge

The ADHS site already runs `keycloakWordPressPlugin` (`class-keycloak.php`),
which obtains an access token from the Keycloak token endpoint and reads the
profile from `/protocol/openid-connect/userinfo`. We reuse that session rather
than introducing a second login.

**Flow:**

1. User logs into the ADHS WordPress site as today. The plugin holds a valid
   Keycloak access token in the WP session.
2. Our thin WP plugin renders `<ds-lms>` and hands it a short-lived token
   retrieved from a WordPress AJAX/REST endpoint — never printed into the page
   HTML.
3. The widget sends the token as a bearer to the DS API. The API validates it
   independently against Keycloak JWKS: signature, issuer, audience, expiry. We
   never trust WordPress's word that the user is authenticated.

**Identity resolution:** Keycloak `sub` is the primary user key, `email` is the
documented fallback. Profile data (name, email) is taken from the validated
token/userinfo, so no separate profile maintenance is needed.

**Token refresh** is handled by the widget calling the same WP endpoint before
expiry; the learner never sees an interruption mid-video.

**Extension needed in the WP plugin:** one small endpoint that returns the current
user's access token to a logged-in session only, with a nonce check. That is the
entire integration surface — everything else stays in the plugin as it is today.

## 6. AI-first working model & Jira-driven documentation

See `CLAUDE.md`, which is the enforced version of this section.

| Rule | Detail |
|---|---|
| Ticket = work order | Every DEP ticket carries context, scope, acceptance criteria and definition of done, written so it can be handed to Claude Code verbatim. No ticket, no code. |
| Branch naming | `DEP-123-short-slug` |
| Commit format | `DEP-123: imperative summary` |
| PR description | References the ticket, lists acceptance criteria with checkmarks, notes any deviation from the spec. |
| Docs | `docs/` entries reference the ticket key that introduced them. `CLAUDE.md` holds the standing rules; ADRs record irreversible decisions. |
| Contract-first | `openapi.yaml` is written before the implementation; SDK, widget types and contract tests derive from it. |
| Human review gate | Anything touching auth, assessment, eiv or certificates requires human review. |

## 7. EIV-FOBI: de-risked in week 1

This is the only part of the system where we depend on an external, legally
binding interface whose behaviour we have not yet observed, and where credentials
may arrive late. Treating it as a week-5 task would put the launch date at the
mercy of a third party.

**Approach — build the test before the integration:**

- **Week 1:** write a standalone, runnable EIV contract test harness — a small CLI
  that performs authenticate (VNR + password) → JWT →
  `POST /fobi/veranstalter/push_teilnahme` with a test EFN and
  `rolle: TEILNEHMER`, and reports exactly what came back.
- Until credentials arrive it runs against a local mock server built to the
  documented contract, so all our code paths, retries and deadline logic are
  already exercised.
- The moment credentials arrive (any week), the same harness is pointed at the
  EIV sandbox. If reality differs from the documentation, we find out in minutes
  and have weeks, not days, to react.
- Deadline invariants (report within 8 days of event end, 7-day correction
  window) are implemented as pure, unit-tested functions in `packages/domain` —
  testable with zero external dependency.
- Every attempt is written to an immutable audit log, and a submission
  approaching its deadline raises an alert rather than failing silently.

**Escalation:** request the EIV sandbox credentials now. If they have not arrived
by the end of week 4 (23.08), we launch with submissions queued and held, and flip
to live submission as a small follow-up — the learner experience and certificate
are unaffected.

## 8. Phase budget — 140 h

| # | Phase | h | Core content |
|---|---|---|---|
| P0 | Foundations & AI-first setup | 10 | Monorepo, CI, CLAUDE.md, ADRs, Docker Compose, schema v1 + migrations, seed course, packages/domain skeleton |
| P1 | Auth & user profile | 10 | Keycloak JWKS validation, WP session bridge, user-key resolution, roles, EFN profile field |
| P2 | Backend core: hierarchy & catalog | 16 | Customer → Department → Project → Course → Module → Chapter → Content CRUD, compliance fields, tenant isolation + RLS, public read API |
| P3 | Learning engine | 14 | Enrolment, sequential gating, progress + rollup, resume, configurable video % with anti-skip |
| P4 | Assessment & evaluation | 10 | Quiz engine (single/multi, exact-set), server-side scoring, threshold, attempts audit, Evaluationsbogen |
| P5 | Learner frontend widget | 28 | React + Tailwind web component: list, detail (4 tabs), Mediathek, player, status views, completion flow; responsive + a11y |
| P6 | WordPress integration | 5 | Block/shortcode, token endpoint in the Keycloak plugin, asset loading, logged-out state |
| P7 | EIV-FOBI & EFN | 12 | Test harness + mock (week 1), VNR credential vault, submission, deadline logic, retry queue, alerting |
| P8 | Certificates & email | 7 | PDF from template with signature, project-bound SMTP from the ADHS config, delivery + retry, download |
| P9 | Admin console | 18 | React + Tailwind, own auth, customer/department/project creation, content authoring, participant status list |
| P10 | Hardening, Hetzner deploy & launch | 10 | Security review, tenant isolation tests, rate limiting, Hetzner provisioning + CI deploy, backups, observability, go-live |
| | **Total** | **140** | |

## 9. Weekly plan — 27.07.2026 → 06.09.2026

Six weeks, ~23 h/week. Each week ends with something demonstrable.

### Week 1 · 27.07 – 02.08 — Foundations + EIV de-risk (23 h)

- **P0 (10 h):** monorepo, CI, CLAUDE.md, ADRs, Docker Compose (Postgres, Redis,
  Keycloak dev, API), schema v1 for the full hierarchy, seed with the real ADHS
  course.
- **P7 start (5 h):** EIV test harness + mock server; deadline logic as tested
  pure functions.
- **P1 start (6 h):** Keycloak JWKS validation, user-key resolution.
- **P5 start (2 h):** widget build pipeline producing a Shadow-DOM web component.

**Demo:** stack runs locally; a valid Keycloak token is accepted; the EIV harness
executes end-to-end against the mock.

### Week 2 · 03.08 – 09.08 — Backend core + WordPress bridge (24 h)

- **P1 finish (4 h):** WP session bridge endpoint, roles, EFN profile field.
- **P2 (14 h):** full hierarchy CRUD, compliance fields, tenant isolation + RLS,
  public read API, OpenAPI contract frozen.
- **P6 (5 h):** WordPress plugin — block/shortcode, token endpoint, asset loading.
- **P5 (1 h):** widget consumes the real API through the generated SDK.

**Demo (M1 · walking skeleton):** a seeded course renders inside the real MEDICE
WordPress site with a real logged-in user, no second login.

### Week 3 · 10.08 – 16.08 — Learning engine + player (24 h)

- **P3 (14 h):** enrolment, sequential gating, progress rollup across all levels,
  resume, configurable video % with forward-seek prevention.
- **P5 (10 h):** player screen — video, module/chapter sidebar, chapter text,
  autosave indicator, "Ihr Fortschritt X von Y" ring.

**Demo:** gated playback works; leaving and returning lands on the exact chapter
and second; the video gate refuses to complete below the configured percentage.

### Week 4 · 17.08 – 23.08 — Assessment + course detail screens (23 h)

- **P4 (10 h):** quiz engine, server-side scoring, threshold, attempts,
  Evaluationsbogen.
- **P5 (13 h):** course list with Thema/Altersgruppe filters; course detail with
  Übersicht, Experten/Referenten, Zertifizierung and Mediathek tabs incl. lock
  states; learner status views per module and chapter.

**Checkpoint:** EIV sandbox credentials must be available by the end of this week,
or the fallback in §7 applies.

**Demo (M2 · learner MVP):** the complete approved layout is implemented and
navigable; quiz and evaluation work.

### Week 5 · 24.08 – 30.08 — CME compliance path (23 h)

- **P7 finish (7 h):** VNR credential vault, live/sandbox submission, retry queue,
  deadline alerting.
- **P8 (7 h):** certificate PDF with signature, project-bound SMTP from the ADHS
  config, delivery + retry, download.
- **P5 (5 h):** EFN capture screen, completion flow, certificate download,
  responsive pass.
- **P9 start (4 h):** admin console shell, auth, customer/department/project
  creation.

**Demo (M3 · CME compliant):** full journey — enrol → watch → quiz → evaluation →
EFN → EIV submission → certificate in the inbox.

### Week 6 · 31.08 – 06.09 — Admin console, hardening, launch (24 h)

- **P9 finish (14 h):** content authoring across the hierarchy, participant status
  list with completion, score and EIV/certificate state, CSV export.
- **P10 (10 h):** security review and tenant-isolation tests, rate limiting,
  Hetzner provisioning and CI deploy, backups, observability and alerts,
  a11y/cross-browser pass, EIV sandbox → live cutover, runbook, go-live.

**Demo (M4 · launch):** live on Hetzner, MEDICE admins managing their own content,
learners earning CME points.

## 10. Milestones

| Milestone | Date | Definition of done |
|---|---|---|
| **M1 · Walking skeleton** | 09.08.2026 | Course renders in the real WordPress site with automatic Keycloak login |
| **M2 · Learner MVP** | 23.08.2026 | Full layout, gating, video rule, quiz and evaluation working |
| **M3 · CME compliant** | 30.08.2026 | EFN, EIV submission and certificate delivery verified |
| **M4 · Launch** | 06.09.2026 | Live on Hetzner, admin console handed over, security review signed off |

## 11. Risks against the fixed date

| Risk | Mitigation |
|---|---|
| EIV credentials arrive late or the API differs from its documentation | Harness + mock in week 1; hard checkpoint in week 4; launch-with-queued-submissions fallback |
| 140 h is tight against 337 h of ideal scope | Contractual deferred list; admin console (18 h) is the declared trade lever; weekly demos surface drift immediately |
| Widget styling clashes with the MEDICE theme | Shadow DOM isolation proven on the real site in week 2, not on a clone |
| 80 % vs 100 % video rule contradiction between layout and MEDICE-292 | Rule is configurable; written confirmation needed before week 5; layout copy corrected to match |
| WordPress token endpoint changes touch a production plugin | Additive change only, nonce-protected, behind a feature flag, reviewed with the MEDICE team |
| Content not ready for launch | Seed course from week 1; MEDICE content deadline set for week 5 |

## 12. Open items

1. **EIV sandbox credentials** — request now; hard checkpoint 23.08.2026.
2. **Video percentage for MEDICE courses** — confirm 100 % in writing, then
   correct the layout copy.
3. **Signature/stamp asset for the certificate** — needed by week 5.
4. **ADHS SMTP configuration file** — to be handed over so the project-level
   binding can be seeded.
5. **Access to the WordPress repository** for the additive token endpoint in
   `keycloakWordPressPlugin`. **Blocking for M1** — see §14.
6. **Hetzner account and DNS** — who owns the subscription and the domain entry.

## 13. Next step

DEP is populated with one Epic per phase (P0–P10) and detailed Tasks carrying
description, acceptance criteria, definition of done and hour estimates — each
written to be handed to Claude Code as a work order, with the commit and
documentation conventions from §6. Those work orders are in `docs/backlog/`.

DEP-1 folds into the P2 Epic; DEP-2 and DEP-3 become foundation tasks under P0.

## 14. Open discrepancies against the Confluence source

Recorded here rather than silently corrected. Each needs a decision from the
plan owner.

1. **The weekly plan totals 141 h, not 140.** §8 budgets P2 at 16 h and P5 at
   28 h. §9 schedules P2 for 14 h (week 2 only) and P5 for 31 h
   (2 + 1 + 10 + 13 + 5). Net +1 h over budget, with P2 — the phase carrying
   tenant isolation and RLS — 2 h short of its own budget.
   *Recommendation:* restore P2 to 16 h and take 3 h out of P5 polish surface.

2. **The EIV escalation date contradicts itself.** §7 of the Confluence page says
   "if they have not arrived by week 4 (17.08)"; §9 and §12 put the hard
   checkpoint at the *end* of week 4, 23.08. A week of difference on the only
   externally-dependent risk. *This file uses 23.08* per §9/§12.

3. **The WordPress plugin repository is not yet accessible.** P6 depends on an
   additive token endpoint in `keycloakWordPressPlugin` / `class-keycloak.php`.
   Open item 5 tracks it; it must be resolved before week 2 or **M1 (09.08)
   slips**. The week-1 WordPress plugin stub is written against the documented
   flow only and is unverified against the real plugin.

4. **80 % vs 100 % video rule.** Built configurable per course as decided. Still
   needs the written confirmation and the layout copy correction before week 5.
