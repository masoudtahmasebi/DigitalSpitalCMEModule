# The MEDICE layout, screen by screen

Reference: `260729_MEDICECMEFortbildungMS.pdf` (Adobe XD, 29.07.2026), rendered to
`docs/design/screens/page-NN.png`. **These renders are the authority.** Where this
document and the PDF disagree, the PDF wins and this document is wrong.

This file exists because "it looks about right" is not a review. Every element the
layout draws gets a row, and every row gets a verdict. A reviewer should be able to
hold a render beside the built screen and walk this list without having to guess what
was deliberate.

## Verdicts

| Verdict        | Meaning                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------- |
| **matches**    | Built and visually equivalent.                                                           |
| **differs**    | Built, but not as drawn. Each one names the difference.                                  |
| **missing**    | Not built.                                                                               |
| **deliberate** | Different on purpose, with the reason stated. A deviation nobody wrote down is a defect. |

## What is ours and what is the host page's

Page 01 shows a WordPress navigation bar (`ADHS bei Kindern und Jugendlichen`,
`Service`, `Logout`) and the ADHS logo card above the hero. **None of that is the
widget.** `<ds-lms>` renders from the hero downwards; the navigation, the logo card
and the page background belong to MEDICE's theme. The plugin mounts the widget into
that page (ADR-0007). Rows below cover only what the widget draws.

The one exception is the logo: `Branding.logoUrl` lets a project put its own logo
above the widget for hosts that are _not_ WordPress — the standalone portal, for
instance, where nothing else would draw one.

---

## The schema, aligned to the layout

The layout is the source of truth for the product, so it is the source of truth for
the columns too. A screen that asks for four fields against a table with one is not a
front-end problem — it is a gap that shows up later as an invented UI or a
concatenated string nobody can take apart again.

Migration `0024_layout_fields.sql` closes the four the layout opened.

| The layout draws                                              | The schema had                                                                  | Now                                                                                                                                                                        |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| p.13 `Titel`, `Vorname`, `Nachname` as three fields           | `enrolments.attested_name`, one free-text column                                | `attested_title`, `attested_given_name`, `attested_family_name`, plus the composed `attested_name` that is still what the certificate prints and the Punktemeldung reports |
| p.13 a consent checkbox referring to the Datenschutzerklärung | nothing — the box would have been validated by the browser and recorded nowhere | `consent_given_at` and `consent_document`, written in the same statement that stamps the completion                                                                        |
| p.02 a labelled `Vorkenntnisse:` paragraph                    | the tail of `target_audience`, by convention                                    | `courses.prerequisites`, its own column and its own field in the console                                                                                                   |
| p.04 `Fortbildungsnummer: 2026-ADHS-12345`                    | the column existed; the detail response did not carry it                        | `CourseDetail.fortbildungsnummer`                                                                                                                                          |

### One composer, not two

Three fields go in and one string comes out, and `composeAttestedName` in
`packages/domain` is the only place that happens. A second composer would
eventually disagree with the first about a space, and the two artefacts a
physician's CME record consists of — the certificate and the report to their Kammer
— would carry names that no longer match. Nobody would notice until an Ärztekammer
could not reconcile them.

`enrolments_attested_name_present` refuses the row where the parts exist and the
composed name does not. It does **not** try to check the composition itself: SQL's
idea of whitespace and the domain's would drift, and a constraint that is almost
right is worse than none.

### The consent is recorded, not just required

GDPR Art. 7(1) puts the burden of demonstrating consent on the controller. A
checkbox the browser validated and nobody wrote down demonstrates nothing, so the
**version** of the privacy notice is stored rather than a boolean — consent to the
January wording is not consent to the June wording.

It survives an erasure, deliberately (Art. 17(3)(b) and (e)): once the name and the
EFN are gone it identifies nobody, and it is the only remaining answer to "was this
report authorised?" while the report itself is still on file. `docs/gdpr.md` §2, §3
and §5 carry the reasoning.

### What the schema already had

Everything else the thirteen pages ask for was there: the module subtitle that draws
the topic line (p.02), the expert's role, institution, biography and photograph
(p.03), the accreditation body and validity window (p.04), the material description
and thumbnail (p.05), per-content durations for `14:35 / 25:45` (p.06), the question
kind for `Antwortformat: Single Choice` (p.08) and the pass threshold behind
`Mind. 8 von 11 richtig` (p.08, p.11, p.12). None of those needed a migration.

---

## Page 01 — Fortbildungsbereich (catalogue)

