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

**A live token response arrived on 29.07 and settled S2** — there is a refresh
token and the access-token lifespan is 600 s. It also surfaced two things that
matter more than the answer: **S17**, the tokens carry `aud: account` so the API
refuses every one of them today, and **S18**, the refresh token supplied is an
_offline_ token that never expires and needs revoking now.

**Two more arrived on 28.07 with the plugin source.** S3 closes — we have the
code. Reading it closed S2 too, in the worst way: **the plugin stores no token
at all**, so P6-02's premise is void and MEDICE has a decision to make this
week. And it surfaced **S15**, a live API key hardcoded in that file, which
wants action today.

| #       | Item                                                                               | Blocks           | Needed by | Owner              |
| ------- | ---------------------------------------------------------------------------------- | ---------------- | --------- | ------------------ |
| S12     | **"Originalstempel" may invalidate an emailed certificate**                        | M3 · 30.08       | **14.08** | ÄKWL               |
| S15     | **Live API key hardcoded in the MEDICE plugin — rotate it**                        | —                | **today** | MEDICE             |
| S18     | **Offline refresh token exposed — revoke, and stop requesting `offline_access`**   | —                | **today** | MEDICE             |
| S17     | **Token `aud` is `account`; add an audience mapper or no learner can log in**      | M1 · 09.08       | **31.07** | MEDICE dev         |
| S2      | **The WP plugin stores no token.** Decide how it will — lifespan now known (600 s) | M1 · 09.08       | **31.07** | MEDICE dev         |
| S4      | Scope decision on 4 layout features not in the 140 h                               | M2 · 23.08       | **06.08** | PM + DigitalSpital |
| S11     | Confirm `Veranstaltungsende` = the learner's completion date                       | M3 · 30.08       | 07.08     | ÄKWL               |
| S5      | Certificate-after-EIV vs the launch fallback                                       | M3 · 30.08       | 14.08     | PM + MEDICE        |
| S7      | `required_watch_percent`: 80 % or 100 %, in writing                                | M2 · 23.08       | 14.08     | MEDICE             |
| S8      | ADHS SMTP configuration, and which MEDICE account sends                            | M3 · 30.08       | 21.08     | MEDICE             |
| S14     | Accreditation expires 12.10.2026; platform change must be notified                 | post-launch      | 24.08     | MEDICE             |
| S9      | Hetzner account ownership and DNS                                                  | M4 · 06.09       | 24.08     | DigitalSpital      |
| S10     | VNR password was shared over chat                                                  | —                | now       | DigitalSpital      |
| ~~S3~~  | ~~WordPress repository access~~                                                    | **CLOSED 28.07** | —         | —                  |
| ~~S13~~ | ~~`Anschrift` and two VNR barcodes~~                                               | **CLOSED 28.07** | —         | —                  |
| ~~S6~~  | ~~Signature/stamp asset~~                                                          | **CLOSED 28.07** | —         | —                  |
| ~~S1~~  | ~~Repository write access~~                                                        | **CLOSED 27.07** | —         | —                  |

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

## S2 · The WordPress plugin does **not** persist a token — **ANSWERED 28.07, and the answer is the bad one**

The plugin source arrived on 28.07 and it settles this. It also overturns the
developer's description, which is why it moved from "unconfirmed" to a blocker.

### What `keycloakwordpressplugin` actually contains

437 lines. The entire surface:

| Member                                       | What it does                                                  |
| -------------------------------------------- | ------------------------------------------------------------- |
| `Keycloak::getAccessTokenByUnamePass($u,$p)` | Password grant against the realm; **returns** the token array |
| `Keycloak::getUserInfoByToken($token)`       | userinfo lookup                                               |
| `Keycloak::sendConsentToMediceApi($profile)` | POSTs consent to the MEDICE API                               |
| `Keycloak::getSettings()`                    | Options, overridden by environment variables                  |
| `Settings`                                   | The admin screen                                              |

