# 07 · Teilnahmebescheinigung (certificate PDF)

**Assignee: Philipp Burka**
**Area:** Participant portal · **Duration:** approx. 25 minutes

## Goal

Check that the generated certificate matches what the Ärztekammer requires in
its Muster. This is the document a physician keeps and produces if asked.

## Prerequisites

- A completed test course (tickets 03, 04, 06 done)
- The Teilnahmebescheinigung Muster from the Anerkennungsbescheid, for comparison

## Steps

1. Download the certificate.
2. Go through the PDF **against the Muster** and tick off field by field:
   - Veranstalter
   - course title
   - date
   - participant's name
   - **VNR**
   - the recognising Landesärztekammer
   - Kategorie
   - number of points
   - EFN
   - stamp and signature of the wissenschaftliche Leitung
3. Check that the **VNR appears as a barcode** (Code 39 and Datamatrix).
4. Print it, or use print preview. Does everything fit on the page?
5. Download it a second time. Is it the same document?
6. Check that umlauts and `ß` render correctly.

## Expected

- Every field from step 2 is present and populated.
- The certificate is issued **on completion** and does not wait for the
  Punktemeldung — that is decided.

## Pay particular attention to

- **If a field is missing or empty**, please name exactly which. Per the Muster,
  a certificate with an empty mandatory field is invalid.
- The **"Anschrift"** line stays empty — this is agreed, because we do not
  collect the address. Please do **not** report it as a defect, but do confirm
  the line looks cleanly empty rather than like a rendering fault.
- Does the **name** appear as the physician entered it?

## Please report with

The PDF itself, and a ticked-off list of the fields from step 2.
