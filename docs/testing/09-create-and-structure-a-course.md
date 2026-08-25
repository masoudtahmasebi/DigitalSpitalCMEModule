# 09 · Creating and structuring a course

**Assignee: Philipp Burka**
**Area:** Admin console · **Duration:** approx. 40 minutes

## Goal

Check that a course can be built from nothing without guessing what a field
means.

## Prerequisites

- Console access with a role permitted to create courses
- **Please work in the `ds` tenant**, not on the accredited MEDICE course
  (see 00-README)

## Steps

1. **Angebot → Fortbildungen → Neue Fortbildung.** Create it.
2. Check: is the new course a **draft**? Is it invisible in the portal?
3. Create a Modul, a Kapitel inside it, and a video inside that.
4. Upload a video. Set duration, poster and subtitles.
5. Check whether there is a field for the **Zusammenfassung** — the text shown
   in the player beneath the video.
6. Create a second Modul with a Kapitel and content.
7. **Reorder** modules and Kapitel (arrows). Does the order survive a reload?
8. Delete a Kapitel that is still empty.
9. Try to **publish** while mandatory fields are missing.
10. Check in the portal that it is now visible.

## Expected

- Step 2: new courses are **always** drafts.
- Step 5: the field exists, is labelled **Zusammenfassung**, and carries a hint
  saying where the text appears. If no such field can be found, please report it
  — that was a finding recently.
- Step 9: publishing is **refused** while anything is missing, and the refusal
  **names what is missing**.

## Pay particular attention to

- Does every field say what it is for? Please list any field whose label alone
  was not enough.
- Are you warned when leaving without saving?

## Please report with

A list of the fields whose meaning was not clear from the label.
