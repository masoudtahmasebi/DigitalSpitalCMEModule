# MEDICE ADHS — confirmed requirements

Source: client-supplied specifications and the approved layout screens, received
27.07.2026. This is the detailed requirement record behind `docs/roadmap.md`.
Where it contradicts the roadmap, §6 records the conflict rather than resolving
it unilaterally.

---

## 1. EIV-FOBI transmission

### Data required

| Field        | Source         | Notes                                                                             |
| ------------ | -------------- | --------------------------------------------------------------------------------- |
| `efn`        | Learner        | 15-digit Einheitliche Fortbildungsnummer, unique per physician, **never changes** |
| `rolle`      | Fixed          | Always `TEILNEHMER` — all participants are regular attendees                      |
| `vnr`        | Course setting | Veranstaltungsnummer, issued per course by the Ärztekammer                        |
| VNR password | Course setting | Issued alongside the VNR on accreditation approval. **Unique per course.**        |

### API flow

1. Authenticate with VNR + password → receive JWT.
2. `POST /fobi/veranstalter/push_teilnahme` with `{ vnr, efn, rolle: "TEILNEHMER" }`.
3. EIV forwards the credits to the physician's Ärztekammer.

### Live credentials

Real values for the first accredited course have been supplied. They are
**deliberately not recorded in this repository** — see §7. They are configured
through `EIV_VNR` and `EIV_VNR_PASSWORD` in the environment, and stored
encrypted at rest per course by P7-04.

### Deadlines — confirmed, and stricter than first modelled

- Reporting must reach EIV **no later than 8 days after the end of the event**.
  The system enforces this: submissions past the deadline are blocked, not
  merely flagged.
- After the first submission there is a **7-day correction window** for
  corrections and additions.
- **Once the correction window expires, no further electronic submission for
  that VNR is possible at all.**

The third rule is the one that changes the design. It makes the retry queue a
compliance component rather than a reliability one: retrying past the close is
not merely futile, it must **stop, record a permanent failure, and escalate** so
a human can pursue the paper route. `eivDeadlines()` returns `shouldStopRetrying`
for exactly this, and P7-06 consumes it.

### EFN collection

Collected **once**, at the end of the first successfully completed course, then
stored on the user profile and submitted automatically for every later
completion.

Rationale as given: the EFN is permanent and does not change per course;
collecting it after the learner has passed means they are motivated to provide
it.

Flow: pass the assessment → if no EFN on profile, prompt → validate format
(15 digits) → store → auto-submit on completion with the course VNR and password,
with no further user action.

### Profile data accuracy

Keycloak profile data may be **out of date** at submission time — a name change
after marriage is the given example. Therefore:

- Profile data (name, EFN) is pre-filled from the validated token but must
  remain **editable by the learner before submission to EIV**.
- A permanent profile change is not made here: the learner is linked out to the
  MEDICE registration/profile update page, mirroring the existing ADHS network
  flow for updating MEDICE login data.
- **Open technical question:** whether changes made in the MEDICE registration
  flow propagate to Keycloak in real time. Needs evaluation.

This contradicts ADR-0004's "no separate profile maintenance is needed" — see
§6.5.

### Salesforce

MEDICE already has `vDMC_EFN__c` in their Salesforce solution design, currently
unpopulated. Once Salesforce integration exists, the system should both push a
learner-supplied EFN there and check it for an existing value to pre-fill.

**Explicitly out of the 140 h** (roadmap §4 defers Salesforce sync) and
**requires its own estimate**.

---

## 2. Certificate (Teilnahmebescheinigung)

Sent automatically by email from a MEDICE email account after the learner passes
**and the data has been transmitted to EIV**.

### Mandatory content — Ärztekammer Westfalen-Lippe

1. Event number (VNR)
2. Event title
3. Event date and time — the completion timestamp
4. **Event location**
5. **Organizer (MEDICE)**
6. CME points and category — e.g. 4 points, Category D
7. Participant name
8. Stamp and signature of the Scientific Director (MEDICE)
9. This exact sentence:

   > Die Veranstaltung ist im Rahmen der Zertifizierung der ärztlichen
   > Fortbildung der Ärztekammer Westfalen-Lippe mit 4 Punkten (Kategorie D)
   > anrechenbar.

Items 4, 5 and 9 were **not** in the P8-01 field list and are added by this
record. The accreditation body is **Ärztekammer Westfalen-Lippe**.

Note that the mandatory sentence embeds the point count and category, so it is a
template with substitutions rather than a fixed string — a course with different
accreditation must not emit "4 Punkten (Kategorie D)".

### Delivery

- PDF built from the Ärztekammer-provided template (certificate is page 4 of
  that PDF; page 3 shows the intended structure of completed-participant data).
- Signature and stamp embedded as a digital asset.
- Emailed from a MEDICE account; retry with exponential backoff on failure.

### Open questions

- Does the Ärztekammer impose specific requirements on automatically generated,
  digitally delivered certificates? **Inquiry pending.**
