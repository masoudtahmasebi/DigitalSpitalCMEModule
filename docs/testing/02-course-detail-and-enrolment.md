# T02 · Course detail and enrolment

**Assignee:** Amruth · **Area:** Learner portal · **Tenant:** `medice` · **Est.** 25 min

## Preconditions

- T01 passed
- Signed in on `medice`

## Cases

### T02.1 · All four tabs load

**Steps**

1. Open ADHS Akademie adult.
2. Open Übersicht, Experten/Referenten, Zertifizierung, Mediathek in turn.

**Expected**

- Each tab renders without an error state.
- No tab is empty without saying why it is empty.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T02.2 · Kapitel are visibly subordinate to a Modul

**Steps**

1. On Übersicht, read the structure list.

**Expected**

- Kapitel are nested under their Modul, not a flat list of equals.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T02.3 · Zertifizierung states every condition

**Steps**

1. Open the Zertifizierung tab.
2. List the conditions it names.

**Expected**

- Video content watched, Lernerfolgskontrolle, Evaluationsbogen and EFN are all named.
- The percentages shown are the course's own values, not hardcoded text.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T02.4 · The player screen has an address

**Steps**

1. Start the course and open a video.
2. Copy the URL from the address bar.
3. Open it in a new tab.

**Expected**

- The new tab lands on the same content, not the course start page.
- Browser Back returns within the course rather than leaving it.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T02.5 · Module numbering agrees between sidebar and heading

**Steps**

1. Open each module in turn.
2. Compare the number in the sidebar with the number above the content.

**Expected**

- They match for every module.

> Screenshot both together if they differ — this has regressed before.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

## Attach to the report

- Screenshot of the module overview.