**Built to the layout on 05.08.** Rows that read _was_ record what it looked like
before, because a fix nobody can see the shape of is hard to review.

| #    | The layout draws                                                                                                                                               | Verdict                                                                                                                                                                                                                                                      |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1.1  | Two tabs: **On Demand**, **Weitere**                                                                                                                           | **matches** — _was_ three (`On Demand · Live · Präsenz`). `Weitere` asks for every delivery type that is not on-demand, so it is a truthful empty state rather than two tabs that both stand empty                                                           |
| 1.2  | Hero: teal, a photograph bleeding off the right, one large rounded corner bottom-right                                                                         | **matches** — `Branding.catalogHeroImageUrl`, right-anchored under a gradient that clears to transparent, `rounded-br-[7rem]`. Hidden below 640 px: see the note in `CatalogHero`                                                                            |
| 1.3  | CME seal: scalloped orange badge, "Zertifizierte" curved over the top, "Fortbildung" curved under, **CME** across the middle, straddling the hero's right edge | **matches** — `CatalogSeal`, 16 lobes, `textPath` arcs, centred on the content column's right edge. A customer may replace it with their own via `Branding.catalogSealImageUrl`                                                                              |
| 1.4  | Eyebrow `WEITERBILDUNG FÜR ÄRZTE`, uppercase, letter-spaced                                                                                                    | matches                                                                                                                                                                                                                                                      |
| 1.5  | Heading `Fortbildungsbereich für ADHS`                                                                                                                         | **matches** — and it is now `Branding.catalogTitle`, so it is MEDICE's heading rather than the platform's. The bundle's fallback is the generic "Fortbildungsbereich"                                                                                        |
| 1.6  | Intro paragraph, two lines                                                                                                                                     | **matches** — likewise `Branding.catalogIntro`                                                                                                                                                                                                               |
| 1.7  | Filter control: full pill, light grey fill, no border, orange rounded-square chevron at the right                                                              | **matches** — _was_ an 8 px radius with a grey border and a full-height orange block                                                                                                                                                                         |
| 1.8  | Labels `Thema` / `Altersgruppe` above each control                                                                                                             | matches                                                                                                                                                                                                                                                      |
| 1.9  | Removable tag chips under the controls                                                                                                                         | matches                                                                                                                                                                                                                                                      |
| 1.10 | Each course is its **own** white card, rounded, drop shadow, gap between                                                                                       | **matches** — _was_ one panel with hairline dividers                                                                                                                                                                                                         |
| 1.11 | Card image flush to the card's left edge, roughly 390×255                                                                                                      | **matches** — `24.5rem`, `self-stretch`, no padding around it                                                                                                                                                                                                |
| 1.12 | Meta line in teal                                                                                                                                              | matches                                                                                                                                                                                                                                                      |
| 1.13 | Title, bold                                                                                                                                                    | matches                                                                                                                                                                                                                                                      |
| 1.14 | Description, four lines                                                                                                                                        | matches                                                                                                                                                                                                                                                      |
| 1.15 | `Zur Fortbildung` teal; `Fortbildung fortsetzen` orange when in progress                                                                                       | matches                                                                                                                                                                                                                                                      |
| 1.16 | Pagination `1 2 … 8 9 10`; the current page carries a short teal bar **above** the number                                                                      | **matches** — _was_ under it                                                                                                                                                                                                                                 |
| 1.17 | Page background: near-white with large pale circles                                                                                                            | **deliberate** — the background belongs to the host page, not the widget                                                                                                                                                                                     |
| 1.18 | Facet counts beside each filter value                                                                                                                          | **fixed, and it was a defect rather than a difference.** They were counted over the whole catalogue, so `Diagnostik (3)` and `Übergang / Transition (1)` could both be offered and select nothing. Each facet is now counted under the rest of the selection |

Geometry taken off the render rather than guessed: the content column is **1050 px**
with its left edge at x=195 of 1440, the hero is **312 px** tall, the gap from the
hero to the tab row is **66 px**, and the seal is **130 px** across, centred on the
content column's right edge.

## Page 02 — Fortbildung → Übersicht

