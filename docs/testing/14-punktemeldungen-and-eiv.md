# 14 · Punktemeldungen and the EIV check

**Assignee: Philipp Burka**
**Area:** Admin console · **Duration:** approx. 35 minutes

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
   6a. **New — look above that folded error.** On a failed row there should now be
   a plain sentence saying _what the Ärztekammer said_ and **who can fix it**.
   Read it. Does it tell you what to do next, or only what went wrong?
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
- Step 6a: one of three sentences, and they say **different** things — a
  rejected EFN is the participant's to fix and explicitly **not yours**; a
  rejected event points you at the course's VNR; rejected credentials point you
  at the VNR password. A row that failed before this was built has **no**
  sentence, and that is correct — we did not keep the answer back then and will
  not invent one now.
- Step 7: **never in full.** At most the last four digits.

## New since the last pack — the EFN correction path

This is the sequence support will actually be asked to perform, and it has a
deliberate refusal in it.

11. Find a participant whose Punktemeldung failed (or ask us to arrange one).
12. **Try to find a way to change their EFN in the console.** Spend a minute on
    it and then stop.
13. Open **Teilnahme → Teilnehmende**, find the row, and use **erneut
    einreihen**.

### Expected

- Step 12: **there is no way, and there should not be.** An EFN is a
  physician's identifier at their Kammer; support cannot see or set another
  person's. The participant corrects it themselves, in the portal. If you find
  a route that lets you set somebody else's EFN, that is a finding and an
  urgent one.
- Step 13, on a submission that was **never accepted**: it re-queues, and it
  picks up the participant's corrected EFN if they have supplied one.
- Step 13, on a submission that **was accepted** and whose EFN has since
  changed: it is **refused**, with a sentence telling you to cancel the existing
  Punktemeldung or contact the Ärztekammer. That refusal is correct. Re-filing
  under a different EFN would credit the points to a second person, and nothing
  in the platform can take them back off the first.

**If step 13 silently succeeds in that second case, stop and report it
immediately.** It is the one failure in this pack that puts points on the wrong
physician's record.

## Step 10 is the most valuable one here

The two point values from step 10 answer an open question that would otherwise
need a letter to the Ärztekammer. Please **note both numbers and send them
back** — even if they are 0, especially then.

The accredited period likewise: if it shows the same day twice, that confirms
the finding already reported.

## Please report with

A screenshot of the EIV-Abgleich result from steps 9/10 — complete, with all
numbers.
