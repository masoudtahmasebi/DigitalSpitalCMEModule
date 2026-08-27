# T11 · Teilnahmebescheinigung and Punktemeldung

**Assignee:** Amruth · **Surface:** MEDICE WordPress page · **Est.** 30 min

## Preconditions

- T10 passed — the course is complete
- The Muster from the Anerkennungsbescheid for field comparison

## Cases

### T11.1 · Every mandatory field is populated

**Steps**

1. Download the certificate.
2. Check against the Muster: Veranstalter, title, date, participant name, VNR, Landesärztekammer, Kategorie, points, EFN, stamp, signature.

**Expected**

- All present and non-empty.
- The **Anschrift** line is empty by agreement — confirm it renders cleanly and do not file it.

> Name any empty mandatory field exactly. Per the Muster, a certificate with one is invalid.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T11.2 · Both barcodes

**Steps**

1. Look for Code 39 and Datamatrix renderings of the VNR.

**Expected**

- Both present, both scanning to the VNR.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T11.3 · Stable, printable, correct glyphs

**Steps**

1. Download twice. Open print preview. Check ä ö ü ß.

**Expected**

- Identical file, fits the page, glyphs correct.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T11.4 · The Punktemeldung panel tells the truth

**Steps**

1. Return to the completion screen and find the **Punktemeldung** panel.
2. Record its exact German.

**Expected**

- Present for a points-bearing course.
- Its tense matches reality — _werden gemeldet_ in flight, _wurden gemeldet_ once accepted.
- It does not claim the points were reported when they were not.

> The German is a deliverable — MEDICE has not signed it off. Copy it verbatim from every state you reach.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T11.5 · The EFN field appears only for an EFN rejection

**Steps**

1. Note which state produced any EFN field offered.

**Expected**

- Offered **only** when the Ärztekammer rejected the EFN itself.
- For any other failure the physician is told it is being handled and is not asked to touch their EFN.

> A physician cannot fix a blocked VNR. Being asked to try is worse than being told nothing.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

## Attach to the report

- The certificate PDF.
- The verbatim German from every Punktemeldung state reached.
