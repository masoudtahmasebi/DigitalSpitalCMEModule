# 10 · Creating and changing a Lernerfolgskontrolle

**Assignee: Philipp Burka**
**Area:** Admin console · **Duration:** approx. 35 minutes

## Goal

Check that an exam can still be changed after someone has sat it — and that
nothing needed as evidence is lost in the process.

> **Note:** until recently this was impossible — a single recorded answer froze
> the exam permanently. That has been changed. This ticket tests the change, so
> please be thorough.

## Prerequisites

- A test course in the `ds` tenant
- **Run this ticket only after the next deployment.** Before that the console
  still shows the old behaviour.

## Steps

1. Create a Lernerfolgskontrolle in a module.
2. Create three questions: one with **one** correct answer, one with
   **several**, one incomplete.
3. Try to save while a question has **no** correct answer. What happens?
4. On a "one correct answer" question, mark **two** options correct. Save.
5. Reorder the questions. Save. Reload — is the order right?
6. Delete a question **nobody** has answered yet.
7. **Now sit the exam as a participant** (different browser or private window),
   so that answers are recorded.
8. Back in the console. Does the answered question now carry a marker
   ("In Verwendung", "1 Antwort erfasst")?
9. **Remove that answered question.** What does the confirmation dialog say?
10. Save. Has the question gone from the exam?
11. Look for a statement of **how many questions were removed**.
12. As a participant, open the exam again: is the removed question still asked?
13. Look at the affected participant: **is their earlier result still there?**

## Expected

- Steps 3 and 4: both refused, with a message naming the question.
- Step 9: the dialog says the question will **not be deleted but removed from
  the exam**, and that submitted attempts keep their result.
- Step 11: it says questions were removed and why they are kept on record.
- Step 12: the removed question is **no longer asked**.
- Step 13: **the earlier result is unchanged.** This is the most important point
  in this ticket.

## Pay particular attention to

Step 13. If an already-achieved result changes afterwards, that is **blocking**
and should be reported immediately — a CME point depends on it.

## Please report with

Screenshots of the confirmation dialog from step 9 and of the notice from
step 11.