| #    | The layout draws                                                                                                                                                           | Verdict                                                                                 |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 2.1  | Hero split in two: teal with the title on the left, the course image full-bleed on the right                                                                               | **differs** — full-width teal, image not shown                                          |
| 2.2  | Meta bar: white card overlapping the hero's lower edge — orange `4` badge, `CME Punkte`, clock + duration, module icon + count, teal `Fortbildung fortsetzen` at the right | matches, except the icons are grey rather than orange                                   |
| 2.3  | `← Zurück zur Übersicht` under the bar                                                                                                                                     | matches                                                                                 |
| 2.4  | Four tabs, the active one white and merged into the panel                                                                                                                  | matches                                                                                 |
| 2.5  | `Beschreibung der Fortbildung`, then `Mehr lesen…` **inline at the end of the text**, teal and bold                                                                        | **differs** — a separate underlined link on its own line                                |
| 2.6  | `Lernziele`: intro line, then orange circled ticks                                                                                                                         | matches                                                                                 |
| 2.7  | `Zielgruppe`: intro line, paragraph, bullet list, `Vorkenntnisse:` paragraph                                                                                               | matches (the structure is authored content, not layout)                                 |
| 2.8  | `Inhalte`: teal arrow, module title, topic line, duration `25:24 Min.` right-aligned                                                                                       | **differs** — the duration is followed by `· 1 Kapitel`, which the layout does not draw |
| 2.9  | Thin rules between sections                                                                                                                                                | **missing**                                                                             |
| 2.10 | Progress card: teal, ring, `2` over `von 3`, sentence, orange button                                                                                                       | matches, plus a watch-percentage line the layout does not draw                          |

## Page 03 — Experten/Referenten

| #   | The layout draws                                                                                              | Verdict                             |
| --- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| 3.1 | Heading `Die Experten/Expertinnen aus dieser Fortbildung`                                                     | matches                             |
| 3.2 | Per expert: square image left; role in teal; name bold; institution grey; biography with inline `Mehr lesen…` | matches, except `Mehr lesen…` again |
| 3.3 | Hairline between experts                                                                                      | matches                             |

## Page 04 — Zertifizierung

| #   | The layout draws                                                                                                                                                                                                                                        | Verdict                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4.1 | An **informational** panel: `Zertifizierung` heading, then `CME-Punkte`, `Akkreditierung` (body, `Gültigkeit`, `Fortbildungsnummer`), `Voraussetzungen für den Zertifikatserwerb` (orange ticks), `Punktemeldung`, `Ihr Zertifikat` (bulleted contents) | **differs — structurally.** The built tab is the course outline plus the EFN form plus the completion action. None of that is on this page in the layout |
| 4.2 | No form of any kind on this tab                                                                                                                                                                                                                         | **differs** — the EFN field, the name field and `Fortbildung abschließen` all live here today                                                            |

## Page 05 — Mediathek

| #   | The layout draws                                                                                                          | Verdict                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 5.1 | `Mediathek` heading left, `Modul` filter right                                                                            | matches                                                                                                      |
| 5.2 | Group heading `Materialien zu Modul 1 (Grundlagen & Epidemiologie)`                                                       | matches                                                                                                      |
| 5.3 | Materials in a **two-column grid**                                                                                        | **differs** — one column, occupying half the panel                                                           |
| 5.4 | Card: image on top, bold title, description, teal `Download ⤓` pill                                                       | **differs** — no description shown, no image, a `PDF · 512 KB` meta line the layout does not draw            |
| 5.5 | A locked group is **blurred as a whole**, with a lock and `Wird nach Abschluss der Module freigeschaltet` centred over it | **differs** — the lock and its caption are positioned off the card, overlapping the panel's empty right half |

## Pages 06–07 — Player

| #   | The layout draws                                                                                                                                                            | Verdict                               |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| 6.1 | The whole page teal, with one large rounded corner where it ends                                                                                                            | **differs** — a teal band, not a page |
| 6.2 | `← Zurück zur Übersicht` as an **orange pill, top right**                                                                                                                   | matches                               |
| 6.3 | Progress card, top right: `Modul 2 von 3`, `14:35 / 25:45`, bar, `63% absolviert`, and `Ihr Fortschritt wird automatisch gespeichert` with a save icon                      | **missing**                           |
| 6.4 | One white panel holding the video on the left and the sidebar on the right                                                                                                  | needs checking against the build      |
| 6.5 | Sidebar `Modul Übersicht`: orange tick for a finished module, orange pause for the one in progress, chevron to expand, chapters with ▶ / 🔒, then `🔒 Lernerfolgskontrolle` | needs checking                        |
| 6.6 | Orange `⏸ Fortbildung pausieren`, replaced by teal `Lernerfolgskontrolle beginnen` at 100 %                                                                                 | **missing**                           |
| 6.7 | Under the video: `Modul 3 – Therapie`, `Kapitel 1 – S3 Leitlinien 2018` in teal, then the text                                                                              | needs checking                        |

