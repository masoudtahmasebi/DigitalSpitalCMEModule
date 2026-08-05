# The content model

Every field the layout needs, where it lives, and which API call carries it.

This is the contract between three things that must agree: the admin panel that
authors content, the database that stores it, and the white-label frontend that
renders the Zeplin screens — whether it is loaded standalone or mounted inside
WordPress. When they disagree the symptom is a blank area on a physician's
screen, so this document is the place to look first.

**Status column.** `✅` exists end to end · `🟡` stored but not yet exposed by
the API or the panel · `🔴` not modelled yet, with the ticket that adds it.

---

## 1. The hierarchy

```
Customer            the tenant boundary — MEDICE
└── Department      a therapeutic area — ADHS
    └── Project     one deployment surface, one identity provider binding
        └── Course  one accredited Fortbildung, one VNR
            └── Modul
                └── Kapitel
                    └── Inhalt   video | text | quiz | details | material
```

Every level below `Customer` carries `customer_id` and is isolated by RLS
(ADR-0002). `ordinal` gives explicit order at every level — never `created_at`,
because reordering must not rewrite history.

| Level         | Key fields                                                             | Status    |
| ------------- | ---------------------------------------------------------------------- | --------- |
| `customers`   | `id`, `slug`, `name`                                                   | ✅        |
| `departments` | `id`, `customer_id`, `slug`, `name`                                    | ✅        |
| `projects`    | `id`, `customer_id`, `department_id`, `slug`, `name`, identity binding | ✅        |
| `courses`     | see §2                                                                 | ✅        |
| `modules`     | `id`, `course_id`, `ordinal`, `title`, `subtitle`                      | ✅        |
| `chapters`    | `id`, `module_id`, `ordinal`, `title`, `body`                          | ✅        |
| `contents`    | see §4                                                                 | mostly ✅ |

**`modules.subtitle`** is the dot-separated topic line under each module in the
Übersicht → Inhalte list ("ADHS-Definition · Epidemiologie · Neurobiologie").
The widget falls back to joining chapter titles when it is empty.

---

## 2. Course

The accreditation-bearing entity. Most of these fields exist because the
Zertifizierung tab or the certificate PDF needs them, not because a course
inherently has them — which is why they are on the course and not on the
project.

### Identity and presentation

| Field               | Column                         | Rendered where                               | Status |
| ------------------- | ------------------------------ | -------------------------------------------- | ------ |
| Slug                | `slug`                         | URL / plugin attribute                       | ✅     |
| Title               | `title`                        | catalogue card, course hero, player masthead | ✅     |
| Description         | `description`                  | catalogue card, Übersicht → Beschreibung     | ✅     |
| Title image         | `hero_image_url`               | catalogue card, course hero right half       | ✅     |
| Delivery type       | `delivery_type`                | On Demand / Live / Präsenz tabs              | ✅     |
| Thema               | `thema` (text[])               | catalogue filter + chips                     | ✅     |
| Altersgruppe        | `altersgruppe` (text[])        | catalogue filter + chips                     | ✅     |
| Learning objectives | `learning_objectives` (text[]) | Übersicht → Lernziele, orange ticks          | ✅     |
| Target audience     | `target_audience`              | Übersicht → Zielgruppe                       | ✅     |

### Accreditation — the Zertifizierung tab

Every line of that screen comes from here. Nothing on it is computed by the
client.

| Field              | Column                   | Zertifizierung line                        | Status |
| ------------------ | ------------------------ | ------------------------------------------ | ------ |
| CME points         | `cme_points`             | "erhalten Sie 5 CME-Punkte"                | ✅     |
| Category           | `cme_category`           | Kategorie D (Bescheid)                     | ✅     |
| Accrediting body   | `accreditation_body`     | "von der Landesärztekammer … zertifiziert" | ✅     |
| Valid from / to    | `valid_from`, `valid_to` | "Gültigkeit: 01.01.2026 – 31.12.2026"      | ✅     |
| Fortbildungsnummer | `fortbildungsnummer`     | "Fortbildungsnummer: 2026-ADHS-12345"      | ✅     |
| VNR                | `vnr`                    | EIV submission; certificate barcodes       | ✅     |
| VNR password       | `vnr_password_enc`       | never rendered — write-only, encrypted     | ✅     |
| Organiser          | `organizer`              | certificate "Veranstalter"                 | ✅     |
| Location           | `event_location`         | certificate "Ort" — "online"               | ✅     |

**`vnr` and `fortbildungsnummer` are different things** and the layout shows
only the second. The VNR is the 19-digit number the EIV interface authenticates
against; the Fortbildungsnummer is the customer-facing label on the
Zertifizierung tab. Conflating them would put a credential on a public screen.

### Completion rules

Shown to the learner as the three orange ticks under "Voraussetzungen für den
Zertifikatserwerb", and enforced server-side (CLAUDE.md §4 invariant 1).

