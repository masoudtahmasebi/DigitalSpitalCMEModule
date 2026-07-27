# Show stoppers — items that need a PM decision or an external answer

Status 27.07.2026, end of day 1. Everything here is **outside the engineering
team's control**: it needs a decision, an asset, or an answer from a third
party. Ordered by the date it stops being fixable.

Nothing in this list is a reason to pause development — the week-1 work is done
and week 2 can start. But **S11, S12, S2, S3 and S4** each have a date after
which the launch on **06.09.2026** is at risk.

**Three of these are questions for the Ärztekammer** (S11, S12, and half of S13)
and they all arise from the Anerkennungsbescheid. They can go in one email to
`zertifizierung@aekwl.de` — doing that today is the highest-value hour available
this week, because S11 in particular has no engineering workaround.

| #      | Item                                                                   | Blocks           | Needed by | Owner              |
| ------ | ---------------------------------------------------------------------- | ---------------- | --------- | ------------------ |
| S11    | **What is `Veranstaltungsende` for an on-demand course?**              | M3 · 30.08       | **07.08** | ÄKWL               |
| S12    | **"Originalstempel" may invalidate an emailed certificate**            | M3 · 30.08       | **14.08** | ÄKWL               |
| S2     | Whether the WP plugin persists a refresh token, and the token lifespan | M1 · 09.08       | **31.07** | MEDICE dev         |
| S3     | WordPress repository access                                            | M1 · 09.08       | **31.07** | MEDICE             |
| S4     | Scope decision on 4 layout features not in the 140 h                   | M2 · 23.08       | **06.08** | PM + DigitalSpital |
| S13    | Certificate needs `Anschrift` and two VNR barcodes                     | M3 · 30.08       | 14.08     | PM + ÄKWL          |
| S5     | Certificate-after-EIV vs the launch fallback                           | M3 · 30.08       | 14.08     | PM + MEDICE        |
| S7     | `required_watch_percent`: 80 % or 100 %, in writing                    | M2 · 23.08       | 14.08     | MEDICE             |
| S6     | Signature/stamp asset                                                  | M3 · 30.08       | 21.08     | MEDICE             |
| S8     | ADHS SMTP configuration, and which MEDICE account sends                | M3 · 30.08       | 21.08     | MEDICE             |
| S14    | Accreditation expires 12.10.2026; platform change must be notified     | post-launch      | 24.08     | MEDICE             |
| S9     | Hetzner account ownership and DNS                                      | M4 · 06.09       | 24.08     | DigitalSpital      |
| S10    | VNR password was shared over chat                                      | —                | now       | DigitalSpital      |
| ~~S1~~ | ~~Repository write access~~                                            | **CLOSED 27.07** | —         | —                  |

---

## S11 · What is `Veranstaltungsende` for an on-demand course? — **ask the ÄKWL first**

The single most consequential unknown in the project, and it comes straight out
of the Anerkennungsbescheid.

The reporting clock runs **8 days from Veranstaltungsende**. The Bescheid says
the Fortbildungsmaßnahme is _am 13.10.2025_ and valid _13.10.2025 – 12.10.2026_.
For a course that participants take on demand across a year, three readings are
possible and they are not close together:

| Reading                               | Consequence                                               |
| ------------------------------------- | --------------------------------------------------------- |
| The participant's **completion date** | Works. The only operationally sensible one.               |
| **13.10.2025**                        | Every submission is already years past deadline.          |
| **12.10.2026**                        | Nothing may be reported until the validity window closes. |

`eivDeadlines(eventEndAt, …)` takes this as an argument, so the implementation is
already indifferent to the answer — but **we do not know what value to pass**, and
the wrong one means either rejected submissions or a missed statutory deadline
for every learner.

`CLAUDE.md` §7: do not guess on compliance semantics. **This must be settled
before any live submission**, and it is a one-line question to
`zertifizierung@aekwl.de` / 0251 929-2244.

---

## S12 · "Originalstempel" may invalidate an emailed certificate

The Teilnahmebescheinigung Muster carries this clause:

> _Diese Bescheinigung ist nur vollständig ausgefüllt und mit **Originalstempel**
> des ärztlichen Antragstellenden oder der ärztlichen Leitung der
> Fortbildungsmaßnahme gültig._

And the Bescheid body repeats it: certificates _"sind mit dem Stempel der
Wissenschaftlichen Leitung zu versehen und von diesem zu unterzeichnen"_.

An emailed PDF with an embedded stamp image is arguably not an _Originalstempel_.
If the ÄKWL reads it strictly, **P8 (7 h) produces a document that is not valid**,
and MEDICE is back to stamping by hand — which removes the automated delivery the
feature exists for.

This subsumes the client's own open question about digital certificates, and it
outranks the stamp-asset question (S6): the answer determines whether the asset
matters at all.

**Do not build P8 until this is answered.**

---

## S2 · Does the WordPress plugin persist a refresh token? — narrowed, not closed

The MEDICE developer confirms the token is **held in the session**, and expects a
refresh token exists "since this is an OAuth method". That closes finding (a)
below and narrows the risk from _unknown_ to _unconfirmed_. Two questions still
decide P6's 5 h estimate.

**a) Token storage — answered.** Held in the PHP session. The supplied `Keycloak`
class does not show it, but the developer confirms it.

