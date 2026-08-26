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

| #       | Item                                                                                      | Blocks           | Needed by | Owner         |
| ------- | ----------------------------------------------------------------------------------------- | ---------------- | --------- | ------------- |
| ~~S12~~ | ~~"Originalstempel" may invalidate an emailed certificate~~                               | **CLOSED 11.08** | —         | —             |
| ~~S15~~ | ~~Live API key hardcoded in the MEDICE plugin~~ — **rotated by MEDICE 11.08**             | **CLOSED 11.08** | —         | —             |
| S18     | **Offline refresh token exposed — revoke, and stop requesting `offline_access`**          | —                | **today** | MEDICE        |
| S17     | **Token `aud` is `account`; add an audience mapper or no learner can log in**             | M1 · 09.08       | **31.07** | MEDICE dev    |
| S2      | **The WP plugin stores no token.** Decide how it will — lifespan now known (600 s)        | M1 · 09.08       | **31.07** | MEDICE dev    |
| S4      | Scope decision on 4 layout features not in the 140 h — **PM is deciding**                 | M2 · 23.08       | **06.08** | PM            |
| S11     | **The register holds a one-day event; correct the period, or name the date**              | **launch**       | 07.08     | ÄKWL          |
| ~~S5~~  | ~~Certificate-after-EIV vs the launch fallback~~ — **decided 24.08: issue on completion** | **CLOSED 24.08** | —         | —             |
| ~~S7~~  | ~~80 % or 100 %~~ — **already per course; a field, not a constant. 20.08**                | **CLOSED 20.08** | —         | —             |
| S8      | ADHS SMTP configuration — **PM is setting it in the console**                             | M3 · 30.08       | 21.08     | PM            |
| S14     | Accreditation expires 12.10.2026; change must be notified — **PM accepted**               | post-launch      | 24.08     | PM            |
| ~~S9~~  | ~~Hetzner account ownership and DNS~~ — **DigitalSpital's own, confirmed 20.08**          | **CLOSED 20.08** | —         | —             |
| S10     | VNR password shared over chat — **rotation requested from MEDICE in a call 20.08**        | —                | now       | MEDICE        |
| S23     | **VNR format, and whether any VNR-less completion already exists**                        | —                | 14.08     | MEDICE / ÄKWL |
| S25     | **Which point flags may a completion claim for this VNR?**                                | M3 · 30.08       | **14.08** | MEDICE / ÄKWL |
| ~~S26~~ | ~~Production EIV API base URL~~ — **`https://backend.eiv-fobi.de`, 20.08**                | **CLOSED 20.08** | —         | —             |
| S28     | **Learner tokens carry no name or email — the certificate cannot be filled**              | M3 · 30.08       | **24.08** | MEDICE / DS   |
| S27     | **Test-system credentials from EIV support, so the client can be proven**                 | M3 · 30.08       | **14.08** | MEDICE        |
| S29     | **The Veranstalter interface we integrate against has an announced shutdown**             | **launch**       | **now**   | EIV / BÄK     |
| ~~S24~~ | ~~Export the EIV Veranstalter Swagger~~                                                   | **CLOSED 09.08** | —         | —             |
| ~~S3~~  | ~~WordPress repository access~~                                                           | **CLOSED 28.07** | —         | —             |
| ~~S13~~ | ~~`Anschrift` and two VNR barcodes~~                                                      | **CLOSED 28.07** | —         | —             |
| ~~S6~~  | ~~Signature/stamp asset~~                                                                 | **CLOSED 28.07** | —         | —             |
| ~~S1~~  | ~~Repository write access~~                                                               | **CLOSED 27.07** | —         | —             |

S11 drops from first place to fifth: the Muster answers it, and the answer is
already what the code does. It stays open because confirming a reading is not
the same as having one.

---

## S11 · The register holds a one-day event for a twelve-month Fortbildung

> **Updated 24.08.2026 — the value is known now, and it is the bad one.**
>
> The connection check against the live register returned the accredited period
> EIV holds for VNR 2760552025919300018:
>
> ```
> beginn  2025-10-12T22:00:00.000Z   → 13.10.2025 00:00 (MESZ)
> ende    2025-10-13T21:00:00.000Z   → 13.10.2025 23:00 (MESZ)
> ```
>
> One day. `push_teilnahme` refuses a `teilnahmedatum` outside the accredited
> period with a **406**, so on today's data **every completion this platform
> reports is refused** — which is what the 09.08 note below predicted would
> happen if `ende` turned out to be 13.10.2025.
>
> **This is now two questions, not one, and the first is the better one.**
>
> The ÄKWL's own _Richtlinien zur Anerkennung und Bewertung von
> Fortbildungsmaßnahmen_ work with an **Anerkennungszeitraum** inside which many
> individual sessions may fall, and recognise **Fortbildungsreihen** for a
> calendar year. A twelve-month accredited period with a completion date
> anywhere inside it is therefore a shape the ÄKWL already handles — and a
> one-day `beginn`/`ende` on a twelve-month on-demand Fortbildung looks like a
> register field filled in as though it were a live event.
>
> So ask both, in one sentence, and accept either answer:
>
> 1. **Should the accredited period be corrected** to the recognition period
>    from the Anerkennungsbescheid, 13.10.2025 – 12.10.2026?
> 2. **If not, which `teilnahmedatum` do you expect** for an on-demand
>    Fortbildung taken across that period?
>
> (1) unblocks the platform as built and needs no code. (2) is only needed if
> (1) is refused, and it is the one that may cost an implementation. Asking (1)
> first is not politeness — it is the reading their own Richtlinien support.

### 25.08 — S11 and S25 are one defect, not two, and that changes how to ask

EIV publishes how a VNR's dataset comes into being:

> _"Aus den Angaben des Antrages wird von der Ärztekammer zu der VNR ein
> Datensatz (u.a. Titel, Datum, Ort, Kategorie, Anzahl Fortbildungspunkte) …
> angelegt und an den EIV übertragen"_
> — `eiv-fobi.de/fuer-veranstalter`

