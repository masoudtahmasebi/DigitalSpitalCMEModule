# 14 · Punktemeldungen and the EIV check

**Assignee: Philipp Burka**
**Area:** Admin console · **Duration:** approx. 25 minutes

## Goal

Check that an operator can see at any time which Punktemeldungen are pending,
which have failed, and how much time remains. A statutorily reportable CME point
hangs on that deadline.

> **Please read 00-README first.** Reporting to the Ärztekammer is currently
> **refused**, because the interface holds a one-day accredited period for our
> VNR. This is known and has been raised. **This ticket tests the screens, not
> the reporting.**

## Steps

1. Open **Teilnahme → Punktemeldungen**.
2. Look at the list. What is it sorted by?
3. Click through the status filters (queued, failed, submitted …).
4. Check whether the top states **how many submissions are due next**.
5. Look at a row: is the **deadline** shown — and in which time zone?
6. Expand the error text on a failed submission. Is it readable?
7. **Check whether a full EFN appears anywhere.**
8. Page through, if there is more than one page.
9. **Angebot → Fortbildungen →** a course with a VNR → run **EIV-Abgleich**.
10. In the result, look up and note down:
    - the **accredited period** (from / to)
    - **Punkte Basis**
    - **Punkte Lernerfolg**

## Expected

- Step 2: sorted by **deadline**, not by creation date — the most urgent row is
  at the top.
- Step 5: German local time, not UTC.
- Step 7: **never in full.** At most the last four digits.

## Step 10 is the most valuable one here

The two point values from step 10 answer an open question that would otherwise
need a letter to the Ärztekammer. Please **note both numbers and send them
back** — even if they are 0, especially then.

The accredited period likewise: if it shows the same day twice, that confirms
the finding already reported.

## Please report with

A screenshot of the EIV-Abgleich result from steps 9/10 — complete, with all
numbers.