It registers **two hooks, both `admin_*`**. There is no login handler, no
`setcookie`, no `$_SESSION` write, no user-meta write and no refresh-token
handling anywhere in it. `LOGGED_IN_COOKIE` and `SHORT_CODE_TAG` are declared
and never used. Whatever calls `getAccessTokenByUnamePass` lives in the theme
or another plugin we still have not seen; the token it gets back is used to
fetch userinfo and then dropped on the floor.

**So: the token is not held in the session. It is not held anywhere.** There is
nothing for the widget's token endpoint to read.

### What this costs, and the decision MEDICE has to make

P6-02 assumed "read the token the plugin already has". That work does not
exist. Instead the login path has to start **storing** the token, and somebody
has to decide where:

| Option                                         | Cost      | Notes                                                                                                                            |
| ---------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **A — store at login, expose via the filter**  | ~1 h them | One `add_filter( 'ds_lms_access_token', … )` plus a write wherever the login happens. Purely additive, which is what P6-02 asks. |
| **B — the widget's own Keycloak login (PKCE)** | ~4 h us   | The admin console already does exactly this (`apps/admin/src/auth.ts`). Costs the learner a second visible login.                |

**Recommendation: A.** B works and the code exists, but the whole point of the
WordPress integration is "no second login" — that is M1's demo criterion.

### Answered 29.07: a real token response from the live realm

MEDICE supplied a complete token response from `login.medice.com`. **The raw
tokens are deliberately not reproduced here or anywhere in this repository** —
see §7 and S18. What it settles:

| Question                  | Answer                                                                          |
| ------------------------- | ------------------------------------------------------------------------------- |
| Is there a refresh token? | **Yes.**                                                                        |
| Access-token lifespan     | **600 s — ten minutes.**                                                        |
| Issuer                    | `https://login.medice.com/auth/realms/medicerealm`                              |
| Client (`azp`)            | `gemeinsam-adhs-begegnen`                                                       |
| Signing                   | RS256, so our accepted-algorithm list needs no change                           |
| Profile claims present    | `sub`, `given_name`, `family_name`, `email`, `institution`, `preferredLanguage` |

Ten minutes settles the design question option A raised: a 25-minute video
outlives an access token roughly 2.5 times, so **the WordPress endpoint must
refresh**, not merely hand out whatever it stored at login. The widget already
asks for a fresh token on a 401 (`token.ts`, `refresh: true`), so the work is
entirely on the WordPress side — and a refresh token now demonstrably exists to
do it with.

Option **A** therefore stands as the recommendation, with one addition: what is
stored at login is the **refresh** token, and the endpoint exchanges it for an
access token on demand.

Two things in that response are more important than the answer, and both have
their own entry: the audience is wrong for us (**S17**) and the refresh token
never expires (**S18**).

### Three defects in the supplied plugin, reported as a courtesy

Not ours to fix, and not blocking, but they were visible while reading it:

1. **A live-looking API key is hardcoded as a fallback default** in
   `sendConsentToMediceApi` — see S15 below. This one is urgent.
2. **The consent payload is built by string concatenation**, so an email
   containing `"` breaks the JSON and can inject fields:
   `'{"email": "' . $profile['userinfo']['email'] . '", …'`. `wp_json_encode`
   fixes it in one line.
3. **`getAccessTokenByUnamePass` echoes the cURL error and calls `die('--')`**
   on transport failure, printing diagnostics into the page on a production
   login path.

---

## The MEDICE consent API — noted, deliberately not integrated

`KEYCLOAK_CONSENT_API` (`https://login.medice.com/api/v1/adhs-network/request/`)
and its key were supplied on 28.07. **Nothing in this platform calls it, and
nothing should.** That is a decision, not an oversight, so here is the
reasoning.

The endpoint records that a person accepted MEDICE's AGB and newsletter terms.
`Keycloak::sendConsentToMediceApi()` posts to it from the **registration**
flow, at the moment somebody creates an account — which happens on MEDICE's
site, before this platform has ever heard of them. By the time the CME module
sees a learner, consent has already been given or the account would not exist.

Calling it from here would mean:

- **Recording consent nobody gave.** The payload hardcodes
  `consent_agb_given: true` and `consent_newsletter_given: true`. Sending that
  because a physician opened a course would assert agreement to a newsletter
  they never saw. That is a GDPR problem, not a plumbing one.
- **A second writer to a record with one owner.** Consent state belongs to
  MEDICE's identity system. Two systems writing it is how it ends up
  inconsistent, and the CME module has nothing to add.
- **Holding a credential we do not need.** `KEYCLOAK_CONSENT_API_KEY` was
  correctly withheld. The right amount of exposure to somebody else's consent
  API is none — see S15 for what happens when that key does travel.

**What would change this:** a requirement that the CME module itself collect a
consent — a separate data-processing agreement for the learning record, say.
That is not in the 140 h and is not in `docs/roadmap.md` §4. If it arrives, the
integration point is the completion flow, next to the EFN, and it needs its own
ticket, its own lawful basis and its own retention rule.

---

## S15 · A live API key is committed in the MEDICE plugin — **act today**

`inc/class-keycloak.php` carries this as the default when the environment
variable is absent:

```php
$consent_api_key = getenv_docker( 'KEYCLOAK_CONSENT_API_KEY', '<40-hex-character key, redacted here>' );
```

A 40-character hex token, in source, in a repository, and in the zip that was
shared over chat. It authenticates writes to
`https://login.medice.com/api/v1/adhs-network/request/` — the endpoint that
records a physician's consent.

**It is deliberately not reproduced in this repository**, and nothing
DigitalSpital builds uses it.

**Action for MEDICE:** rotate it, then remove the default so an unset variable
fails loudly instead of silently falling back to a shared credential. This is
the same class of finding as S10 (the VNR password shared over chat) and has the
same remedy — credentials belong in the environment or a secret store, never in
source.

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

One item that started here has been split out, because it is now blocking a
built screen rather than an estimate: the player's **`63% absolviert`** — see
**S16**.

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

## S16 · What does the player's `63% absolviert` measure? — **shipped with a stated referent, confirm the wording**

Owner: MEDICE (layout), answer needed before the layout review.
Blocks: nothing. The screen is built; only its wording is provisional.

The player's progress panel in the approved layout reads:

> `Modul 3 von 5` · `14:35 / 25:45` · **`63% absolviert`**

14:35 of 25:45 is **56.6 %**, so the figure is not the current video's position.
Nor is it stated what it _is_ a percentage of — module completion, content
completion, watched time across the course, or something else. Three different
quantities would all be plausible at 63 %, and they diverge sharply in the
middle of a course: on a five-module course, a learner two modules in with a
long video half-watched is at 40 % of modules and some quite different fraction
of content.

This is a number a physician reads as a statement about whether they are going
to earn their points. `CLAUDE.md` §7 forbids guessing on that.

**What was built.** The panel renders the server's `progress.percent` — the
content-weighted course figure, the same one the completion gate reasons about —
and _names_ it:

> `63 % der Fortbildung absolviert`

The layout's own word is kept; what is added is the noun it applies to. This is
a deliberate, recorded deviation from the copy, on the grounds that an ambiguous
number is worse than a slightly longer sentence. It is asserted in
`PlayerScreen.test.tsx`.

**A second finding, 29.07: the figure we are showing does not move while you
watch.** `progress.percent` counts _content items_, and an item is 0 or 100 —
`rollupProgress` has no partial credit. So a learner who watches a 25-minute
video from start to finish sees the number sit at 63 % for twenty-five minutes
and then jump. The layout prints it directly beside a live `14:35 / 25:45`,
which implies the opposite.

That makes the current choice defensible but probably not what was meant, and it
raises a **second candidate the platform already computes**:

| Candidate                          | What it is                                 | Behaviour                                                                                                     |
| ---------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `progress.percent` _(shown today)_ | finished content items ÷ all content items | Jumps. Ignores length — a one-paragraph text page counts as much as a 25-minute lecture.                      |
| `achievedWatchPercent`             | union watch coverage ÷ total video seconds | Moves continuously while watching. Duration-weighted. **It is the figure the completion gate actually uses.** |
| `moduleCompletion`                 | modules finished ÷ modules                 | Already feeds the ring on the course page.                                                                    |