So the register's `beginn`/`ende` **and** its `punkte_basis`/`punkte_lernerfolg`
split come from the **same source**: the Antrag, as transcribed by the Kammer.
S11 and S25 are not two independent surprises about two fields. They are one
question about one dataset, and it is a **data-entry correction the Kammer can
make** — not a workaround for us to choose.

That is a materially stronger request, and it should be sent as one:

> Der bei der EIV hinterlegte Datensatz zur VNR `2760552025919300018` weicht in
> zwei Punkten vom Anerkennungsbescheid vom 18.06.2026 ab:
>
> 1. **Anerkennungszeitraum.** Die Schnittstelle liefert `beginn` und `ende`
>    beide am 13.10.2025, also einen einzigen Tag. Der Bescheid erkennt die
>    Fortbildung vom 13.10.2025 bis 12.10.2026 an. Da es sich um eine
>    On-Demand-Fortbildung handelt, liegt das Teilnahmedatum jeder Teilnehmerin
>    zwangsläufig innerhalb dieses Jahres — `push_teilnahme` weist ein
>    Teilnahmedatum außerhalb des hinterlegten Zeitraums jedoch mit HTTP 406 ab.
>    **Derzeit ist damit jede Punktemeldung zu dieser Fortbildung unmöglich.**
> 2. **Punkteaufteilung.** Der Bescheid vergibt 4 Punkte der Kategorie D unter
>    der Voraussetzung von mindestens 70 % richtig beantworteter Fragen. Bitte
>    bestätigen Sie, wie sich diese 4 Punkte im Datensatz auf `punkte_basis` und
>    `punkte_lernerfolg` verteilen, damit die Meldung die richtigen Flags setzt.
>
> Wir bitten um Korrektur bzw. Bestätigung des Datensatzes.

Point 2 is only needed if the EIV-Abgleich screen shows `assessmentPoints: 0` —
see S25, which can be read off a screen today without asking anybody. Sending
both together is still right when point 1 has to be sent regardless: it is one
correction to one dataset, and splitting it across two mails invites two partial
answers.

## S11 (original) · What is `Veranstaltungsende` for an on-demand course? — **the Muster answers it; confirm it**

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
>
> **Updated 09.08 — the API can now be asked, and it raises the stakes.** The
> Swagger (S24, closed) shows `GET /fobi/veranstalter/veranstaltung` returning
> `beginn` and `ende` for the VNR, and `push_teilnahme` refusing a
> `teilnahmedatum` outside that period with a **406**. So EIV holds an opinion
> about when this event ran, and it enforces it.
>
> If that `ende` is 13.10.2025, then **every completion this platform reports
> will be refused**, no matter what our own 8-day clock says. That is no longer
> a question about which date to pass to our deadline function; it is a question
> about whether the Punktemeldung is possible at all.
>
> One command answers it against the test system, once S27 supplies
> credentials: `pnpm --filter @ds/eiv-harness veranstaltung`. Ask before the
> first live completion, not after.

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

## S12 · "Originalstempel" — **CLOSED 11.08: an emailed PDF is acceptable**

> **Answered by the client on 11.08.2026: yes, an emailed PDF satisfies the
> requirement.**
>
> So the certificate path as built is the shipping one: a PDF the physician
> downloads from the portal, or receives by email through
> `CertificateDeliveryScheduler`, carrying the course's stamp and the
> scientific lead's signature as images. No physical stamp, no postal path, no
> change to `certificate.service.ts`.
>
> What this does **not** relax: `missingCertificateFields` still refuses to
> issue a certificate whose required fields are absent, and the stamp and
> signature seeded today are 1×1 placeholder PNGs. The real assets still have
> to replace them before anything ships — that is S6's residue, not S12's.

## S12 (original analysis) · "Originalstempel" may invalidate an emailed certificate

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

## S2 · The token was there all along — **CLOSED 19.08. The 28.07 answer was wrong, and it was ours**

> **19.08 — the client supplied the theme, and it changes the answer (P98-01).**
>
> This entry has said since 28.07 that MEDICE persists no token, so nothing
> could be read and the integration was blocked on their developer. **That was
> a reading error on our side.** The 28.07 analysis read
> `keycloakwordpressplugin` and concluded about the system; the login lives in
> the **theme**:
>
> ```php
> // theme/functions/login-class.php
> $tokenResponse = Keycloak::getAccessTokenByUnamePass($username, $password);
> $data          = array_merge($tokenResponse['data'], ['userinfo' => …]);
> self::storeIntoSession($data);          // → $_SESSION['LOGIN_SESSION']
> ```
>
> `$tokenResponse['data']` is the whole token response, so the session holds
> `access_token`, `refresh_token`, `expires_in` and `refresh_expires_in`, and
> the grant's scope includes **`offline_access`**.
>
> **Consequences:**
>
> - **No MEDICE code change is required.** Plugin 1.1.0 reads the session
>   directly, at a configurable key defaulting to `LOGIN_SESSION`.
> - **The lifespan concern below is softened, not removed.** There is a refresh
>   token and it is offline, so a 25-minute module no longer depends on a long
>   access-token lifespan. 30 minutes remains the comfortable setting.
> - **The real blocker was different and is fixed.** MEDICE create no WordPress
>   user at all — no `wp_signon`, no `wp_set_auth_cookie` — so
>   `is_user_logged_in()` was false for every physician, and our plugin gated
>   three separate things on it. See P98.
>
> **What replaces this as the open question:** the project's `keycloak_issuer`
> and `keycloak_audience` must match the claims in MEDICE's token, or the API
> refuses it as a 401 that looks like "not signed in". The plugin's _Verbindung
> prüfen_ now prints both values from the live token so they can be copied.
> Owner: **DigitalSpital**, one console setting.

<details>
<summary>The superseded 28.07 analysis, kept because the mistake is instructive</summary>

**The WordPress plugin does not persist a token — ANSWERED 28.07, and the answer is the bad one**