**b) Refresh — still unconfirmed, and this is the one that matters.** The plugin
uses the **password grant** (`grant_type=password`) and requests `offline_access`,
so a refresh token is very likely _returned_. Nothing in the supplied code
**stores or uses** it. "OAuth usually has one" is not the same as "this plugin
keeps it".

> **Two questions for the MEDICE developer:**
>
> 1. Is the **refresh token** written into the session alongside the access
>    token, and is there existing refresh logic anywhere in the plugin?
> 2. What is the realm's **access-token lifespan**?

Question 2 is why this still matters. At Keycloak's default of five minutes, a
25-minute video outlives the token four times over. ADR-0003 and P5-02 both
promise the learner is never interrupted mid-video. Without a stored refresh
token, either the session dies mid-video or we build refresh into a production
plugin — materially more than the "one small additive endpoint" P6 is costed at.

**c) The class shown is not the whole plugin.** `private static $session_init`
implies session handling in code we have not seen, and there is no `wp_login`
hook, no cookie-setting and no `class-keycloak.php` body here. We are reasoning
about roughly a third of the integration surface — another reason S3 matters.

**Impact if unanswered:** P6 is estimated at 5 h on the assumption that the
integration is one nonce-protected endpoint returning an already-stored token.
If refresh has to be built, that estimate is wrong, and M1 on **09.08** slips.

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

## S6 · The stamp and signature asset

The **stamp and signature of the Wissenschaftliche Leitung** must be supplied as
a digital asset before P8 in week 5.

Deliberately ranked **below S12**: if the ÄKWL says an emailed PDF cannot satisfy
the Originalstempel clause, the format of the asset is moot. Ask S12 first, then
this.

The Anerkennungsbescheid has now been read, and
`docs/requirements/medice-adhs.md` §2 is rebuilt from it rather than from ticket
text — course title, points, category, Veranstalter, Ort and the mandatory
sentence are all confirmed against the source.

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

## S13 · The certificate needs an address and two barcodes

Both come from the Teilnahmebescheinigung Muster, and neither is in the plan.

**`Anschrift:`** — the participant's postal address. We hold name and EFN and
deliberately nothing more (ADR-0004 keeps the personal-data footprint minimal).
Collecting an address adds a field, a capture step, a lawful-basis and retention
decision, and more to erase on a subject request. **+2 h** across P1, P5 and P8.

_Ask the ÄKWL whether a blank `Anschrift` is acceptable for an online on-demand
format before building it_ — the field exists for postal delivery, which does not
apply here.

**Two barcodes of the VNR** — `VNR (Code 39)` and `VNR (Datamatrix, App*)`, with
_"Felder bitte nicht überkleben"_. The Datamatrix is what the Ärztekammer's own
app scans, so it is functional, not decorative. Needs a barcode library in the
PDF pipeline: **+2 h** in P8. In scope — without them the certificate does not
match the Muster.

---

## S14 · Accreditation expires 12.10.2026, and changes must be notified

Two obligations from the Bescheid that outlive the project:

**Expiry.** Valid _13.10.2025 – 12.10.2026_ — five weeks after launch.
_"Für die folgende Zeit ist ggf. ein Antrag auf Verlängerung bei der ÄKWL zu
stellen. Für eine Verlängerung fallen keine Verwaltungsgebühren an."_ Free, but
somebody has to file it, and CME points stop being awardable if nobody does.

**Change notification.** _"Sollten sich nach der Anerkennung Änderungen jeglicher
Art an der Fortbildungsmaßnahme ergeben (z. B. Ausfälle, Umwandlung in ein
Online-Format, zeitliche oder inhaltliche Änderungen), sind diese in jedem Fall
zeitnah schriftlich der ÄKWL mitzuteilen, da die Anerkennung einer
Fortbildungsmaßnahme bei Änderungen nicht automatisch bestehen bleibt."_

Moving this course onto a new platform is plausibly such a change. A proactive
note to the ÄKWL costs nothing; discovering after launch that the accreditation
lapsed would be expensive.

---

## Useful: the Bescheid describes a paper fallback

Worth knowing because it is the real destination of P7-07's permanent-failure
escalation, which currently says only "a human pursues it":

> Ist in **schriftlich zu begründenden Ausnahmefällen** eine elektronische
> Datenübermittlung durch den Veranstaltenden nicht möglich, bietet die
> Ärztekammer Westfalen-Lippe den Service an, die Punktemeldung an den EIV
> vorzunehmen.

Conditions: the Anwesenheitsliste per the supplied Muster must have been used
with participants registered by EFN, and the **Original** list must reach the
ÄKWL within **8 days** of Veranstaltungsende — no copy, no fax.

This should be named explicitly in the P10-07 runbook.

---

## What is not blocked

Week 2 can start on schedule. P1 (auth), P2 (hierarchy, catalog, RLS) and the
OpenAPI contract need none of the above.

Two items are blocked, and they are different in kind:

- **P6, the WordPress bridge** — S2 and S3. This is the item M1 is defined by, so
  chase these first for schedule reasons.
- **P8, the certificate** — S12, and to a lesser extent S13. Do not start
  building until the ÄKWL answers whether an emailed PDF can be valid at all;
  building a barcode pipeline and an address capture flow for a document that may
  need a wet stamp is the wrong order.

**S11 outranks everything on this list for consequence**, even though it blocks
no code: `eivDeadlines` already takes the date as an argument, so nothing waits
on it — but passing the wrong value means every learner's CME points miss their
statutory deadline. It is one question to `zertifizierung@aekwl.de`.
