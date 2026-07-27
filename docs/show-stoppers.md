# Show stoppers — items that need a PM decision or an external answer

Status 27.07.2026, end of day 1. Everything here is **outside the engineering
team's control**: it needs a decision, an asset, or an answer from a third
party. Ordered by the date it stops being fixable.

Nothing in this list is a reason to pause development — the week-1 work is done
and week 2 can start. But items S1–S4 each have a date after which the launch
on **06.09.2026** is at risk.

| #   | Item                                                                           | Blocks       | Needed by | Owner              |
| --- | ------------------------------------------------------------------------------ | ------------ | --------- | ------------------ |
| S1  | Repository write access for this session                                       | All delivery | **now**   | DigitalSpital      |
| S2  | Where the WP Keycloak plugin stores the access token, and whether it refreshes | M1 · 09.08   | **31.07** | MEDICE dev         |
| S3  | WordPress repository access                                                    | M1 · 09.08   | **31.07** | MEDICE             |
| S4  | Scope decision on 4 layout features not in the 140 h                           | M2 · 23.08   | **06.08** | PM + DigitalSpital |
| S5  | Certificate-after-EIV vs the launch fallback                                   | M3 · 30.08   | 14.08     | PM + MEDICE        |
| S6  | Signature/stamp asset + Ärztekammer answer on digital certificates             | M3 · 30.08   | 21.08     | MEDICE             |
| S7  | `required_watch_percent`: 80 % or 100 %, in writing                            | M2 · 23.08   | 14.08     | MEDICE             |
| S8  | ADHS SMTP configuration, and which MEDICE account sends                        | M3 · 30.08   | 21.08     | MEDICE             |
| S9  | Hetzner account ownership and DNS                                              | M4 · 06.09   | 24.08     | DigitalSpital      |
| S10 | VNR password was shared over chat                                              | —            | now       | DigitalSpital      |

---

## S1 · This session cannot write to the repository — **blocking now**

Four commits exist locally and **none of them are on GitHub**. Both write paths
are denied:

- `git push` → `403` from the session's git proxy (reads work; writes do not).
- GitHub API `push_files` → `403 Resource not accessible by integration`.

The GitHub App backing this session has **read-only** access to
`masoudtahmasebi/DigitalSpitalCMEModule`. An admin needs to grant write
(contents: read **and write**) in the Claude GitHub settings —
<https://claude.ai/admin-settings/claude-in-slack>.

Until then the work exists only in this container, which is ephemeral. This is
the single most urgent item on the list.

**Commits waiting to be pushed**

| Commit  | Contents                                                                         |
| ------- | -------------------------------------------------------------------------------- |
| `P0-01` | CLAUDE.md, roadmap, 5 ADRs, 68 work orders across P0–P10 totalling exactly 140 h |
| `P0-02` | pnpm/turborepo monorepo, CI, and `packages/domain` with 102 passing tests        |
| `P7-01` | EIV harness, mock server, and the MEDICE requirements record                     |
| `P0-03` | docker-compose, Keycloak dev realm, schema v1 with RLS on 18 tables              |

---

## S2 · The WordPress Keycloak plugin may not hold a refreshable token — **new, and serious**

The supplied `Keycloak` class changes the risk picture for the whole session
bridge (ADR-0003). Three findings from the code itself:

**a) No token storage is visible.** `getAccessTokenByUnamePass()` returns the
full token response to its caller, and `getUserInfoByToken()` takes a token as
an argument. Nothing in the supplied class **persists** the access token. Our
token endpoint (P6-02) can only return a token that is actually stored
somewhere the request can reach.

> **Question for MEDICE dev:** where is `access_token` persisted after login —
> PHP session, cookie, user meta, transient? We need the exact storage location
> and its lifetime.

**b) No refresh handling is visible.** The plugin uses the **password grant**
(`grant_type=password`) and requests `offline_access` scope, so a refresh token
is very likely returned — but nothing in the supplied code stores or uses it.

This matters more than it looks. A Keycloak access token typically lives ~5
minutes. Our learner watches a 25-minute video. ADR-0003 and P5-02 both assume
the widget can refresh mid-video "so the learner never sees an interruption". If
the plugin holds only a short-lived access token and no refresh path, then
**either** the learner's session dies mid-video, **or** we build refresh into the
production plugin — which is a materially bigger change than the "one small
additive endpoint" the roadmap costs at 5 h.

> **Question:** is the refresh token stored? Is there existing refresh logic
> elsewhere in the plugin? What is the realm's access-token lifespan?

**c) The class shown is not the whole plugin.** `private static $session_init`
implies session handling in code we have not seen, and there is no `wp_login`
hook, no cookie-setting and no `class-keycloak.php` body here. We are reasoning
about roughly a third of the integration surface.

**Impact if unanswered:** P6 is estimated at 5 h on the assumption that the
integration is one nonce-protected endpoint returning an already-stored token.
If storage or refresh has to be built, that estimate is wrong, and M1 on
**09.08** is the milestone that slips.

---

## S3 · WordPress repository access

Already roadmap §12 item 5, still open. P6-02 modifies a plugin on MEDICE's
**production** site. Even a purely additive, nonce-protected, feature-flagged
endpoint needs the real code in hand and a review with the MEDICE team.