> **19.08 — now observed in production, not predicted (P97-01).** The client
> signed into the MEDICE staging WordPress as a Keycloak user, with the plugin
> installed, the origin allowed and the bundle loading. The widget was still
> signed out, and the chain is exactly the one this entry predicted three weeks
> ago:
>
> ```
> GET /wp-json/ds-lms/v1/token            → 404  (route ran; nothing held)
> GET  api…/courses/adhs-akademie-adult   → 401  (no bearer to send)
> PUT  api…/courses/…/enrolment           → 401
> ```
>
> **Nothing on our side is broken and nothing on our side can fix it.** The
> plugin, the widget, the API and the CORS policy all behave exactly as
> specified. `keycloakwordpressplugin` obtains an access token by password grant,
> uses it for a userinfo lookup, and drops it — so `DS_LMS_Token_Source` has
> nothing to read, by construction.
>
> **This is now on the critical path to launch, not a risk.** The unblocking
> change is one `add_filter( 'ds_lms_access_token', … )` in whatever performs the
> login, plus persisting the token at login if it is not already held. Owner:
> **MEDICE**. Until it lands, no physician can start a Fortbildung from
> WordPress.
>
> One thing we did get wrong and have fixed: both "the endpoint is switched off"
> and "the endpoint answered and there is no token" produced a bare `404`, so
> toggling the setting changed nothing an observer could see and the report was
> misread for a day. Plugin 1.0.1 names the reason and the settings screen tells
> the three states apart.

> **12.08 — measured rather than argued (P62-04).** The dev realm was set to a
> 60-second access-token lifespan and a module watched across the expiry.
>
> - **Playback continues.** The video carries no credential.
> - **Progress stops being credited, completely.** Every flush from expiry
>   onwards answers `401`, about twice per fifteen-second interval, for as long
>   as the learner keeps watching. `content_progress.watched_percent` stays
>   where it was.
> - **The API is correct at every step.** `AUTH_CLOCK_TOLERANCE_SEC = 5`, so a
>   token is honoured five seconds past `exp` and refused after.
> - **The widget was not.** It said "Ihr Fortschritt wird automatisch
>   gespeichert" throughout. That is **P62-05**, now fixed: the learner is told
>   the session ended and that a reload restores it.
>
> **The minimum lifespan we can tolerate: 30 minutes**, because the MEDICE
> modules run to about 25 and a lapse mid-module costs the unflushed intervals.
> 60 minutes is comfortable.
>
> **What we need from MEDICE, in order of preference:** a refresh token the
> plugin can hand the widget (the SDK's `onUnauthorized` hook already exists
> and is used exactly once per 401); or the realm's access-token lifespan
> raised to 30 minutes for this client; or an explicit acceptance that
> physicians will reload periodically and lose up to fifteen seconds of watch
> time each time.
>
> P62-05 makes the loss visible. It does not prevent it, and no widget change
> can — this is the one thing on the list that is genuinely MEDICE's to answer.

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

</details>

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

> **25.08 — the request is drafted and ready to send:**
> `docs/correspondence/S17-keycloak-audience-mapper.md`, in German for the
> Keycloak administrator with a plain-language summary for the PM. It carries
> the click-path, the verification step (`aud` on a fresh token), and the
> instruction to send S18 with it since the same administrator does both.
>
> **Still true, and still the largest non-EIV blocker.** Verified again on 25.08
> against the code: nothing in `apps/api/src/auth/` accepts `azp`, and no
> per-project fallback column exists. The strict check is exactly as described
> below.
>
> **Why nobody has noticed it in testing** (§9.13): every suite runs on the `ds`
> tenant with local participants and never touches MEDICE's Keycloak. This
> defect is structurally invisible to all of them. The check that closes S17 is
> one real MEDICE account signing in at `/medice` and opening one course — and
> it cannot be run until the mapper exists.

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

## S21 · The layout says the EFN is **18 digits**; the platform validates **15** — **answered: 15, the layout is wrong**

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

### Answered, 08.08, from the Landesärztekammern's own published description

The EFN is **15 digits**, nationally uniform, and structured:

| Position | Meaning                                            |
| -------- | -------------------------------------------------- |
| 1–2      | Berufsgruppe — `80` is Arzt                        |
| 3–5      | Länderkennung per ISO 3166 — `276` is Germany      |
| 6–9      | the recognising Landesärztekammer                  |
| 10–14    | an individual running number carrying no coding    |
| 15       | a **Prüfziffer** derived from the preceding digits |

So `isValidEfn` is correct as written and **page 13's caption is wrong**: it must
read _Die 15-stellige EFN_, and its eighteen-character placeholder must shrink,
before it goes in front of a physician. That is a copy fix for MEDICE's designer,
not a platform change. See `docs/requirements/medice-adhs.md` §EFN.

**What is deliberately still not implemented: the check digit.** Every public
description of the EFN stops at "eine Prüfziffer, die sich aus den vorangegangenen
Ziffern durch Anwendung der sog. …" and does not name the algorithm. Guessing it
would be the worst possible trade: a wrong Modulo would refuse a _valid_ EFN at the
last step of a completed Fortbildung, which is precisely the failure `CLAUDE.md` §7
exists to prevent, and it would fail silently for only some physicians. Validating
15 digits and letting the Ärztekammer reject the rest is the correct behaviour until
somebody supplies the algorithm in writing.

Worth asking for anyway, because the payoff is real: a local check digit turns a
"validation" failure discovered _after_ the certificate was shown into a typo caught
in the form.

### Corroborated 25.08 — four Kammern, a national identifier namespace, and a route to the Prüfziffer

**15 is now confirmed well past the point of doubt.** The EFN is documented as
15-stellig, personengebunden, lebenslang gültig and bundesweit einheitlich
aufgebaut by the Ärztekammer Hamburg, DocCheck Flexikon and Springer Medizin;
Sachsen-Anhalt names it as "15 Ziffern auf den Fortbildungsbarcodes oder dem
Fortbildungsausweis".

There is also a **HL7 FHIR identifier system** for it —
`http://fhir.de/sid/bundesaerztekammer/efn` (`ig.fhir.de/basisprofile-de`). That
is worth recording beyond "the length is right": it establishes the EFN as a
**standardised national identifier with its own namespace**, not a MEDICE or
ÄKWL convention. Noted in ADR-0004, which is where our handling of it is
justified.

So `isValidEfn` is right, and **page 13's caption is a designer fix with a
citation attached** — not an open question, and not something to wait on. It
must read _Die 15-stellige EFN_, and the eighteen-character placeholder must
shrink, before it goes in front of a physician.

