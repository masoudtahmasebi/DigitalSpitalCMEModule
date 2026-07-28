# Show stoppers — items that need a PM decision or an external answer

Status 28.07.2026. Everything here is **outside the engineering team's
control**: it needs a decision, an asset, or an answer from a third party.
Ordered by the date it stops being fixable.

## Answered by the client on 28.07

Four of these are now settled and the code follows the answers:

| Item                            | Answer                                                                                                                                                                                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Certificate field set**       | Confirmed as the Bescheid's minimum list. Built and asserted in `missingCertificateFields`; a certificate cannot be issued without every one.                                                                                                           |
| **Whose stamp, and where from** | The stamp and signature belong to **the course**, supplied by whoever creates it. Stored per course (migration `0006`), uploaded through the admin console — not a platform-wide asset. **S6 closes**: it is an authoring input, not a project blocker. |
| **Delivery**                    | Learner downloads the PDF from the system now; per-customer SMTP delivery is **foreseen, not built** — see below.                                                                                                                                       |
| **`Anschrift`**                 | Not in the required list, so it is not collected. The line renders blank, as on the paper Muster. **Half of S13 closes.**                                                                                                                               |

**S11 is also answered, by the Muster itself** — see the section below. What
remains is confirming that reading with the ÄKWL, not deciding it.

### What "foreseen, not built" means for email delivery

Nothing about email is implemented, and no scope was widened to accommodate it.
What exists is the absence of an obstacle:

- `projects.smtp_host / smtp_port / smtp_user / smtp_password_enc` already exist
  and the password column is encrypted at rest through the same `SecretCipher`
  as the VNR password — so the credentials have a home that is not a plaintext
  column.
- `CertificateService.download()` returns `{ filename, bytes }`. A mailer would
  be a **second caller of the same method**, not a second renderer — so the
  certificate a physician downloads and the one that arrives by email are
  byte-identical by construction.
- The `certificates` table already carries `status` with `delivered` and
  `bounced` values, so delivery state has somewhere to go without a migration.

The open question that email would raise is **S5**, not a technical one.

Nothing in this list is a reason to pause development — the week-1 work is done
and week 2 can start. But **S11, S12, S2, S3 and S4** each have a date after
which the launch on **06.09.2026** is at risk.

**Two of these are questions for the Ärztekammer** (S12, and confirming S11) and
both arise from the Anerkennungsbescheid. They fit in one email to
`zertifizierung@aekwl.de`, and S12 is the one worth sending today — it is the
only item on this list with no engineering workaround at all.

| #       | Item                                                                   | Blocks           | Needed by | Owner              |
| ------- | ---------------------------------------------------------------------- | ---------------- | --------- | ------------------ |
| S12     | **"Originalstempel" may invalidate an emailed certificate**            | M3 · 30.08       | **14.08** | ÄKWL               |
| S2      | Whether the WP plugin persists a refresh token, and the token lifespan | M1 · 09.08       | **31.07** | MEDICE dev         |
| S3      | WordPress repository access                                            | M1 · 09.08       | **31.07** | MEDICE             |
| S4      | Scope decision on 4 layout features not in the 140 h                   | M2 · 23.08       | **06.08** | PM + DigitalSpital |
| S11     | Confirm `Veranstaltungsende` = the learner's completion date           | M3 · 30.08       | 07.08     | ÄKWL               |
| S5      | Certificate-after-EIV vs the launch fallback                           | M3 · 30.08       | 14.08     | PM + MEDICE        |
| S7      | `required_watch_percent`: 80 % or 100 %, in writing                    | M2 · 23.08       | 14.08     | MEDICE             |
| S8      | ADHS SMTP configuration, and which MEDICE account sends                | M3 · 30.08       | 21.08     | MEDICE             |
| S14     | Accreditation expires 12.10.2026; platform change must be notified     | post-launch      | 24.08     | MEDICE             |
| S9      | Hetzner account ownership and DNS                                      | M4 · 06.09       | 24.08     | DigitalSpital      |
| S10     | VNR password was shared over chat                                      | —                | now       | DigitalSpital      |
| ~~S13~~ | ~~`Anschrift` and two VNR barcodes~~                                   | **CLOSED 28.07** | —         | —                  |
| ~~S6~~  | ~~Signature/stamp asset~~                                              | **CLOSED 28.07** | —         | —                  |
| ~~S1~~  | ~~Repository write access~~                                            | **CLOSED 27.07** | —         | —                  |

