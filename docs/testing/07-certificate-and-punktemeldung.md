# T07 · Teilnahmebescheinigung and Punktemeldung state

**Assignee:** Amruth · **Area:** Learner widget · **Tenant:** `medice` · **Est.** 30 min

## Preconditions

- T06 passed — the course is complete
- The Muster from the Anerkennungsbescheid, for field comparison

## Cases

### T07.1 · Every mandatory field is populated

**Steps**

1. Download the certificate.
2. Check field by field against the Muster: Veranstalter, course title, date, participant name, VNR, recognising Landesärztekammer, Kategorie, points, EFN, stamp, signature.

**Expected**

- Every field is present and non-empty.
- The **Anschrift** line is empty by agreement — confirm it renders cleanly rather than as a fault, and do not file it.

> Name any empty mandatory field exactly. Per the Muster a certificate with one is invalid.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T07.2 · The VNR appears as both barcodes

**Steps**

1. Inspect the certificate for Code 39 and Datamatrix renderings of the VNR.

**Expected**

- Both are present and scan to the VNR.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T07.3 · The certificate is stable and prints

**Steps**

1. Download it a second time.
2. Open print preview.
3. Check umlauts and ß.

**Expected**

- Identical document.
- Fits the page.
- Umlauts and ß render correctly.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T07.4 · The participant is told the Punktemeldung state

**Steps**

1. Return to the completion screen.
2. Locate the **Punktemeldung** panel.
3. Record its exact German wording.

**Expected**

- The panel is present for a points-bearing course.
- Its tense matches reality: _werden gemeldet_ while in flight, _wurden gemeldet_ once accepted.
- It does **not** claim the points were reported while the Punktemeldungen list says otherwise.

> The German wording is a deliverable — MEDICE has not signed it off. Copy it verbatim from every state you can reach.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T07.5 · The EFN field is offered only for an EFN rejection

**Steps**

1. If the panel offers an EFN field, note which state produced it.
2. For any other failure state, check whether an EFN field is offered.

**Expected**

- The field appears **only** when the Ärztekammer rejected the EFN itself.
- For any other failure the participant is told it is being handled and is not asked to touch their EFN.

> A participant cannot fix a blocked VNR. Being asked to try is worse than being told nothing.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

## Attach to the report

- The certificate PDF.
- The verbatim German from each Punktemeldung state reached.