**What remains open here is only the Prüfziffer**, and S23 above now offers a
route to it that did not exist on 08.08: the Ärztekammer Hamburg documents that
_"Die VNR ist analog der Elektronischen Fortbildungsnummer (EFN) aufgebaut"_, and
the one real VNR we hold satisfies Luhn while the two other simple mod-10
schemes do not. Confirm Luhn on the VNR and it becomes evidence for the EFN.

**It does not become proof.** "Analog aufgebaut" is a sentence in an FAQ, not an
algorithm, and one valid specimen of each number is still a sample of one. The
rule stands: two or three known-valid EFNs, checked, before `isValidEfn` gains a
check digit. The cost of being wrong is unchanged — a valid EFN refused at the
last step of a completed Fortbildung, silently, for only some physicians.

---

## S24 · The EIV Veranstalter API — **CLOSED 09.08, and five of our six assumptions were wrong**

- **Owner:** MEDICE · **Closed:** 09.08 by the client supplying the Swagger

The specification arrived: `EIV FOBI - Veranstalter`, OAS 3, version
`1.0 20260714-01`. The client, the mock, the harness and the retry policy have
all been reconciled with it in **P31-01**. What it changed:

| We assumed                              | It is                                             |
| --------------------------------------- | ------------------------------------------------- |
| `POST /auth/login` with a JSON body     | `GET /fobi/veranstalter-auth/jwt` with HTTP Basic |
| the token field is `token`              | `jwt`                                             |
| the push body carries `vnr` and `rolle` | neither — the VNR is carried by the token         |
| `422` is the business rejection         | `406` is; `422` is a _format_ error               |
| success returns `{ referenz, status }`  | no reference and no status word exist             |
| a repeat answers `BEREITS_GEMELDET`     | a repeat is indistinguishable from a first write  |

Only "the JWT is a Bearer token" survived.

**Three things the specification gave us that we did not know to ask for:**

1. **A withdrawal mechanism.** Re-send with both flags false and
   `punkte_referent: 0`; the record survives and stays auditable. `@ds/domain`
   has computed a 7-day correction window since week 1 and nothing could
   perform a correction. Now `retractTeilnahme` can.
2. **`GET /fobi/veranstalter/veranstaltung`** — the accredited period and the
   point values, per VNR. This is what turns S11 and S25 from letters into a
   command.
3. **`GET /fobi/veranstalter/gemeldetepunkte`** — what the Ärztekammer holds, as
   opposed to what we believe we sent. Our append-only log cannot detect a
   disagreement between the two; this can.

**And one new hazard, which is the reason S11 now matters more, not less:** a
`teilnahmedatum` outside the accredited period is refused **406**. For an
on-demand Fortbildung accredited _am 13.10.2025_ and valid until 12.10.2026,
that is the difference between every completion being reported and none of them
being reported. It is reproducible locally now —
`start:mock -- --beginn … --ende …` — but the real answer is the one the test
system gives.

**The lesson, recorded rather than absorbed.** The mock was written from the
same guesses as the client, so CI asserted the guesses. Eighteen tests were
green against an interface that does not exist. A contract test is only worth
what its fixture is worth, and ours was worth our own imagination.

---

## S25 · Which point flags may a completion claim?

- **Owner:** MEDICE / ÄKWL · **Blocks:** the first live submission · **Raised:** 09.08 by P31-01

`push_teilnahme` carries `punkte_basis_flag` and `punkte_lernerfolg_flag`
separately, and `GET /veranstaltung` declares a `punkte_basis` and a
`punkte_lernerfolg` value for the event. The Anerkennungsbescheid awards this
Fortbildung **4 Punkte, Kategorie D**, with 70 % on the Lernerfolgskontrolle as
a _condition_ of awarding them — which does not obviously map onto two flags.

Our completion already requires passing the assessment, so both kinds of credit
have plainly been earned. What is not confirmed is whether an event accredited
for zero Lernerfolg points refuses the flag.

**The platform sends both `true` by default, deliberately**, and the reasoning
is in `reporter.ts`:

- Claiming credit the event does not carry → 406 or 422. Loud, logged, in front
  of an operator inside the 8-day window.
- Not claiming credit that was earned → **accepted silently**, and the physician
  is short of points with nothing anywhere saying so until they check their
  Kammer account months later.

A wrong answer that fails is recoverable; a wrong answer that succeeds is not.

**Update 25.08 — this needs no email and no test credentials. The answer is
already on a screen nobody has opened.**

Asked "what is the email for S25", and the honest answer is that there isn't
one. `GET /fobi/veranstalter/veranstaltung` returns `punkte_basis` and
`punkte_lernerfolg` for the VNR, the client has parsed both since P31-01
(`client.ts`, `readNumber(body, "punkte_basis")`), the contract carries them as
`attendancePoints` / `assessmentPoints` on `EivEvent`, and
`apps/admin/src/components/EivCheck.tsx` renders both — with a warning on
exactly this trap when `assessmentPoints === 0` and the course claims
Lernerfolg.

It is the **same call** whose response produced the S11 evidence above. The
accredited period was read out of it and written down; the two point values came
back in the same body and were not.

So: **Verwaltung → the ADHS course → EIV-Abgleich, and read two numbers.** No
test system needed — this is a read against the register, not a submission, and
it is the read that already ran successfully on 24.08.

What each outcome means:

| `assessmentPoints` | What it means                                                                                                     |
| ------------------ | ----------------------------------------------------------------------------------------------------------------- |
| **4** (or any > 0) | the event carries Lernerfolg credit; sending both flags true is right, S25 closes                                 |
| **0**              | the 4 Punkte are all `punkte_basis`; sending `punkte_lernerfolg_flag` risks a 406, and the screen already says so |

Only if it is `0` is there a question left for ÄKWL — and it is then a precise
one worth one line, not a general enquiry: _the Bescheid awards 4 Punkte
Kategorie D with 70 % on the Lernerfolgskontrolle as a condition; the register
carries those 4 as Basispunkte with 0 Lernerfolgspunkte — should a Meldung set
`punkte_lernerfolg_flag`?_

