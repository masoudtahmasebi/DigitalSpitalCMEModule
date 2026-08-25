# 13 · Participants and issued certificates

**Assignee: Philipp Burka**
**Area:** Admin console · **Duration:** approx. 25 minutes

## Goal

Check that an operator can see who has got how far — without seeing more
personal data than they need.

## Prerequisites

- At least one participant with progress (from tickets 03–07)

## Steps

1. Open **Teilnahme → Teilnehmende**.
2. Look at the list: what is shown?
3. **Check whether a full EFN is visible anywhere.**
4. Open a participant. Look at progress, attempts, completion.
5. Deactivate a participant and reactivate them.
6. Open **Teilnahme → Bescheinigungen**.
7. View and download an issued certificate.
8. Filter by course and by date range.
9. Produce a CSV export if offered, and open it in Excel.
10. Check that umlauts survive the export.

## Expected

- Step 3: **nowhere.** The EFN appears at most shortened (last four digits). A
  full EFN in a list is **blocking** and should be reported at once — it is a
  national identifier for a named person.
- Step 7: the downloaded certificate is the same one the participant gets.

## Pay particular attention to

Steps 9 and 10. An export with broken umlauts gets sent back by finance and is
then a process problem, not a display problem.

## Please report with

A screenshot of the participant list **with names blacked out** — it is enough
to see which columns exist.
