# T11 · Media library

**Assignee:** Amruth · **Area:** Admin console · **Tenant:** `medice` · **Est.** 25 min

## Preconditions

- Console access on `medice`
- At least one video, image and PDF uploaded

## Cases

### T11.1 · Filters and search

**Steps**

1. Open Angebot → Mediathek.
2. Click through the file-type filters.
3. Search a file name.

**Expected**

- Filters and search both narrow the list correctly.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T11.2 · Rename saves on blur, not per keystroke

**Steps**

1. Rename a file.
2. Reload.

**Expected**

- The name persists.
- The value is not replaced under the cursor while typing.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T11.3 · Previews are useful

**Steps**

1. Preview a video, an image and a PDF.

**Expected**

- Each preview identifies the file without downloading it.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T11.4 · Usage count and protected deletion

**Steps**

1. Read the usage count on a file used by a course.
2. Attempt to delete it.
3. Delete an unused file.

**Expected**

- The count is shown.
- Deletion of the in-use file is **blocked**, and the reason names the number of uses.
- The unused file deletes.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T11.5 · Reuse from a course form

**Steps**

1. While creating a course, use **Aus Mediathek wählen** for a video.

**Expected**

- The picker works before the course has been saved.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

## Attach to the report

- Whether total storage used is displayed.