The harness reaches the same data from a terminal, against the **test** system
once S27 lands:

```bash
EIV_BASE_URL=https://backend-test.eiv-fobi.de EIV_ALLOW_LIVE=yes \
  pnpm --filter @ds/eiv-harness veranstaltung
```

---

## S26 · The production API base URL is not published

- **Owner:** MEDICE · **Blocks:** go-live, not development · **Raised:** 09.08

The Swagger names exactly one server: `https://backend-test.eiv-fobi.de`, the
test environment. Three other hosts are in circulation and none is confirmed as
the production **API** base:

| Host                             | What it is                                          |
| -------------------------------- | --------------------------------------------------- |
| `punktemeldung.eiv-fobi.de`      | the live **web application**, named by the Bescheid |
| `punktemeldung-test.eiv-fobi.de` | the test web application                            |
| `punkte.eiv-fobi.de`             | named for organiser submissions from 01.01.2026     |

`backend-test` → `backend`? Plausible, and plausible is not good enough for the
one URL where being wrong means a physician's points go nowhere. It is a single
environment variable, so it blocks nothing before launch — but it must be
confirmed with EIV support, not inferred.

---

## S27 · Test-system credentials, so the client can be proven before it is trusted

- **Owner:** MEDICE · **Blocks:** the last unverified half of P7 · **Raised:** 09.08

The specification is explicit: _"Bitte nutzen Sie für die Entwicklung
ausschließlich das Test-System. Zugangsdaten und Test-Veranstaltungen erhalten
Sie über den Support."_ Test and production are completely separate, so a test
run cannot touch real data — which is exactly why it is the right place to
prove this.

We now match the published contract field for field, but **nothing has spoken to
a real EIV server**. The remaining unknowns are the ones only a real response
answers: whether Basic on a GET behaves as documented behind their gateway,
what the 4xx bodies actually look like ("historisch gewachsen", by their own
admission), and whether `teilnahmedatum` is validated as we expect.

The harness is ready for it — `authenticate`, `veranstaltung`, `gemeldetepunkte`
and `push` each print the verbatim exchange with the password redacted and the
EFN masked to four digits, so the output can be pasted into a ticket.

**Do not use the live VNR for this.** Which is also S10: the live VNR password
has now been shared over chat twice. It should be rotated before launch
regardless of what else happens.

### Update 09.08 — an environment now points at the test system

A deployment configuration has been set to:

```
EIV_BASE_URL=https://backend-test.eiv-fobi.de
EIV_ALLOW_LIVE=yes
EIV_WORKER_ENABLED=yes
```

Which is the right host and the right shape. **The open question is whose
credentials are behind it**, and it is the whole of S27:

- **A test VNR and password issued by EIV support** — then this works, and the
  first real answers to S11 and S25 are one `veranstaltung` call away.
- **The live VNR from the Anerkennungsbescheid** — then it does not
  authenticate, because the two systems share no accounts, and every completion
  is abandoned as a permanent business failure inside the 8-day window.

The platform cannot tell the difference and neither can this document. **Ask
EIV support for Zugangsdaten und Test-Veranstaltungen before the worker is
allowed to run against that host**, and put the VNR and its password on the
course in the admin console — never in `config.env`, which is not read and which
`deploy.sh` now refuses.

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

## S23 · Every course authored in the console reported **nothing** to the EIV — **fixed 08.08, but it needs an operational answer**

- **Owner:** DigitalSpital (fixed) → MEDICE (the operational half) · **Raised:** 08.08 by the journey suite (P28-03)

`courses.vnr` is the number every Punktemeldung is credited against. It was
readable through `GET /admin/courses/{slug}` and **writable nowhere**. The
console could store the VNR _password_ — encrypted at rest, write-only, done
carefully — for a number no operator had any way to enter.

Nothing failed loudly. `queueSubmission` skips a course with no VNR, and that
skip is correct: a missing VNR is an authoring gap, and failing a physician's
completion over it would be the wrong trade. So a learner passed, saw a green
Zertifizierung, and **no CME point reached their Kammer**. The certificate PDF
refused with a 409 for the same reason, since the Bescheid requires the VNR as
both barcodes.

The code is fixed (P28-03): `vnr` is writable, surfaced in the console above the
password field, and warned about while empty. Two things are still not ours to
decide.

**1. Was anything already completed against a VNR-less course?** Not on any
environment we control — the fix predates any real learner. But if a course was
authored in the console on a customer's own installation and completions exist
against it, those points were never reported and the 8-day window in the
Bescheid may already have closed. The remedy is the paper fallback ÄKWL
describes in §2 of the Anerkennungsbescheid: an Original-Anwesenheitsliste with
EFNs, in writing, with a justification. It is not something the platform can do
by itself.

The query that answers it, per installation:

```sql
SELECT c.slug, count(*) AS completions
FROM enrolments e JOIN courses c ON c.id = e.course_id
WHERE e.completed_at IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM eiv_submissions s WHERE s.enrolment_id = e.id)
GROUP BY c.slug;
```

**2. What format does EIV-FOBI accept for a VNR?** The field is length-bounded
and nothing more. The one specimen we have is 19 digits; a regex built from a
sample of one refuses a legitimate number from another Ärztekammer at authoring
time, and `CLAUDE.md` §7 is explicit about inventing rules of that kind. A
format confirmed against the real interface would let the console reject a
typo where the operator can see it, instead of at submission time.

**Documented, 25.08 — the Ärztekammer Hamburg says the VNR carries a check
digit, in terms.** Their FAQ:

> _"Die VNR ist 19-stellig … **Die VNR ist analog der Elektronischen
> Fortbildungsnummer (EFN) aufgebaut**"_
> — `aerztekammer-hamburg.org/…/FAQ_VNR.pdf`

S21 below establishes that the EFN's 15th digit **is** a Prüfziffer derived from
the preceding digits. So a check digit on the VNR is now **specified**, not
inferred from a form refusing our fixture. That moves this from "something in
their JavaScript rejects it" to "the number is defined to have one, and their
form enforces it."

**And the field narrows to one candidate.** Of the three simple mod-10 schemes,
only Luhn is consistent with the one real specimen:

