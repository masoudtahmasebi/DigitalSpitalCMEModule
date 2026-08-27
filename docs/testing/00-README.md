# CME module — test pack

**Assignee:** Amruth — this document and every ticket in this folder.
**Tenant under test:** `medice`
**Build:** record the commit from `GET /health` on the API before you start.

17 files. Each is a standalone ticket of numbered cases with steps, expected
results and a pass/fail line. T01–T08 are the learner path and run in order —
done in sequence they are one continuous Fortbildung rather than eight setups.
T09–T16 are the admin console and are independent.

---

## P0 · Before the first case

**`EIV_WORKER_ENABLED=no` must be set on the host.**

```bash
grep '^EIV_WORKER_ENABLED=' ~/ds-education/config.env
```

It must print `EIV_WORKER_ENABLED=no`. If it does not, stop and get it set.

Testing on `medice` means testing against **ADHS Akademie adult**, which carries
the real VNR `2760552025919300018` from the ÄKWL Anerkennungsbescheid. Every
completion queues a Punktemeldung against that live accreditation. With the
worker off, nothing leaves the platform and the queue is still exercised — which
is what T14 tests. With it on, a test EFN is filed against a real accredited
event at a real Ärztekammer.

Two further consequences of using the real course, neither of which is
negotiable by a tester:

- **Use test EFNs.** Never a real physician's number.
- **Do not restructure ADHS Akademie adult.** The Bescheid requires changes of
  any kind be reported to the ÄKWL promptly and in writing — editing questions,
  reordering modules or changing points is such a change. T09–T12 therefore
  create their own course. Read a ticket's preconditions before starting it.

---

## How to record a result

Each case ends with:

```
**Result** ☐ pass ☐ fail ☐ blocked

**Observed**
```

Fill in **Observed** on anything that is not a clean pass — what you did, what
happened, what you expected. A screenshot alone is rarely enough for a case
about ordering or state.

`blocked` means the case could not be run (missing precondition, an earlier case
failed). It is not a failure and should not be filed as one.

---

## Cases marked blocking

Five cases say **blocking** in their note. Stop and report those immediately
rather than continuing the ticket:

| Case  | What it would mean                                            |
| ----- | ------------------------------------------------------------- |
| T12.2 | A stored VNR password is retrievable                          |
| T13.1 | A full EFN is rendered anywhere                               |
| T14.5 | Support can set another person's EFN                          |
| T14.7 | A Punktemeldung re-files under a changed EFN after acceptance |
| T16.2 | An invitation link works twice                                |
| T10.6 | An already-recorded exam result changed                       |

T14.7 is the sharpest: it would credit CME points to a second physician, and
nothing in the platform can take them back off the first.

---

## Expected refusals

Several cases assert that the product **refuses** something. Those are not
defects and should be recorded as passes:

- **T03.3** — forward seeking stops at what has been watched, plus about five
  seconds of tolerance. Small nudges working is by design; dragging to the end
  must be refused.
- **T12.3** — a malformed VNR is accepted. The check-digit rule is unconfirmed
  by the Ärztekammer, and a guessed rule would refuse a legitimate number from
  another Kammer. Record what happens; do not file it.
- **T14.5** — there is no way to set another person's EFN, and there should not
  be.
- **T14.7** — requeue refuses after acceptance if the EFN changed.
- **T07.1** — the certificate's **Anschrift** line is empty by agreement. Confirm
  it renders cleanly; do not file it.

---

## German terms

The product is German. These stay in German everywhere, including in an English
console, because they appear verbatim on the Ärztekammer's own documents:

_Lernerfolgskontrolle_ · _Teilnahmebescheinigung_ · _Punktemeldung_ ·
_Anerkennungsbescheid_ · _Ärztekammer_ · _EFN_ · _VNR_ · _Mediathek_ ·
_Evaluationsbogen_ · _Zusammenfassung_ · _Referenten_ · _Zertifizierung_

Any **other** German string on an English console screen is a finding (T15.5).
