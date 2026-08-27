# T05 · Mediathek for participants

**Assignee:** Amruth · **Area:** Learner widget · **Tenant:** `medice` · **Est.** 15 min

## Preconditions

- A course with at least two materials, one gated on progress

## Cases

### T05.1 · A locked material names its condition

**Steps**

1. Open the Mediathek tab before watching anything.
2. Click a locked material.

**Expected**

- The lock names the condition to satisfy, not merely the state.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T05.2 · Released material downloads

**Steps**

1. Satisfy the condition and return.
2. Download the material.

**Expected**

- The download starts and the file opens correctly.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T05.3 · Cards are identifiable

**Steps**

1. Read each card.

**Expected**

- File kind (PDF, video, image) is identifiable from the card.
- Note any card with no descriptive text at all.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T05.4 · Narrow viewport

**Steps**

1. View the Mediathek at phone width.

**Expected**

- The grid reflows. No horizontal scrolling.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

## Attach to the report

- Screenshot of the grid, wide and narrow.