- How are the stamp and signature represented digitally?
- Which MEDICE email account / SMTP server sends?
- Should the certificate also be downloadable from the profile or course area?
  (P8-04 assumes yes and builds it — download is the path that still works when
  email delivery fails.)

---

## 3. Lernerfolgskontrolle (quiz)

- Passed at **≥ 70 %**. MEDICE: **11 single-choice questions**, so **8 of 11**
  is a pass (72 %) and 7 is a fail (63 %).
- One question at a time; the learner answers and is advanced automatically.
- Result screen: correct count, percentage and pass/fail —
  _"6 out of 11 questions answered correctly. That is 54 % – Not passed."_
  6/11 is 54.54…, so **the percentage floors**. `scoreQuiz` floors, and there is
  a test asserting exactly this string's arithmetic.
- **Unlimited retries** until the threshold is reached. Not passed → CTA to
  restart.
- Pass threshold configurable per course; question count configurable; single
  or multiple choice configurable.
- **No display of correct answers for CME-certified courses.** Optional
  configuration to reveal them at the end for non-certified courses only.
- All validation server-side. No correct answers in frontend markup or in any
  API payload.
- On pass: trigger EIV submission and certificate.

The unlimited-retry rule simplifies P4-03: the MEDICE `retry_policy` is
"unlimited", and the attempts record exists for audit rather than for enforcing
a cap. The cap must remain configurable, since it is a per-course setting.

---

## 4. Layout — confirmed screens

### 4.1 Course list — "Fortbildungsbereich für ADHS"

- Delivery-type tabs: **On Demand · Live · Präsenz**
- Filters: **Thema**, **Altersgruppe**, both as dropdowns, with selected values
  shown as removable tag chips
- Card metadata line: `5 CME Punkte | 5 Module | 2 Stunden 30 Minuten`
- CTAs: **Zur Fortbildung**, and **Fortbildung fortsetzen** when in progress
- **Pagination** — numbered, with Zurück / Vor

### 4.2 Course detail — four tabs

`Übersicht · Experten/Referenten · Zertifizierung · Mediathek`

Sticky metadata bar: CME Punkte, duration, module count, **Fortbildung
fortsetzen**. Back link _Zurück zur Übersicht_.

Progress card, present on every tab:

> **Ihr Fortschritt** — ring showing **2 von 5** —
> "Sie haben 2 von 5 Modulen abgeschlossen" — **Fortbildung fortsetzen**

The ring counts **modules**, while `course.percent` is content-weighted. These
legitimately differ, so `rollupProgress` returns `moduleCompletion` separately
and the ring is fed from it.

**Übersicht:** Beschreibung der Fortbildung (with _Mehr lesen…_), Lernziele
(checkmark list), Zielgruppe, Inhalte — module list with per-module duration
(`25:24 Min.`) and a subtitle listing chapter topics.

**Experten/Referenten:** cards with photo, role label (_Wissenschaftliche
Leitung_, _Referent/Referentin_), name, institution, biography with _Mehr
lesen…_. Requires a **person entity** with role, institution and photo — not
currently in the schema.

**Mediathek:** downloadable materials grouped by module
("Materialien zu Modul 1 (Grundlagen & Epidemiologie)"), each a card with
thumbnail, title, description and a **Download** button. Locked groups render
blurred behind a padlock and the copy:

> **Wird nach Abschluss der Module freigeschaltet**

This is a **downloadable material content type** that the schema does not yet
have — see §6.2.

### 4.3 Player

- Header: course title; progress panel showing `Modul 3 von 5`, `14:35 / 25:45`,
  `63% absolviert`, and _"Ihr Fortschritt wird automatisch gespeichert"_
- **Modul Übersicht** sidebar: modules expand to chapters, with per-item state
  icons — completed (check), in progress (play), locked (padlock), paused
- Controls: **Fortbildung pausieren**, **Zurück zur Übersicht**
- **Zur Teilprüfung** button, locked, with _"Wird nach Modul 3 freigeschaltet"_
- Content tabs beneath the player:
  **Zusammenfassung · Lernerfolgskontrolle (locked) · CME Punktemeldung (locked)**

Two findings here:

- **Teilprüfung** is a _per-module_ assessment, distinct from the course-level
  Lernerfolgskontrolle. Not in the 140 h scope — see §6.1.
- `63% absolviert` does not equal `14:35 / 25:45` (56.6 %), so the figure is not
  the current video's position. It is presumably module or course progress.
  **Needs confirmation** — it is a number the learner will trust.

---

## 5. Confirmed values

