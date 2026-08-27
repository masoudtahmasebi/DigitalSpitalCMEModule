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

## New since the last pack — the participant is told about their Punktemeldung

Until now the completion screen ended with _"Die Punkte werden an die
Ärztekammer gemeldet."_ — a promise, in the future tense, shown for ever and
never withdrawn when the reporting failed. A physician could hold a certificate
saying four points and have none.

There is now a **Punktemeldung** panel under that message.

11. On the completion screen, look for the **Punktemeldung** panel.
12. Read what it says. Note the wording verbatim — this is copy about somebody's
    CME points and MEDICE has not signed it off yet.
13. If the panel offers an **EFN field**, try correcting the number.

### Expected

- Step 11: the panel appears for a course that awards points, and **not at all**
  for one that does not — a course with no Punktemeldung has nothing to report.
- Step 12: the tense matches reality. _Werden gemeldet_ while it is in flight;
  _wurden gemeldet_ once accepted. If the screen claims the points were reported
  when the Punktemeldungen list says otherwise, that is a finding.
- Step 13: the field appears **only** when the Ärztekammer rejected the EFN
  itself. For any other failure the participant is told it is being dealt with
  and is **not** asked to touch their EFN — they cannot fix a blocked VNR, and
  asking them to try is worse than saying nothing.

**The wording is the deliverable here.** Please copy the exact German out of
each state you can reach and send it back, so MEDICE can approve or rewrite it
before launch.

## Please report with

The PDF itself, and a ticked-off list of the fields from step 2.