`achievedWatchPercent` fits the layout's placement best — it sits beside a
timeline because it moves with the timeline — and it has the strong property of
being the number the gate enforces. It is deliberately **not** being switched to
unilaterally, because it counts only video: on a course that is half reading, a
learner reading "100 % absolviert" would still have a quiz and an evaluation
outstanding.

**What is needed.** Confirmation of _which quantity_ the layout intends. If it
is not content-weighted course progress, the fix is one prop and one locale
entry — `apps/widget/src/locale/de.ts` (`player.courseProgress`) and the panel
in `PlayerScreen.tsx`; every candidate above is already on `EnrolmentState`. If MEDICE want the bare `63% absolviert` wording back,
that is their call to make in writing, and this note records that it was raised.

Related: the same panel's `14:35 / 25:45` is drawn against the **authored**
video length, because that is what the server computes the watch percentage
from. A player reading the media element's own duration could show a total that
disagreed with the percentage next to it.

---

## S17 · MEDICE's tokens carry the wrong audience — **every learner is refused today**

Owner: MEDICE (Keycloak admin). Needed by **31.07**, with S2. Blocks M1.

The access token from `login.medice.com` carries:

```
aud: "account"          ← Keycloak's default
azp: "gemeinsam-adhs-begegnen"
```

`"account"` is Keycloak's own built-in client. It is **not** an audience for
this API, and nothing in that token says it was minted to be sent to us.

ADR-0003 is the reason that matters: the API validates every bearer token
against JWKS for signature, issuer, **audience** and expiry, and takes the
expected issuer and audience from the project's own binding row. A token whose
audience is `account` fails that check.

**Verified, not inferred.** Running the real `verifyToken` against tokens shaped
like MEDICE's:

| `aud` on the token                | Result                        |
| --------------------------------- | ----------------------------- |
| `"account"`                       | **REJECTED** `wrong_audience` |
| `"ds-education-api"`              | accepted                      |
| `["account", "ds-education-api"]` | accepted                      |

So today, with a perfectly valid MEDICE login, **every learner gets a 401 and no
course opens.**

### The fix is one Keycloak change on MEDICE's side

Add an **Audience mapper** to the `gemeinsam-adhs-begegnen` client — a dedicated
client scope with a `oidc-audience-mapper` naming this API's audience (the value
we put in `projects.keycloak_audience`). Keycloak then issues
`aud: ["account", "<our audience>"]`, which the third row above shows is already
accepted. **No code change here.**

### Why we should not simply accept `azp` instead

It is one line and it would work, and it is the wrong line. `aud` is the claim
that says _who this token is for_; `azp` says which client asked for it.
Accepting a token on `azp` alone means accepting any token that client ever
minted, for any purpose, at any service — the confused-deputy problem the OAuth
security BCP is explicit about. Today there is one client and the practical risk
is small; the point is that the check would no longer mean what ADR-0003 says it
means, and nobody would notice when a second client appears.

If MEDICE genuinely cannot add the mapper, the fallback is a **per-project
opt-in** — a column saying "this binding accepts `azp = X` in place of an
audience" — so the weakening is visible in the data, scoped to one tenant, and
reviewable. That is auth code and carries the human review gate (CLAUDE.md §2);
it is **not** being written on spec.

---

## S18 · The supplied refresh token is an **offline** token and never expires — **revoke it today**

Owner: MEDICE. Needed: **now**.

The token response pasted into the project chat on 29.07 contains a refresh
token with:

```
typ: "Offline"
no  exp  claim
refresh_expires_in: 0
scope: … offline_access …
```

An offline token is a **permanent credential**. It does not expire with the
session, it survives logout, and it can be exchanged for a fresh access token
for that physician indefinitely. It has now been through a chat log.

**Two actions, and the first is not optional:**