Combined with S2, this is the critical path to M1. Everything else in week 2 can
proceed without it; the walking skeleton cannot.

**Proposal — and this addresses the maintainability point directly:** put our
side in a **separate `ds-lms` WordPress plugin** that we own, rather than adding
to theirs. The only thing that then has to change in `keycloakWordPressPlugin`
is exposing the stored token to a logged-in session — ideally as a WordPress
filter or action they add once, which our plugin consumes. That reduces the
production diff to a handful of lines and lets us iterate on our side without
touching their release.

---

## S4 · Four layout features are not in the 140 h — decision needed by 06.08

The approved screens contain more than the plan was costed against. Detail in
`docs/requirements/medice-adhs.md` §6.

| Feature                                                                    | Evidence                                              | Estimate |
| -------------------------------------------------------------------------- | ----------------------------------------------------- | -------- |
| **Teilprüfung** — per-module assessment                                    | "Zur Teilprüfung", "Wird nach Modul 3 freigeschaltet" | +6–8 h   |
| **Mediathek downloads** — file assets grouped per module with lock states  | Mediathek tab                                         | +3 h     |
| **Experten/Referenten** — person entity with role, institution, photo, bio | Experten tab                                          | +2 h     |
| **Editable name before EIV submission**                                    | Stale Keycloak profile requirement                    | +2 h     |

**Total +13–15 h against a budget that is already fully allocated at 140 h.**

The declared trade lever is the admin console (P9, 18 h). Absorbing all four
consumes most of it, which means DigitalSpital seeds MEDICE's content by hand
rather than MEDICE managing it themselves. That is a real product decision, not
a scheduling detail.

Also unresolved: the list has **On Demand / Live / Präsenz** tabs. Live and
Präsenz imply scheduled events with dates, locations and capacity — none of
which is in the domain model. The plan assumes **only On Demand is populated for
launch**. This needs confirming, because it is a much larger feature than the
other four combined.

Minor, but it is a number learners will trust: the player shows **`63% absolviert`**
next to `14:35 / 25:45`, which is 56.6 %. The two do not agree, so what the
percentage measures needs stating.

---

## S5 · Certificate-after-EIV conflicts with the launch fallback

The requirement says the certificate is sent after passing **and** after
transmitting to EIV. ADR-0005 deliberately decoupled them, because that
decoupling is what makes the "launch with submissions queued and held" fallback
survivable — otherwise a learner who completes during the hold gets no
certificate at all.

**Recommendation:** issue on completion, send on successful submission, and add a
hard fallback — if a submission is still queued after a defined interval, send
the certificate anyway and flag the participation for manual reporting. Needs
written agreement.

Less likely to bite now that live VNR credentials exist, but the fallback should
still be coherent.

---

## S6 · Certificate assets and the Ärztekammer answer

- The **stamp and signature of the Scientific Director** must be supplied as a
  digital asset. Open question in the client's own ticket: how it is represented
  digitally.
- **Inquiry to the Ärztekammer is pending** on whether automatically generated,
  digitally delivered certificates have specific requirements. If the answer is
  that a qualified electronic signature is required, that is a different feature
  from embedding an image, and it is not in the 140 h.
- The Anerkennungsbescheid PDF was supplied but **could not be read in this
  environment** (no PDF rendering available), so the certificate field list in
  `docs/requirements/medice-adhs.md` §2 is built from the ticket text alone.
  It needs checking against the actual Bescheid — in particular the exact CME
  points, category, event title and location, since the mandatory sentence
  embeds the point count and category verbatim.

---

## S7 · The video rule, in writing

Layout says 80 % on the Zertifizierung tab; MEDICE-292 says 100 %. Built
configurable per course, so this does not block code — but the value ships in
seed data and the layout copy must be corrected to match. At 100 % there is no
tolerance: a learner must watch every second of every video.

---

## S8 · SMTP configuration

The ADHS platform's PHP SMTP configuration needs handing over so the
project-level binding can be seeded, and MEDICE needs to name which account
sends the certificates. Development sends to Mailpit and can never reach a real
recipient, so this only blocks at deployment.

---

## S9 · Hetzner and DNS

Roadmap §12 item 6. Who owns the subscription and the domain entry. Needed
before P10-04 in week 6; asking in week 6 is too late for DNS propagation and
account setup.

---

## S10 · The VNR password was shared over chat

`VNR 2760552025919300018` and its password were sent in the project chat. These
authenticate DigitalSpital to a legally binding accreditation interface.

They are **not** in the repository, and the harness refuses any non-local
endpoint without an explicit `EIV_ALLOW_LIVE=yes` — a stray run would create a
real Punktemeldung for a real physician, which cannot be withdrawn once the
7-day correction window closes.

**Action:** treat as exposed and ask the Ärztekammer whether a VNR password can
be rotated. Going forward, credentials belong in the environment or a secret
store, never in a ticket or chat thread.

---

## What is not blocked

Week 2 can start on schedule. P1 (auth), P2 (hierarchy, catalog, RLS) and the
OpenAPI contract need none of the above. The only week-2 item that is blocked is
**P6, the WordPress bridge** — which is precisely the item M1 is defined by, and
why S2 and S3 are the two to chase first.
