# T09 · Authoring: create and structure a course

**Assignee:** Amruth · **Area:** Admin console · **Tenant:** `medice` · **Est.** 35 min

## Preconditions

- Console access on `medice` with an authoring role
- **Create a new test course. Do not restructure ADHS Akademie adult** — the Bescheid requires changes of any kind be reported to the ÄKWL in writing.

## Cases

### T09.1 · New courses are drafts

**Steps**

1. Angebot → Fortbildungen → Neue Fortbildung. Create it.
2. Check the portal.

**Expected**

- Status is draft.
- It is invisible to participants.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T09.2 · Three-level structure

**Steps**

1. Create a Modul, a Kapitel inside it, and a video inside that.
2. Create a second Modul with content.

**Expected**

- All three levels save and reload correctly.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T09.3 · Video fields

**Steps**

1. Upload a video. Set duration, poster and subtitles.
2. Locate the **Zusammenfassung** field — the text shown under the video in the player.

**Expected**

- All fields save.
- The Zusammenfassung field exists, is labelled, and carries a hint saying where the text appears.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T09.4 · Ordering survives

**Steps**

1. Reorder modules and Kapitel.
2. Save and reload.

**Expected**

- The order is as left.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T09.5 · Publishing refuses an incomplete course

**Steps**

1. Attempt to publish with mandatory fields missing.

**Expected**

- Refused, and the refusal **names what is missing**.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T09.6 · Unsaved changes

**Steps**

1. Edit a field and navigate away without saving.

**Expected**

- You are warned.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

## Attach to the report

- A list of any field whose label alone did not say what it was for.
