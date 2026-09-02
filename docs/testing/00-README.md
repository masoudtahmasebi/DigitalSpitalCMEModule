# CME module — test pack

**Assignee:** Amruth
**The thing under test:** the DigitalSpital learner widget **inside MEDICE's
WordPress site**. That is what a physician sees, and it is where a defect costs
something.

17 tickets, 97 cases. Each is standalone, with numbered cases, steps, expected
results and a pass/fail line.

---

## These are in Jira, and Jira is where they are worked

Project **DEP** was populated on 27.08.2026 and the pack now lives there. Amruth
runs the tickets and reports on them; this directory is the source they were
written from, and the two must not be allowed to drift apart silently.

**Jira renumbers.** Setup runs first, so it became **T01** there, and the
Fortbildungsbereich and course-detail tickets are one ticket rather than two.
The mapping is the only place that fact is recorded:

| This file                                           | Jira                                                      | Jira's number                       |
| --------------------------------------------------- | --------------------------------------------------------- | ----------------------------------- |
| `00-README.md`                                      | [DEP-5](https://digitalspital.atlassian.net/browse/DEP-5) | — the hub, and the reporting format |
| `16-prepare-the-data.md`                            | DEP-6                                                     | T01                                 |
| `01-the-widget-appears.md`                          | DEP-7                                                     | T02                                 |
| `02-sign-in-from-medice.md`                         | DEP-8                                                     | T03                                 |
| `03-isolation-from-the-host-page.md`                | DEP-9                                                     | T04                                 |
| `04-console-csp-and-cors.md`                        | DEP-10                                                    | T05                                 |
| `05-fortbildungsbereich.md` + `06-course-detail.md` | DEP-11                                                    | T06                                 |
| `07-video-gating-and-resume.md`                     | DEP-12                                                    | T07                                 |
| `08-lernerfolgskontrolle.md`                        | DEP-13                                                    | T08                                 |
| `09-mediathek.md`                                   | DEP-14                                                    | T09                                 |
| `10-evaluation-and-efn.md`                          | DEP-15                                                    | T10                                 |
| `11-certificate-and-punktemeldung.md`               | DEP-16                                                    | T11                                 |
| `12-layout-fidelity.md`                             | DEP-17                                                    | T12                                 |
| `13-responsive-on-the-medice-page.md`               | DEP-18                                                    | T13                                 |
| `14-states-and-resilience.md`                       | DEP-19                                                    | T14                                 |
| `15-cross-browser-and-ios.md`                       | DEP-20                                                    | T15                                 |
| `17-verify-what-the-journey-produced.md`            | DEP-21                                                    | T16                                 |

The Jira descriptions carry two things these files do not, both of which exist
because a report that cannot be acted on costs a round trip:

- **the reporting format** — build and commit, exact URL, the `(Referenz: …)`
  id, expected vs actual — in DEP-5, which every ticket links back to;
- **an "Expected refusals" section per ticket**, naming the guards that look
  like defects. A refused forward seek, a locked exam, a DocCheck visitor left
  signed out: each is the product working, and each has been reported as a bug
  before.

If a case changes here, change it in Jira too. If it changes in Jira first,
bring it back — this directory is what survives the project.

---

## What this pack is weighted towards, and why

| Group               | Tickets |                                                                                                                                                                                                                                                       |
| ------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The embed**       | T01–T04 | Whether the widget is on the page, whether the physician is signed in, whether the host page and the widget leave each other alone, and what the browser console says. **Most first failures live here**, and most of them are invisible server-side. |
| **The journey**     | T05–T11 | What a physician actually does: find the Fortbildung, watch it, sit the exam, complete it, get the Teilnahmebescheinigung, learn what became of their points.                                                                                         |
| **How it holds up** | T12–T15 | Layout fidelity against the MEDICE renders, responsive behaviour on their page, loading/empty/error states, cross-browser and iOS.                                                                                                                    |
| **Data entry**      | T16–T17 | Setting the data up, and checking what the journey produced landed correctly.                                                                                                                                                                         |

**T16 runs first** — it is setup, not a test area. The admin console fills data
in; it is not the product. It gets two tickets because that is what it is worth,
and T16.0 is a hard gate that stops the whole pack.

**T04 runs alongside T05–T11**, not after. Keep devtools open on Console and
Network through the whole journey and record as you go. CSP and CORS refusals
happen between the browser and the far end and appear in **no server log** — that
console is the only place they exist.

---

## Order

```
T16 (setup, incl. the T16.0 gate)
  → T01 → T02 → T03            the widget is there, you are signed in, it is isolated
    → T05 → T06 → T07 → T08 → T09 → T10 → T11     the journey, in order
      (T04 recorded throughout)
        → T12 → T13 → T14 → T15                   how it holds up
          → T17                                    what the journey produced
```

T05–T11 build on each other and are one continuous Fortbildung run in sequence.

---

## T16.0 is a gate

Open **Verwaltung → Teilnahme → Punktemeldungen** and read the banner.

It must say **"Meldungen werden nicht übermittelt"**.

If it says otherwise, **stop and tell DigitalSpital.** Testing runs against
**ADHS Akademie adult**, which carries the real VNR `2760552025919300018` from
the ÄKWL Anerkennungsbescheid. A completion with submissions on files a test EFN
against a live accreditation at a real Ärztekammer, and a filed Punktemeldung
cannot be unfiled — only withdrawn, which leaves its own record.

Two more consequences of testing on the real course:

- **Use test EFNs.** Never a real physician's number.
- **Do not restructure ADHS Akademie adult.** The Bescheid requires changes of
  any kind be reported to the ÄKWL promptly and in writing. T16 creates its own
  course for anything structural.

---

## Two things about this site that are not defects

**There is no WordPress login for physicians.** MEDICE's theme performs its own
Keycloak sign-in and keeps the token in the session; `is_user_logged_in()` is
false for every physician. Do not look for a WordPress user, and do not report
its absence.

**A DocCheck sign-in leaves the widget signed out.** DocCheck involves no
Keycloak, so such a visitor holds no access token. The signed-out state is
correct (T02.4). Whether it is _clear enough_ to somebody who has just logged in
elsewhere is a fair question and worth your judgement — that part is a finding.

---

## How to record a result

```
**Result** ☐ pass ☐ fail ☐ blocked

**Observed**
```

Fill in **Observed** for anything that is not a clean pass: what you did, what
happened, what you expected. For ordering and state cases a screenshot alone is
rarely enough.

`blocked` means the case could not be run — a missing precondition, an earlier
case failed. It is not a failure and should not be filed as one.

**Record the build first.** The version and commit are in the console footer.
"It does not work" and "it is not on the server you are looking at" are
indistinguishable from a browser.

---

## Blocking cases

Stop and report immediately rather than finishing the ticket:

| Case  | What it would mean                                       |
| ----- | -------------------------------------------------------- |
| T02.3 | The token endpoint hands a token to the wrong session    |
| T04.4 | A full EFN or VNR password appears in a network response |
| T16.4 | A stored VNR password is retrievable                     |
| T17.2 | A full EFN is rendered anywhere                          |

---

## Expected refusals — do not file these

- **T01.1** — if `<ds-lms` is missing from view-source, the theme is not
  rendering the shortcode. Real, but it stops the pack rather than being one
  finding among many.
- **T02.4** — DocCheck leaves the widget signed out. Correct.
- **T03.3** — `document.querySelector('ds-lms').shadowRoot` returns `null`. The
  root is closed deliberately; a node coming back is the finding.
- **T07.3** — forward seeking is refused, with about 5 seconds of tolerance.
  Small nudges working is by design.
- **T11.1** — the certificate's **Anschrift** line is empty by agreement.
  Confirm it renders cleanly; do not file it.
- **T12.x** — `docs/design/README.md` records existing verdicts. A row it marks
  **deliberate** is a documented deviation. A row it marks **matches** that no
  longer does is a regression, and that _is_ a finding.

---

## German terms

The product is German. These stay German everywhere, because they appear
verbatim on the Ärztekammer's own documents:

_Lernerfolgskontrolle_ · _Teilnahmebescheinigung_ · _Punktemeldung_ ·
_Anerkennungsbescheid_ · _Ärztekammer_ · _EFN_ · _VNR_ · _Mediathek_ ·
_Evaluationsbogen_ · _Zusammenfassung_ · _Referenten_ · _Zertifizierung_ ·
_Fortbildung_ · _Fortbildungsbereich_