## Page 08 — Lernerfolgskontrolle, before starting

| #   | The layout draws                                                                                                   | Verdict                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 8.1 | Eyebrow `Lernerfolgskontrolle`, heading `Abschlussprüfung`                                                         | needs checking                                                                                                                           |
| 8.2 | Three stat cards: `Anzahl Fragen 11`, `Antwortformat Single Choice`, `Bestehen 70 %` with `Mind. 8 von 11 richtig` | **missing**                                                                                                                              |
| 8.3 | Teal-outlined info banner                                                                                          | **missing**                                                                                                                              |
| 8.4 | Orange `Teilprüfung starten` and outlined `Zurück zur Übersicht`                                                   | **open question** — the button says _Teilprüfung_ directly under a heading that says _Abschlussprüfung_. See `docs/show-stoppers.md` S20 |

## Pages 09–10 — A question

| #   | The layout draws                                                                                             | Verdict        |
| --- | ------------------------------------------------------------------------------------------------------------ | -------------- |
| 9.1 | `Abschlussprüfung` teal, `Frage 5 von 11` right, progress bar                                                | needs checking |
| 9.2 | Options as full-pill outlined rows; the selected one gets a teal border, a pale teal fill and a filled radio | needs checking |
| 9.3 | When the options overflow: a scroll area and `Weitere Antworten durch Scrollen sichtbar ⌄`                   | **missing**    |
| 9.4 | `← Zurück` outlined, `Weiter →` orange                                                                       | needs checking |

## Page 11 — Failed

| #    | The layout draws                                                                                                                        | Verdict        |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| 11.1 | `Prüfung nicht bestanden` in red, centred                                                                                               | needs checking |
| 11.2 | Score card: `3 / 11`, `richtige Antworten`, **red** bar, `27%`, `8 von 11 richtige Antworten zum Bestehen erforderlich`                 | needs checking |
| 11.3 | Orange `⟳ Abschlussprüfung wiederholen`; outlined `Fortbildung pausieren` with `Prüfung zu einem späteren Zeitpunkt fortsetzen` beneath | needs checking |

## Page 12 — Passed

| #    | The layout draws                                                             | Verdict                                                                        |
| ---- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 12.1 | `Abschlussprüfung bestanden!` teal, centred, with a teal rosette             | needs checking                                                                 |
| 12.2 | Score card: `10 / 11`, teal bar, `91%`, the requirement line                 | needs checking                                                                 |
| 12.3 | Orange `CME-Punkte geltend machen →` — **this is what opens the EFN screen** | **differs** — the EFN form is on the Zertifizierung tab today, not behind this |

## Page 13 — Punktemeldung (EFN)

| #    | The layout draws                                                         | Verdict                                                                                                                                       |
| ---- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 13.1 | `Herzlichen Glückwunsch!` and `Sie haben die Fortbildung abgeschlossen.` | needs checking                                                                                                                                |
| 13.2 | Grey info box explaining why the EFN is needed                           | **missing**                                                                                                                                   |
| 13.3 | `Titel*` select, `Vorname*` / `Nachname*` side by side, `EFN-Nummer*`    | **differs** — one free-text `Name auf der Teilnahmebescheinigung`, no title, no split name                                                    |
| 13.4 | Helper `Die 18-stellige EFN finden Sie auf Ihrem Arztausweis`            | **contradicts the code** — the EFN is validated as **15** digits (`packages/domain/src/eiv.ts`). Not changed. See `docs/show-stoppers.md` S21 |
| 13.5 | Consent checkbox linking the Datenschutzerklärung                        | **missing**                                                                                                                                   |
| 13.6 | Orange `Daten übermitteln →`                                             | matches in function                                                                                                                           |

---

## The two things not to resolve by guessing

Both are compliance semantics, and `CLAUDE.md` §7 is explicit that an invented rule
that ships is worse than a delay.

- **S21 — EFN length.** The layout says 18 digits; the domain says 15. A wrong length
  is either a rejected Punktemeldung or a silently unreportable one.
- **S20 — Teilprüfung.** The button on page 08 starts a _Teilprüfung_ under a heading
  that says _Abschlussprüfung_, and no per-module assessment exists anywhere else in
  the 13 pages. Either the label is a slip or the feature is back in scope (+6–8 h).
