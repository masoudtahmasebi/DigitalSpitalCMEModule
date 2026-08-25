# CME module test pack — overview

**Assignee: Philipp Burka** — applies to this document and to every ticket in
this folder.

Each file here is a standalone test ticket, cut so that one takes 20–40 minutes
and works without knowledge of the others.

**The product is in German.** German terms are kept as they appear on screen —
_Lernerfolgskontrolle_, _Teilnahmebescheinigung_, _Punktemeldung_,
_Anerkennungsbescheid_, _Ärztekammer_, _EFN_, _VNR_, _Mediathek_,
_Evaluationsbogen_. You will be comparing against those exact words, so
translating them here would only make the comparison harder.

## Order

The learner tickets (01–08) form one continuous Fortbildung and build on each
other — done in order it is a single sitting rather than eight. The admin
console tickets (09–16) are independent.

---

## Before the first test — please read once

### 1. Do not test on the accredited MEDICE course

The course **"ADHS Akademie adult"** carries the real VNR
`2760552025919300018` from the ÄKWL Anerkennungsbescheid. For it:

- **70 % correctly answered questions is a condition of the accreditation**, not
  a setting.
- The Bescheid requires that **changes of any kind be reported to the ÄKWL
  promptly and in writing**. Editing questions, reordering modules or adjusting
  points is such a change.

**Please test either on the `ds` tenant or on a newly created course left in
draft.** A draft is invisible to participants and can be changed freely.

### 2. Reporting points to the Ärztekammer is currently blocked

The interface holds a **one-day** accredited period (13.10.2025) for a
twelve-month on-demand Fortbildung. `push_teilnahme` refuses any participation
date outside that period with HTTP 406 — **so every Punktemeldung is currently
rejected.**

This is known, has been raised with the ÄKWL, and is **not a defect to report**.
Everything before it — the course, the exam, the evaluation, the EFN, the
certificate — works independently of it.

### 3. The Teilnahmebescheinigung is issued on completion, not after reporting

A deliberate decision: the certificate is issued as soon as the course is
complete. It does **not** wait for the Punktemeldung.

### 4. Always say what you were looking at

With every observation, please include:

- **Browser and device** (e.g. "Chrome 141, MacBook")
- **The address from the address bar** — every screen has its own
- **Time** of the observation
- **Screenshot** where possible

The last point matters most: whether something is missing or merely not yet
deployed to the server you are looking at cannot be told apart in a browser.
With an address and a time it can.

---

## Reporting, please in this form

Per observation:

| Field          |                                    |
| -------------- | ---------------------------------- |
| **Ticket**     | e.g. 03                            |
| **Step**       | e.g. 4                             |
| **Expected**   | what the ticket says should happen |
| **Observed**   | what actually happened             |
| **Severity**   | blocking / annoying / cosmetic     |
| **Screenshot** |                                    |

Please report "annoying" and "cosmetic" as readily as "blocking". Twelve
cosmetic observations on one screen are not, together, a cosmetic problem.

## If something is plainly missing

Please report it anyway — but say whether it is **absent entirely** or whether
you simply could not find the button for it. Those are two different findings
and both are useful.