| Scheme                       | Predicts for `276055202591930001?` | Actual |
| ---------------------------- | ---------------------------------- | ------ |
| Luhn (mod 10)                | **8**                              | 8 ✓    |
| plain digit-sum mod 10       | 3                                  | 8 ✗    |
| ten's complement of that sum | 3                                  | 8 ✗    |

So the experiment below has exactly **one** hypothesis to kill rather than
several — which is what makes it worth running rather than guessing.

**The bigger prize, if it holds.** "Analog der EFN aufgebaut" cuts both ways: a
confirmed Luhn on the VNR is evidence for Luhn on the **EFN**, which is S21's
deliberately-unimplemented half and the more valuable of the two. An EFN check
digit turns a rejection discovered _after_ a physician has completed a
Fortbildung into a typo caught in the form. Test a known-valid EFN against Luhn
the moment one is available — and note that a _single_ valid EFN is the same
sample-of-one problem again, so this needs two or three before it is
implementable.

**A warning for the field one along: do not validate the VNR password's
length.** It is not the same at every Kammer — Baden-Württemberg documents an
**8-stellige** TAN, the Pfalz a **4-stellige** one. A length rule derived from
whichever we looked at first would refuse a legitimate credential at the moment
an operator configures a course. The console field carries only a generous
`maxLength` bound and a comment saying why, so nobody "tightens" it later.

**The original finding, 25.08 — the answer is obtainable without asking
anybody.** The client pasted the e2e fixture's VNR `2760000000000000000` into
EIV's own web application at `punktemeldung.eiv-fobi.de` and it was refused
**before submit**: red outline, error icon, "Veranstaltung hinzufügen" greyed
out. Nineteen digits, all numeric, correct `2760` Kammer prefix — so a
length-and-digits rule would have accepted it. Something in their page computes
a **check digit**, which means the rule is in JavaScript a browser has already
downloaded, and is readable.

A Luhn (mod-10) check fits both specimens:

| VNR                                  | Luhn sum mod 10 | implied last digit | actual |
| ------------------------------------ | --------------- | ------------------ | ------ |
| `2760552025919300018` (the Bescheid) | **0** — valid   | 8                  | 8      |
| `2760000000000000000` (the fixture)  | 3 — invalid     | 7                  | 0      |

**This is not enough to implement, and it has deliberately not been
implemented.** One real specimen passing Luhn is a one-in-ten coincidence, and
S23 above is the standing reason: the same trade was refused for the EFN's
Prüfziffer, where a wrong Modulo would reject a _valid_ number at the last step
of a completed Fortbildung. A VNR check digit guessed wrong stops MEDICE saving
their own accredited course.

**The experiment that settles it — thirty seconds, and anybody with the EIV
login can run it.** In that same form, enter each of these and note whether the
red outline appears:

| VNR                   | Luhn    | If the field accepts it                                   |
| --------------------- | ------- | --------------------------------------------------------- |
| `2760000000000000007` | valid   | the rule **is** a mod-10 check digit — implement it       |
| `2760000000000000000` | invalid | (the known refusal, as a control)                         |
| `2760000000000000001` | invalid | if this is _also_ accepted, the rule is not a check digit |

If the first is accepted and the third refused, we have the algorithm from
observation rather than from guessing, and the console can catch a mistyped VNR
in the form instead of eight days later as a `failed_permanent` Punktemeldung.
Reading the page's own JavaScript would confirm it outright.

**Why it matters more than it looks.** Nothing in the platform validates the
VNR at all today — not the console field, not the authoring DTO, not the
schema. An operator can mistype it, the console answers "Gespeichert.", the
course publishes, and the first evidence is a refused submission with the
statutory 8-day clock already running. That is §9.4: EIV's own form tells you at
the moment you type, and ours does not.

**Worth naming as a class**, because it is the third of its kind found in this
project: a control that is present, looks implemented, and does nothing. The
others were the `Mehr lesen…` toggle (P27-01) and the participant sign-in that
authenticated and then refused (P28-02). All three were invisible to a test that
seeded around the seam and obvious to one that walked through it.

---

## S28 · A physician who finishes the course but not the paperwork before the window closes loses the point

- **Owner:** ÄKWL (with MEDICE) · **Blocks:** nothing today · **Raised:** 11.08

Two decisions taken on 11.08 combine into a case nobody has ruled on.

1. **Course completion no longer waits for the paperwork** (P51-01). A
   physician has finished the Fortbildung when they have watched the required
   share of the videos and passed the Lernerfolgskontrolle. The
   Evaluationsbogen and the EFN may follow later — days later — and only then
   is the point claimed and the Punktemeldung filed.

2. **An expired course stops accepting anything** (P51-02). Past `valid_to`,
   the enrolment and everything in it is kept and readable, but no further
   playback, quiz attempt, evaluation or completion is accepted.

The gap between them: somebody finishes the course on the 10th, the
accreditation lapses on the 12th, they come back on the 15th to fill in the
evaluation — and the platform refuses. **They did the work inside the window
and cannot be credited for it.** Right now there is no way for an operator to
grant it either; it would need a support intervention that does not exist.

This is implemented as instructed and flagged rather than softened, because
both readings have a real cost and neither is ours to pick:

| If the Kammer says                                              | Then                                                                                                |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Participation is what counts, and it happened inside the window | Certification should stay open after `valid_to` for anyone whose `course_completed_at` is inside it |
| The accreditation covers the whole act, paperwork included      | Current behaviour is right, and the learner needs warning **before** the window closes, not after   |

**The question for ÄKWL:** for an on-demand Fortbildung, is the participation
dated by when the physician completed the course content, or by when the
Teilnahmebescheinigung is issued? This is the same underlying question as Q1
(_what is `Veranstaltungsende`?_) and could be asked in the same message.

**If the answer is the first row**, the change is small and localised: the
`requireCourseStillOffered` call in `CompletionService.complete` becomes
conditional on `course_completed_at` falling inside the window. The date is
recorded for exactly this reason — see migration `0037`.

**Either way, one thing should be built regardless:** a physician who has
finished the course and not the paperwork should be told the window is closing
while they can still act. Today they find out by being refused.

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

---

