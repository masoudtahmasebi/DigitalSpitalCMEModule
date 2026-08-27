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

## New since the last pack — why a certificate was undeliverable

**unzustellbar** used to be the whole story, and **Erneut senden** was offered
on every such row — for two of the three causes it could only fail again.

11. Find a certificate with status **unzustellbar** (or ask us to arrange one).
12. Read the sentence under the status.
13. Look at whether **Erneut senden** is available.

### Expected

- Step 12: a sentence naming the next step — no address on file, an address the
  server refused, or repeated temporary failures pointing you at the platform's
  SMTP settings.
- Step 13: the button is **greyed out** for the first two, and **available** for
  the third. Resending to an address that does not exist, or to one that was
  permanently refused, cannot succeed and should not be offered.

A row that failed before this was built may show no sentence. That is correct
rather than a gap — the reason was not kept back then.

## Please report with

A screenshot of the participant list **with names blacked out** — it is enough
to see which columns exist.