S11 drops from first place to fifth: the Muster answers it, and the answer is
already what the code does. It stays open because confirming a reading is not
the same as having one.

---

## S11 · What is `Veranstaltungsende` for an on-demand course? — **the Muster answers it; confirm it**

> **Plain-language version of the question, since it was asked on 28.07:**
>
> The Ärztekammer must be told about a learner's points within **8 days of the
> event ending**. For a live seminar "the event ended" is obvious — everyone was
> in the room, they all left at 17:00, the clock starts. This course has no
> room and no 17:00. Every physician takes it at a different moment across a
> year. So: **8 days from what?**
>
> The Bescheid gives two dates that could be meant — the Maßnahme is _am
> 13.10.2025_, valid _13.10.2025 – 12.10.2026_ — and neither works. If the
> deadline runs from 13.10.2025 it expired in October 2025 and every submission
> is already too late. If it runs from 12.10.2026 nothing may be reported until
> the accreditation is nearly over.
>
> **The Muster settles it.** It reads _"am \_\_\_\_\_\_\_\_ als on-demand-Webinar
> teilgenommen hat"_ — one blank date, per participant, filled in by the
> Veranstalter. On an on-demand format the only date that blank can hold is the
> day that physician finished. So `Veranstaltungsende` is **the learner's own
> completion**, and it is different for every learner.
>
> That is what the code does: `completion.service.ts` passes the completion
> instant as `eventEndAt`, and the certificate prints the same instant as the
> Veranstaltungsdatum. The date on the physician's certificate and the date the
> 8-day clock runs from are the same value, from the same line of code —
> they cannot drift apart.
>
> **Why it is still on this list:** that is our reading of a form, not a
> statement from the ÄKWL. It is one sentence to confirm, and confirming it
> costs nothing. The mitigation below means the launch does not wait for it.

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

### Mitigation, decided 27.07: submit immediately

**Submit to EIV the moment the learner completes**, rather than batching or
scheduling. Retry three times at 10-minute intervals, then continue with slower
backoff, and surface anything still unresolved in the admin console so a human
can act.

This is the right design regardless of the answer, and it **removes most of the
exposure**: if we submit within seconds of completion, no plausible reading of
`Veranstaltungsende` puts us outside an 8-day window that starts at or after the
completion date. Speed is the cheapest form of compliance here.

**It does not close the question**, for two reasons:

1. If `Veranstaltungsende` is the **event date 13.10.2025**, the window closed on
   21.10.2025 and **EIV will reject every submission no matter how fast we are**.
   Submitting quickly cannot rescue a window that is already shut.
2. The retry loop needs to know **when to stop**. After the correction window
   closes nothing can be sent electronically, and `shouldStopRetrying` is
   computed from these dates. Without them the queue either gives up too early or
   retries into a closed window forever.

`CLAUDE.md` §7: do not guess on compliance semantics. Still a one-line question
to `zertifizierung@aekwl.de` / 0251 929-2244 — but the launch date no longer
depends on the answer arriving first.

---

## S12 · "Originalstempel" may invalidate an emailed certificate