## S24 · What is `fortbildungsnummer`? — **raised 12.08 (P62-02)**

**Owner: MEDICE / ÄKWL.**

`courses.fortbildungsnummer` has existed since `0001_init`, is editable in the
admin console, and renders exactly one line on the learner's Zertifizierung tab.

**Nothing else reads it.** Not the Teilnahmebescheinigung, which carries the
**VNR** as text and as two barcodes; not the Punktemeldung, which sends the VNR
and the EFN. The Anerkennungsbescheid (ÄKWL, 18.06.2026) names a VNR and no
second number.

So one of two things is true, and they have different consequences:

1. **It is another name for the VNR**, drawn separately on the layout. Then the
   column should go and the tab should render `vnr` — otherwise an operator can
   enter two different numbers for one course and the platform will show one
   and report the other.
2. **It is a distinct Kammer reference** nobody has described to us. Then it
   needs a definition, and possibly a place on the certificate.

### Why it survived nine QA sections

It is NULL on every seeded course, and the tab **omits the line entirely** when
it is null. An absent value renders as an absence rather than an error, so there
was never anything to notice. It is excluded from P62-02's publish precondition
for exactly that reason: requiring a field whose meaning is unknown would be
inventing a rule (CLAUDE.md §7).

### What we need

One sentence from MEDICE or the ÄKWL: _"Fortbildungsnummer is / is not the
VNR."_ Everything else follows.

### 25.08 — reading 1 is very probably right, so ask it as a confirmation

Several Kammern call the VNR exactly that, in those words. Baden-Württemberg:
_"die 19-stellige **Nummer der Fortbildung** (VNR)"_; the Ärztekammer Pfalz uses
the identical phrasing in its Rundschreiben an Fortbildungsveranstalter. And
nothing in any published source describes a **second** Kammer reference for an
event — EIV's own Veranstalter page describes one number per anerkannte
Maßnahme, plus its password.

So "Fortbildungsnummer" reads as colloquial Kammer usage for the VNR, and
reading 1 is the likely answer. That does not change what we need — a column is
still not deleted on an inference — but it changes the **shape** of the ask, and
a confirmation gets answered faster than an open question:

> Ist mit "Fortbildungsnummer" auf der Zertifizierungs-Seite die VNR gemeint,
> oder gibt es dazu eine weitere Nummer der Ärztekammer?

**If confirmed:** drop `courses.fortbildungsnummer`, render `vnr` on the
Zertifizierung tab. Until then the current behaviour is the safe one — the line
is omitted when the column is NULL, so nothing wrong is shown to a physician,
and the risk it guards against (an operator entering two different numbers, the
platform showing one and reporting the other) only materialises if somebody
fills the field in.

**Worth saying to the operator in the meantime**, since the field is editable
and its meaning is unresolved: it is a candidate for a hint on the course
settings screen telling an author to leave it empty pending that answer. Not
built — flagged.

---

## S29 · We may be integrated against an interface that is being switched off

- **Owner:** EIV / Bundesärztekammer (via MEDICE) · **Blocks:** the launch ·
  **Raised:** 24.08.2026, by the client, from the official sources

### What was found

The Bundesärztekammer now runs the Punktemeldung on a **new platform with its
own REST API**, documented at `veranstalter-swagger-ui.eiv-fobi.de`. Its own
pages state that support for the old Java client ended **31.12.2024**, and that
for the old XML interface _"Eine Abschaltung der Schnittstelle steht an."_
Ärztekammer Bremen goes further: from **01.01.2026** organisers may report only
via `punkte.eiv-fobi.de` / `punktemeldung.eiv-fobi.de`, and the old interface is
then switched off.

### Why this is a show-stopper and not a nice-to-know

`packages/eiv-client` speaks the **old Veranstalter interface**:
`POST /fobi/veranstalter/push_teilnahme` against `eiv-fobi.de`, VNR and password
exchanged for a JWT. It works — the connection check on 24.08 proves it end to
end against the live register — but a Bremen-level reading says it should
already be off.

So the platform is about to put a **statutory** reporting path onto an interface
with an announced shutdown, with no migration ticket and no knowledge of whether
the new API is contract-compatible. The failure mode is the worst available: it
works on launch day and stops working later, quietly, with physicians' points
sitting in the queue behind it.

### What has to be established

1. Which endpoint should a **new** Veranstalter system integrate against as of
   06.09.2026?
2. Until when is the current interface available?
3. Is the new API contract-compatible with `push_teilnahme`, or a different
   shape?

(1) and (2) are one extra sentence in the EIV support mail S27 already needs —
and asking as somebody **migrating** rather than somebody **stuck** makes the
test-system request land better.

(3) was expected to need nobody — **it does.** Checked from an unrestricted
connection on 24.08: `veranstalter-swagger-ui.eiv-fobi.de` answers, and the
specification is **not served from it**. Every springdoc and swagger-ui-dist
convention returns nginx's own 404:

| Path                                                           |                                 |
| -------------------------------------------------------------- | ------------------------------- |
| `/`, `/index.html`                                             | 200, empty body — the JS shell  |
| `/v3/api-docs`, `/v2/api-docs`                                 | 404 (nginx, not an application) |
| `/swagger-config`, `/v3/api-docs/swagger-config`               | 404                             |
| `/swagger-ui/index.html`, `/swagger-ui/swagger-ui.html`        | 404                             |
| `/swagger-initializer.js`, `/openapi.json`, `/api/v3/api-docs` | 404                             |
| `veranstalter-api.eiv-fobi.de`                                 | does not resolve                |

That reads as a **static Swagger UI bundle served by nginx against a spec URL on
another host** — plausibly one requiring Veranstalter credentials, plausibly not
public at all. Two consequences:

- The spec URL is in the page's JavaScript. Somebody with a real browser can
  read it from the network tab — and what to look for is the request the page
  fires _after_ load, to a host that is probably not this one. **The URL is the
  deliverable, not only the JSON.**
- Failing that, this is a second thing to ask EIV support for, and it makes the
  request concrete: _your Veranstalter pages point integrators at this URL, the
  UI loads, and the specification is not retrievable — please send the OpenAPI
  document and the API base URL._ That is answerable in one reply, and it pairs
  with S27 because both are "we are integrating, give us what integrators get".