| Field           | Column                   | Meaning                                                                              | Status |
| --------------- | ------------------------ | ------------------------------------------------------------------------------------ | ------ |
| Watch threshold | `required_watch_percent` | "Mindestens 80% aller Videomodule" — **S7, unconfirmed**                             | ✅     |
| Pass threshold  | `pass_threshold_percent` | "Mindestens 70% der Fragen" — 70 % is an accreditation _condition_, not a preference | ✅     |
| Attempt limit   | `max_quiz_attempts`      | `NULL` = unlimited                                                                   | ✅     |
| Reveal answers  | `reveal_correct_answers` | whether a failed attempt shows what was right                                        | ✅     |
| Evaluation      | `evaluations` table      | "Evaluationsbogen ausfüllen"                                                         | ✅     |

Snapshotted onto `enrolments` at enrolment, so a later threshold change cannot
retroactively invalidate work already done.

### Certificate assets

| Field                        | Column                                          | Status                                                                                                                               |
| ---------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Scientific lead name / title | `scientific_lead_name`, `scientific_lead_title` | ✅                                                                                                                                   |
| Stamp image                  | `stamp_image`, `stamp_image_mime`               | ✅                                                                                                                                   |
| Signature image              | `signature_image`, `signature_image_mime`       | ✅                                                                                                                                   |
| Issue place                  | `certificate_issue_place`                       | ✅                                                                                                                                   |
| Participant address          | —                                               | 🔴 **S12** — the ÄKWL Muster has a mandatory `Anschrift:` and ADR-0004 argues against collecting it. Blocked on the client's answer. |

---

## 3. Experts — the Experten/Referenten tab

`course_experts`: `role_label`, `name`, `institution`, `biography`,
`photo_url`, `ordinal`. All ✅.

`role_label` is free text, not an enum: the correct label depends on the person
("Wissenschaftliche Leitung", "Referent", "Referentin"), and a platform that
chose between the last two from a role code would be guessing at somebody's own
description of themselves.

---

## 4. Inhalt — the five content kinds

One table, `contents`, discriminated by `kind`. Shared: `id`, `chapter_id`,
`ordinal`, `title`, `description`, `thumbnail_url`.

### `video`

| Field    | Column                  | Notes                                              | Status                             |
| -------- | ----------------------- | -------------------------------------------------- | ---------------------------------- |
| Sources  | `media_sources` (jsonb) | ordered `[{url, mimeType, label}]`, adaptive first | ✅                                 |
| Poster   | `poster_url`            | without it the player shows a black rectangle      | ✅                                 |
| Duration | `duration_sec`          | drives the watch gate denominator                  | ✅                                 |
| Captions | `captions_url`          | `.vtt`. **WCAG 1.2.2 Level A** — not optional      | ✅ (files outstanding from MEDICE) |

Progress is the **union of watched intervals**, never the maximum position
(CLAUDE.md §4 invariant 5) — a max-position gate is skippable by dragging the
scrub bar.

### `text`

`body` — long-form prose, rendered as the player's Zusammenfassung tab. ✅

### `quiz`

`quiz_questions` → `quiz_options`; attempts in `quiz_attempts` / `quiz_answers`.
Scored server-side by `scoreQuiz` in `@ds/domain`. ✅

### `details`

`body` — the free-form panel the layout shows beside a module. ✅

### `material` — the Mediathek

| Field       | Column                               | Status                                 |
| ----------- | ------------------------------------ | -------------------------------------- |
| Title       | `title`                              | ✅                                     |
| Description | `description`                        | ✅ _(added 0018 — the card paragraph)_ |
| Card image  | `thumbnail_url`                      | ✅ _(added 0018)_                      |
| File        | `file_url`, `file_size`, `mime_type` | ✅                                     |

**A locked material arrives with `file_url: null`.** The padlock is honest
because the API withholds the URL, not because the client agrees to respect a
boolean — anyone holding the token can read the JSON. The blur sits over titles
the learner is entitled to see.

---

## 5. Progress and participation

What the admin panel shows per learner, and what the widget renders.

| Concept                                  | Source                                               | Status                         |
| ---------------------------------------- | ---------------------------------------------------- | ------------------------------ |
| Watch coverage                           | `content_progress` segments → `courseWatchCoverage`  | ✅                             |
| Module completion                        | `rollupProgress` — the **one** rollup path           | ✅                             |
| Quiz score / attempts                    | `quiz_attempts`                                      | ✅                             |
| Evaluation submitted                     | `evaluation_responses`                               | ✅                             |
| EFN                                      | `efn_profiles` — one per person, never per enrolment | ✅                             |
| Completion                               | `enrolments.completed_at`, server-decided            | ✅                             |
| EIV submission state                     | `eiv_submissions` + append-only attempt log          | ✅                             |
| Certificate                              | `certificates`                                       | ✅                             |
| Per-learner progress detail in the panel | `GET /admin/learners`                                | ✅ API; console screen pending |

