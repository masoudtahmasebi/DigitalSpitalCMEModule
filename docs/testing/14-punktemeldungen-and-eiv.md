# T14 · Punktemeldungen, EIV check and the EFN correction path

**Assignee:** Amruth · **Area:** Admin console · **Tenant:** `medice` · **Est.** 40 min

## Preconditions

- P0 confirmed — the Punktemeldungen banner reads _Meldungen werden nicht übermittelt_
- At least one queued and one failed Punktemeldung

## Cases

### T14.0 · The screen says whether it will file anything

**Steps**

1. Open Teilnahme → Punktemeldungen.
2. Read the banner at the top.

**Expected**

- It states one of two things unambiguously: submissions are being sent, or they are not.
- It names which endpoint the installation points at.
- The banner is present either way — its absence is not a third state meaning "fine".

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T14.1 · The queue is ordered by deadline

**Steps**

1. Open Teilnahme → Punktemeldungen.
2. Read the ordering.
3. Click through the status filters.

**Expected**

- Sorted by **deadline**, not creation date.
- The count of submissions due next is shown.
- Filters narrow correctly.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T14.2 · Deadlines are in German local time

**Steps**

1. Read a row's deadline.

**Expected**

- German local time, not UTC.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T14.3 · A failed row says who can fix it

**Steps**

1. Expand a failed row.
2. Read the sentence above the folded technical error.

**Expected**

- One of three sentences, and they differ: a rejected EFN is the participant's and explicitly **not** the operator's; a rejected event points at the course's VNR; rejected credentials point at the VNR password.
- A row that failed before this existed has **no** sentence — correct, not a gap.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T14.4 · No full EFN in the queue

**Steps**

1. Search the screen, DOM and API responses.

**Expected**

- Never in full. At most the last four digits.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T14.5 · Support cannot set another person's EFN

**Steps**

1. Spend one minute looking for any way to change a participant's EFN from the console.

**Expected**

- There is none.

> This is correct and must stay so. If you find a route, that is a **blocking** finding.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T14.6 · Requeue adopts a corrected EFN when nothing was reported

**Steps**

1. Take a submission that was never accepted (queued, abgebrochen, retryable).
2. Have the participant correct their EFN in the portal.
3. Use **erneut einreihen**.

**Expected**

- It re-queues and carries the corrected EFN.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T14.7 · Requeue is refused after acceptance if the EFN changed

**Steps**

1. Take a submission that **was** accepted.
2. Change the participant's EFN.
3. Use **erneut einreihen**.

**Expected**

- It is **refused**, with a sentence saying to cancel the existing Punktemeldung or contact the Ärztekammer.

> **If this silently succeeds, stop and report immediately.** Re-filing under a different EFN credits the points to a second person and nothing can take them back off the first. This is the worst outcome in the pack.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T14.8 · EIV-Abgleich reports the accreditation window

**Steps**

1. Angebot → Fortbildungen → a course with a VNR → **EIV-Abgleich**.
2. Record the accredited period, Punkte Basis and Punkte Lernerfolg.

**Expected**

- All three values are returned.

> Record the two point values even if they are 0 — especially then. They answer an open question that would otherwise need a letter to the Ärztekammer.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

## Attach to the report

- A screenshot of the EIV-Abgleich result from T14.8, complete.
- The refusal message from T14.7, verbatim.