**So S29 is blocked on the same mail as S27**, not on somebody finding the right
URL. That is worth knowing: it moves the migration from an unknown to a waiting
item with a named owner.

**A faster path than a support ticket.** The Bayerische Landesärztekammer
publish a support line for exactly these questions — **089 4147-123** — and
their own migration notice records that the FobiApp has been unsupported since
March 2025, replaced by FobiApp-Web and the new Punktemeldung. A phone call is
likely to produce the spec URL before a ticket does.

### Not the same question as the endpoint tier

P104-01 taught the platform to tell EIV's **test** system from the **live**
register, and P107-01 put that on screen. Both of those hosts are the **old**
interface. A correct tier decision about a switched-off interface is still a
switched-off interface.

---

## S5 · Certificate-after-EIV — **CLOSED 24.08: issue on completion**

The client's decision, and the reasoning is worth keeping because it is the one
that makes a launch under an unresolved S11 survivable:

> Issue the certificate on completion, do not wait for EIV. The two facts are
> independent — the physician completed the Fortbildung, and the points were
> reported. Coupling them means an EIV outage withholds a document the learner
> has earned, and S11 proves the EIV can refuse for reasons that have nothing to
> do with the learner. The reporting status belongs in the portal and the
> console, not on the PDF.

**No code change: the platform already does this.** `completion.service.ts`
issues the certificate the moment it is earned (P59-01) and queues the
Punktemeldung alongside it, not before — a failure in either does not fail the
other. P51-01 had already split course completion from CME certification.

The consequence the decision buys: **a launch with S11 still open degrades
gracefully.** Physicians receive valid Teilnahmebescheinigungen carrying the VNR
and the accredited points, and can self-report — the pre-EIV process the Kammern
still accept — while the register question is settled.

---

## S7 · 80 % or 100 % — **REOPENED and settled 24.08: 100**

Closed on 20.08 as "already per course; a field, not a constant", which answered
the mechanism and not the value. The seed shipped 100, then 90, and 90 is the
worst of the three: it satisfies neither source and is indefensible if the ÄKWL
asks why.

**Seeded at 100**, on the client's call: the layout is a design artifact and
MEDICE-292 is the compliance record, so where they disagree the compliance
record wins. The layout's 80 is overridden deliberately, and it stays a per
course field so another customer can differ.

---

## P112-01 · CI's seed step failed, and the guard that failed it was right

Not a show-stopper — recorded here because the _shape_ is one this file keeps
teaching, and it caught me from the other side.

The 24.08 CI run failed on **Integration tests (real Postgres)**. All 544 tests
passed; the job failed at the next step, `pnpm db:seed`:

```
Error: Project "medice-adhs" is bound to a Keycloak on loopback:
  http://127.0.0.1:1/realms/unused
```

That is the guard added after the client's 401 — `bindingProblem` refuses a
project holding a loopback issuer **that nobody asked for**, which is the
production fault where every physician arriving from the customer's site is
refused with a token that is otherwise valid.

**It was telling the truth.** The integration suites run first, against the same
database, and set `KEYCLOAK_ISSUER=http://127.0.0.1:1/realms/unused` as a
deliberately unroutable sentinel. The seed step then declared no issuer of its
own — so "nobody asked for loopback, yet loopback is stored" was literally the
state of the database.

**The fix is CI's, not the guard's.** The seed step now states the same
sentinel. CI genuinely _means_ loopback: it has no Keycloak and nobody will ever
sign in there. Weakening the guard, or giving it an escape hatch, would have
been the §9.1 trap — an escape hatch CI sets is an escape hatch production can
set.

Verified by exercising the pure function directly rather than by re-running a
database:

| `issuerRequested`                               | result                |
| ----------------------------------------------- | --------------------- |
| `false` (CI before)                             | the exact error above |
| `true` (CI after)                               | no problem            |
| `false`, loopback stored (the production fault) | still fires           |

`keycloak-binding.test.ts` covers all thirteen branches, so the seed step was
never the thing testing this — it had simply become an accidental second
assertion, and a step that is not about Keycloak should not be one.

---

## S30 · May a Punktemeldung be re-filed under a corrected EFN? — **raised 26.08 (P118)**

**Owner: DigitalSpital → EIV-FOBI / ÄKWL.** Blocks the second half of P118.

### The situation

A physician supplies an EFN, completes the course, the Punktemeldung is filed —
and then the EFN turns out to be wrong. A typo in fifteen digits is not exotic;
it is the failure ADR-0004 calls the worst available, because the points are
credited to somebody and everything looks successful.

The platform can correct the EFN (the physician does it themselves) and can
re-file (`POST /learners/{id}/eiv`). The question is what re-filing **means**
once the first one was accepted.

### The question

> Wenn eine Teilnahme mit einer falschen EFN gemeldet wurde und die richtige EFN
> erst danach bekannt wird — ist die korrigierte Meldung innerhalb des
> 7-Tage-Korrekturfensters als Korrektur derselben Teilnahme zu senden, oder muss
> die erste Meldung zunächst storniert (`withdraw`) und die Teilnahme anschließend
> unter der richtigen EFN neu gemeldet werden?
>
> Und: Was geschieht mit den Punkten, die der zuerst gemeldeten EFN bereits
> gutgeschrieben wurden — werden diese durch die Korrektur automatisch entzogen,
> oder ist dafür ein gesonderter Vorgang erforderlich?

### Why we cannot answer it ourselves

Because the EFN is not a field on the record — it **is** the record's subject. A
name correction changes how one person is described; an EFN correction changes
_which person_ was credited. Nothing in the platform can take points back from
the first EFN, and guessing that a correction does so implicitly is exactly the
invented rule §7 refuses.

### What the platform does in the meantime

`requeue` refuses when the EFN would change on a submission that was accepted,
and says so. An operator gets a refusal naming the next step rather than a
second filing nobody asked for. The never-accepted case — `queued`, `held`,
`failed_*`, `window_closed` — is unambiguous and is fixed in P118: nothing was
reported, so nothing can disagree, and the requeue picks up the corrected EFN.