Learner progress and admin reporting read the same rollup over the same
repository method (CLAUDE.md §4 invariant 6). Two implementations would
eventually disagree, and disagreeing numbers on a CME record is a compliance
problem, not a display bug.

**S16 is still open:** the layout's `63% absolviert` does not say _what_ it
measures. Three candidates legitimately differ — content items, union watch
coverage, modules. The widget currently shows modules and names the quantity
rather than leaving it bare.

---

## 6. What the frontend fetches

Standalone or inside WordPress, the same calls, in the same order. The host
differs only in where the bearer token comes from (ADR-0007).

| Screen          | Call                                                              |
| --------------- | ----------------------------------------------------------------- |
| Catalogue       | `GET /courses?deliveryType&thema&altersgruppe&page`               |
| Course detail   | `GET /courses/{slug}` — modules, chapters, experts, accreditation |
| Enrolment state | `PUT /courses/{slug}/enrolment` (idempotent)                      |
| Player          | `GET /courses/{slug}/contents/{id}` — media resolved per source   |
| Progress        | `POST …/contents/{id}/progress` — segments, not a percentage      |
| Quiz            | `GET`/`POST …/contents/{id}/quiz`                                 |
| Evaluation      | `GET`/`POST /courses/{slug}/evaluation`                           |
| EFN             | `PUT /me/efn`                                                     |
| Completion      | `POST /courses/{slug}/completion`                                 |
| Certificate     | `GET /courses/{slug}/certificate[/file]`                          |
| Mediathek       | `GET /courses/{slug}/materials`                                   |
| Branding        | `GET /branding` — colours, radius, font                           |

The client sends **segments, never a percentage**. A percentage computed in the
browser is a compliance verdict reached on the wrong side of the trust
boundary; the server unions the intervals and decides.

---

## 7. Roles

Scope says _where_; capability says _what_. Both are needed — a `course_editor`
and a `department_admin` can sit in the same department and still differ on
whether they may create a project in it.

| Role               | Scope                                   | May manage                                                                    |
| ------------------ | --------------------------------------- | ----------------------------------------------------------------------------- |
| `super_admin`      | everything                              | customer, department, project, course, content, staff, learners, certificates |
| `customer_admin`   | one customer                            | department, project, course, content, staff, learners, certificates           |
| `department_admin` | one department                          | project, course, content, learners, certificates                              |
| `course_editor`    | one customer, optionally one department | **course, content only**                                                      |

`course_editor` is the "limited access" role: an author or an agency who builds
courses and cannot reorganise the customer around them. Only `super_admin` may
create a _customer_, because a customer is the tenant boundary itself and
nobody inside one may mint another.

Enforced by `CAPABILITIES` in `@ds/domain/staff-identity`, which is exhaustive
by construction — a new role without an entry fails to compile rather than
silently inheriting somebody else's permissions.

---

## 8. Open questions that change fields

Answers change the schema, so they are listed here as well as in
`docs/show-stoppers.md`.

| Ref | Question                                              | Field affected                |
| --- | ----------------------------------------------------- | ----------------------------- |
| S7  | 80 % or 100 % watch requirement, in writing           | `required_watch_percent`      |
| S12 | Is a blank `Anschrift` acceptable on the certificate? | a new address field, or none  |
| S13 | Both VNR barcodes on the certificate                  | rendering only                |
| S16 | What does `63% absolviert` measure?                   | which rollup the widget shows |
| S11 | What is `Veranstaltungsende` for an on-demand course? | the EIV deadline input        |

---

## 8. Who can change what a physician sees (P13-01)

Every field in §2 that the layout draws is editable from the admin console's
**Inhalte & Darstellung** tab: title, description, hero image, format, Thema,
Altersgruppe, Lernziele, Zielgruppe, CME points and category, Fortbildungsnummer
and the accreditation window.

They were stored, carried by the API and rendered from the first day, and
settable only by `db/seed/adhs.ts` — so a customer could not change the title of
their own course without a developer. That is what this ticket fixed.

Two fields deliberately stay out of that form:

- **`slug`** — the course's identity in every URL, bookmark and WordPress
  shortcode. Re-slugging through the form that fixes a typo in a title breaks
  them all silently, so it is not a form field at all.
- **`passThresholdPercent`** — a condition of the Anerkennungsbescheid rather
  than a presentation choice. It lives on the settings tab behind an explicit
  acknowledgement, and the server refuses the change without one.

**A field that renders is a field that must be authorable.** The check when
adding one is: does a physician see it? If so it belongs in this form and in
the round-trip test in `moderation.integration.test.ts`, which asserts an edit
made through the console arrives at the learner-facing `GET /courses/{slug}`.