| Setting                              | Value                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------ |
| `pass_threshold_percent`             | 70                                                                             |
| `required_watch_percent`             | **still to be confirmed in writing** — layout says 80 %, MEDICE-292 says 100 % |
| Question count (MEDICE)              | 11, single choice                                                              |
| Retry policy (MEDICE)                | Unlimited                                                                      |
| Accreditation body                   | Ärztekammer Westfalen-Lippe                                                    |
| CME points / category (first course) | 4 points, Kategorie D                                                          |
| Reporting window                     | 8 days after event end                                                         |
| Correction window                    | 7 days after first submission, then permanently closed                         |
| EFN format                           | Exactly 15 digits                                                              |
| Role                                 | `TEILNEHMER`                                                                   |

---

## 6. Conflicts and scope additions

Recorded, not resolved. Each needs a decision from the plan owner.

### 6.1 Teilprüfung is new scope

The player shows **Zur Teilprüfung** gated on module completion — a per-module
assessment. The 140 h plan (P4) covers **one course-level quiz**, plus the
Evaluationsbogen. Per-module assessments multiply the quiz engine's authoring,
attempt-tracking and gating surface.

_Recommendation:_ confirm whether Teilprüfung is required for launch. If it is,
it is roughly +6–8 h in P4 and P5 and must be traded against P9, which is the
declared lever.

### 6.2 Mediathek downloadable materials are new scope

The schema's content types are video, text, quiz and details. The Mediathek
needs a **downloadable material** type with a file asset, per-module grouping,
and lock state driven by module completion. Roadmap §4 defers "media transcoding
pipeline" but says nothing about plain file downloads, which the approved layout
clearly requires.

_Recommendation:_ treat as in scope, roughly +3 h in P2 and P5, since the tab is
part of the approved layout that M2 is defined against.

### 6.3 On Demand / Live / Präsenz is new scope

The course list has three delivery-type tabs. **Live** and **Präsenz** imply
scheduled events with dates, locations and possibly capacity — none of which is
in the domain model, and all of which are a substantial feature.

_Recommendation:_ ship the tabs with only **On Demand** populated for launch,
and confirm that Live/Präsenz are out of scope for 06.09. This should be settled
before P5-05 in week 4.

### 6.4 Certificate-after-EIV conflicts with the launch fallback

The requirement is that the certificate is sent _"after successfully passing the
learning assessment **and transmitting data to the EIV interface**"_.

ADR-0005 deliberately **decoupled** them, and P8-01 states the certificate is
issued regardless of EIV status. That decoupling is what makes the
credentials-late fallback viable: launch with submissions queued and held, and
the learner experience is unaffected.

These cannot both hold. If the certificate strictly requires a successful EIV
submission, then **the queue-and-hold fallback stops protecting the launch
date** — a learner who completes a course during the hold gets no certificate.

_Recommendation:_ issue the certificate on completion and send it on successful
submission, with a **hard fallback**: if the submission is still queued after a
defined interval, send the certificate anyway and flag the participation for
manual reporting. That satisfies the Ärztekammer's content requirements, keeps
the learner whole, and preserves the fallback. **Needs written agreement.**

Note this conflict is now less likely to bite, since live VNR credentials have
been supplied — but the fallback should still be coherent.

### 6.5 Editable profile data before submission conflicts with ADR-0004

ADR-0004 states profile data comes from the validated token so that "no separate
profile maintenance is needed". The requirement is that name and EFN are
**pre-filled but editable** before EIV submission, because Keycloak data may be
stale.

_Recommendation:_ store the name **as submitted** on the submission record,
separately from the token-derived profile. The token remains the identity
authority; the submission carries the name the learner attested to. ADR-0004
needs a superseding note. Roughly +2 h in P1 and P5.

### 6.6 Experten/Referenten needs a person entity

The tab requires people with role, institution, photo and biography attached to
a course. Not in the schema. Roughly +2 h in P2 and P9. In scope, since the tab
is part of the approved layout.

### 6.7 Salesforce EFN sync needs an estimate

Explicitly deferred by roadmap §4 and explicitly requested as an estimate by the
client. Not started; not costed. Should be quoted separately.

### Cumulative effect

Items 6.1, 6.2, 6.5 and 6.6 total roughly **13–15 h** of additions to a budget
that is already fully allocated at 140 h. That is more than half of the P9 admin
console, which is the only declared trade lever. **This needs a decision before
week 3**, because P2 and P5 both start building against these shapes in week 2.

---

## 7. Credential handling

The real VNR and its password were supplied in the project chat. They are
**not** committed to this repository, and no plaintext credential ever should
be — `CLAUDE.md` §4 invariant 7.

Two consequences:

1. They are configured via `EIV_VNR` and `EIV_VNR_PASSWORD` in the environment
   for the harness, and stored encrypted at rest per course by P7-04.
2. Because they were transmitted over chat, they should be treated as
   **exposed** and rotated with the Ärztekammer if that is possible for a VNR
   password. Raise this with MEDICE.

These appear to be **production** credentials for a live accredited event, not
sandbox ones. The harness therefore defaults to the local mock, and pointing it
at the live endpoint requires an explicit, deliberate environment change — a
test submission against a live VNR would create a real Punktemeldung for a real
physician.