1. **Revoke it.** In Keycloak: that user's _Consents_ / offline sessions for
   `gemeinsam-adhs-begegnen`, or `POST /revoke` on the realm. This is the same
   class of incident as S15 and should be treated the same way. The access token
   beside it has already expired on its own (ten minutes); the refresh token has
   not and will not.
2. **Ask whether `offline_access` should be requested at all.** For a browser
   SSO session it should not be. Requesting it turns every learner login into a
   permanent credential sitting in whatever storage the WordPress side chooses —
   which is a much larger exposure than the one token above. A normal refresh
   token, bounded by `SSO Session Idle` / `Max`, is what this integration needs.

**Nothing from that response is recorded in this repository** — no token, no
subject, no name, no email, no address. §7's rule covers credentials; this
extends it to the personal data that came with them.

### Two useful things the same response revealed

Neither is a blocker; both are decisions that just became cheaper.

- **The address is already in the ID token.** `address` carries street, postal
  code, locality and country. §6.8 records that the certificate Muster has an
  `Anschrift` field we deliberately do not collect. We would not have to: it is
  available at login. That does **not** make it automatic — ADR-0004 keeps the
  personal-data footprint minimal on purpose, and pulling an address in because
  it happens to be there is exactly the drift GDPR data minimisation forbids. It
  is now a choice rather than a constraint, and it belongs to the PM with
  `docs/gdpr.md` §2 updated either way.
- **There is an empty `medicenumber` claim.** If MEDICE intend that field to
  hold the EFN, the collection step in §1 could be pre-filled from the token
  instead of typed — which is the same idea as the Salesforce `vDMC_EFN__c`
  pre-fill in §6.12. **Ask what `medicenumber` is for.** It is empty for this
  user, so nothing can be concluded from the value.

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

## S19 · `ds_app` may now perform a GDPR erasure — **a reversed security decision, for human sign-off**

**Owner:** DigitalSpital (security) · **Raised:** P12-05 · **Not blocking, but not silent**

Migration 0009 gave `erase_subject` to `ds_migrator` and to nobody else, with an
explicit rationale: `ds_app` runs every HTTP request, so granting it that
function makes a bug in any controller an erasure primitive. An integration test
asserted the refusal.

Migration 0023 grants it to `ds_app`, because the alternative was that the only
way to honour an Art. 17 request is for somebody with migration credentials to
run SQL by hand. A subject right that depends on a DBA being reachable is not
much of a right, and Art. 12(3) puts a month on the response.

**What the grant does not include.** No BYPASSRLS, and no privilege on any table
the function's body touches — `SECURITY DEFINER` runs it as `ds_erasure`, whose
grants (enumerated in 0009) are narrower than `ds_app`'s own. Everything that
makes an erasure safe is inside the function: it refuses while a Punktemeldung
is open, it pseudonymises rather than deleting so the CME record survives, and
it writes its own audit row.

**The residual risk.** A controller bug or an injection reaching this could
erase one subject per call. The API path requires `customer_admin` or above, is
rate-limited to five per five minutes, and writes a second audit row naming the
operator. Nothing about it is a mass operation and nothing about it is silent.

**What is wanted:** a security reviewer to agree the trade, or to ask for the
alternative — the console _requesting_ an erasure and a separate credential
performing it, which preserves the original property at the cost of a queue and
a second database role.

---

## S20 · The layout starts a **Teilprüfung** from the Abschlussprüfung screen — **which is it?**

- **Owner:** MEDICE (layout) · **Blocks:** P4 · **Raised:** 05.08 from `260729_MEDICECMEFortbildungMS.pdf` p. 08

Page 08 of the layout is the Lernerfolgskontrolle's start screen. Its eyebrow says
`Lernerfolgskontrolle`, its heading says **Abschlussprüfung**, its stat cards describe
the eleven-question course-level test — and its primary button says
**`Teilprüfung starten`**.

Those are two different assessments. `Teilprüfung` was raised on 27.07 as new scope
(requirements §6.1, +6–8 h) and was descoped: a per-module test needs its own question
bank, its own attempt ledger and its own gate, none of which are in the schema.

Two readings, and they cost differently:

- **The label is a slip.** The button should say `Abschlussprüfung starten`, and
  nothing else changes. Zero hours.
- **Teilprüfung is back.** Then the screen is right and the rest of the layout is
  missing it — no per-module result, no per-module retry, and no per-module state in
  the sidebar on pages 06–07. Roughly +6–8 h, and it moves a compliance gate.

**Built as: `Abschlussprüfung starten`**, matching the heading directly above it and
the only assessment the platform has. If the second reading is the right one, say so
and the ticket comes back.

---

## S21 · The layout says the EFN is **18 digits**; the platform validates **15**

- **Owner:** MEDICE / ÄKWL · **Blocks:** P6, P7 · **Raised:** 05.08 from `260729_MEDICECMEFortbildungMS.pdf` p. 13

Page 13 captures the EFN under the helper text:

> _Die 18-stellige EFN finden Sie auf Ihrem Arztausweis_

`packages/domain/src/eiv.ts` accepts `/^[0-9]{15}$/`, which is what the EFN has been
throughout this project, and the placeholder digits printed on page 13 are eighteen
characters long, so this is not a typo in the caption alone.

**Nothing has been changed.** This is exactly the case `CLAUDE.md` §7 covers: the EFN
is the key the Punktemeldung is filed under, and a validator that is wrong in either
direction fails in a way the learner cannot see.

- Validate 15 and the real number is 18 → every physician is turned away at the last
  step of a course they have finished.
- Validate 18 and the real number is 15 → the submission is accepted by us and
  rejected by EIV-FOBI, after the certificate has already been shown.

**One question, and it is not for MEDICE's designer:** what length does EIV-FOBI
accept for `efn`? If the answer is 15, page 13's caption needs correcting before it
goes in front of a physician. If it is 18, `isValidEfn` and its tests change, along
with the masking rule in `packages/domain/src/moderation.ts`, and every EFN captured
before the change has to be re-validated.

Until it is answered the field stays at 15, because that is the number the EIV
requirements document was written from.

---

## S22 · The V2 desktop exports disagree with the delivered PDF — **which is current?**

- **Owner:** DigitalSpital → the client's designer · **Raised:** 06.08

The archive of 06.08 carried nine desktop screens as PNG exports from the
design tool, at the resolution the layout was drawn at. They are the same
screens as pages 01–08 of the delivered PDF, and on the catalogue they are
**not the same drawing**. Three differences, in `docs/design/desktop/`:

1. **No tab row.** The PDF puts `On Demand` / `Weitere` as folder tabs on the
   panel's top edge — the arrangement ticket #59 turned into an extension
   point for a future Live/Zoom tab. The V2 export has no tabs at all.
2. **A section strapline the PDF does not have.** "On-Demand-Fortbildungen –
   volle Flexibilität und jederzeit verfügbar", teal and bold, above the
   filters. There is nowhere in the schema this comes from: it is per section,
   not per project, and it is not a course field.
3. **No card outline.** The V2 panel has no border and no rounded top corner;
   it is filters and a divider on the page background.

Read together with the mobile export — which _does_ show the section's name
("On Demand") as a heading over the filters — the V2 desktop looks like a
later revision that replaced the tabs with a strapline. But three screens in
that archive arrived **twice, with different content and no note**, which is
exactly what an export of a working file in mid-revision looks like.

**The question:** is the V2 set newer than the PDF, and does it replace it?

Until it is answered the implementation follows the **PDF**, because that is
the delivered document — recorded in `docs/design/desktop/README.md` so the
next person meets the reasoning rather than the contradiction.

**What it costs to be wrong.** Little, and it is worth saying so: the tab row
is one component behind `CATALOG_SECTIONS`, the strapline is one string, and
the panel's border is one class. Nothing downstream depends on which way this
goes. It needs an answer, not a decision from us.

**One thing was taken from the V2 export regardless**, because both it and the
mobile export agree and the PDF is merely ambiguous: the orange chevron on the
filter selects is a **full-height block with a rounded bottom-right corner**,
not the inset rounded square that was built from the PDF's softer edges.

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
