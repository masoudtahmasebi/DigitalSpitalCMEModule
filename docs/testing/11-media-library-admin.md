# 11 · Mediathek in the console

**Assignee: Philipp Burka**
**Area:** Admin console · **Duration:** approx. 20 minutes

## Goal

Check that uploaded files stay findable and reusable — and that nothing still in
use can be deleted.

## Prerequisites

- At least three uploaded files of different kinds (video, image, PDF)

## Steps

1. Open **Angebot → Mediathek**.
2. Click through the file-type filters.
3. Search for a file name.
4. Rename a file. Reload — did the name stick?
5. Set alt text on an image.
6. Open a preview: video, image and PDF, one each.
7. Check whether each file shows **how many courses use it**.
8. Delete a file that is **still in use**. What happens?
9. Delete an unused file.
10. When adding a video to a course, use **"Aus Mediathek wählen"**.
11. Check whether total storage used is shown.

## Expected

- Step 4: the name saves on leaving the field, not on every keystroke.
- Step 8: deletion is **blocked**, and the reason names the number of uses.
- Step 10: selection works even while the course is still being created.

## Pay particular attention to

Is the preview actually useful — can you tell it is the right video without
downloading it?

## Please report with

A screenshot of the Mediathek with filters and usage counts visible.