> **First, a point of fact that came up on 27.07 and is worth settling in
> writing: the certificate is not produced by the Ärztekammer or by EIV. It is
> MEDICE's own obligation, and this platform generates it.**
>
> > **Bescheinigung der Teilnahme** — _Der **Veranstalter** verpflichtet sich am
> > Ende der Fortbildungsmaßnahme, allen Teilnehmern eine namentlich
> > gekennzeichnete Teilnahmebescheinigung **zur Verfügung zu stellen**. Diese
> > dient der individuellen Fortbildungsdokumentation der Ärztinnen und Ärzte und
> > ggf. als Nachweis für das Finanzamt._
>
> The ÄKWL supplies a **template** — _"Die beiliegende Teilnahmebescheinigung
> **kann als Muster verwendet werden**"_ — and asks the Veranstalter to fill it
> in: _"Wir bitten Sie, die Fortbildungspunkte auf der Teilnahmebescheinigung …
> zu vermerken"_.
>
> The EIV `push_teilnahme` call and the certificate are **two separate
> obligations that share a VNR**. The API transfers points into the physician's
> Kammer account; the certificate is a document the physician keeps for their own
> Fortbildungsdokumentation and for the Finanzamt. Sending the API call does not
> cause anyone to produce a certificate.
>
> This matches the client's own ticket, which asks for _"a named participation
> certificate … automatically sent to the participant via email from a MEDICE
> email account"_ and requests a technical concept and estimate for it.
>
> **Consequence: P8 stays in scope, and so do S13's `Anschrift` and barcodes.**
> Dropping them would put MEDICE in breach of the Verpflichtung it accepted with
> the accreditation.

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

## ~~S6~~ · The stamp and signature asset — **CLOSED 28.07**

Answered by the client: the stamp and signature belong to **the course**, and
whoever creates the course supplies them. That makes this an authoring input
rather than a project-level blocker, and it is why migration `0006` puts
`stamp_image` / `signature_image` on `courses` and not on `customers` — a second
course with a different Wissenschaftliche Leitung needs a different stamp, and
replacing an expired one must fix every future download without touching
certificates already issued.

The seed ships 1×1 placeholder PNGs so the pipeline runs locally, and says so on
every run. **The real assets are still needed before anything ships** — that is
now a content task on the course, tracked with the rest of the seeding, not an
open question.

Still ranked below S12 in consequence: if the ÄKWL says an emailed PDF cannot
satisfy the Originalstempel clause, the format of the asset is moot.

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

## S13 · The certificate needs an address and two barcodes — **both resolved 28.07**

Both come from the Teilnahmebescheinigung Muster.

**`Anschrift:` — not collected.** The client confirmed the required field set,
and it is the Bescheid's minimum list: VNR, Titel, Datum, Uhrzeit, Ort,
Veranstaltender, Punkte und Kategorie, Name des Teilnehmenden. `Anschrift` is
not among them. The field exists on the paper form for postal delivery, which
does not apply to an online on-demand course, so **the line renders blank**,
exactly as it does on the Muster, and ADR-0004's minimal personal-data footprint
is preserved. No capture step, no retention decision, no extra erasure surface.
`missingCertificateFields` deliberately excludes it.

**Two barcodes of the VNR — built.** `VNR (Code 39)` and `VNR (Datamatrix,
App*)` are rendered by `certificate.renderer.ts` via `bwip-js`. The Datamatrix
is what the Ärztekammer's own app scans, so it is functional, not decorative.
Same VNR string feeds both and the printed digits below them, so a mismatch is
not representable.

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

The API is built and the learner journey runs end to end — catalog, gated
player, quiz, evaluation, EFN, completion, Punktemeldung, certificate PDF.
None of it waited on this list.

One item is genuinely blocked:

- **P6, the WordPress bridge** — S2 and S3. This is the item M1 is defined by,
  so chase these first for schedule reasons.

**P8 is no longer blocked and is built.** That is a change from 27.07, and a
deliberate one. The reasoning then was "do not build a barcode pipeline for a
document that may need a wet stamp"; the client has since confirmed the field
set and the stamp's provenance, and the barcodes turned out to be an afternoon
rather than a pipeline. If S12 comes back badly, what is lost is the layout —
the participation data, the VNR, the points and the audit trail are all needed
either way, and a wet-stamp fallback would print the same document for a human
to sign.

**S12 is now the only item on this list with no engineering workaround.** If an
emailed or downloaded PDF cannot satisfy the Originalstempel clause, no amount
of code fixes it — MEDICE signs by hand, and the platform's job becomes
producing the sheet they sign. One question to `zertifizierung@aekwl.de`.
