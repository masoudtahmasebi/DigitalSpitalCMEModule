# T05 · The Fortbildungsbereich (course list)

**Assignee:** Amruth · **Surface:** MEDICE WordPress page · **Est.** 25 min

## Preconditions

- Signed in via MEDICE (T02 passed)

## Cases

### T05.1 · The list renders as drawn

**Steps**

1. Compare against `docs/design/screens/page-01.png`.
2. Check hero, CME seal, filter row, cards.

**Expected**

- Every element the layout draws is present.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T05.2 · A card says what it is offering

**Steps**

1. Read a course card.

**Expected**

- CME points and duration are both readable from the card.
- Thema and Altersgruppe are visible.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T05.3 · Filters and search

**Steps**

1. Use the Thema and Altersgruppe filters.
2. Search a term matching nothing.

**Expected**

- Filters narrow the list.
- The empty result says so and offers a way back — it is not a blank area.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T05.4 · Progress is visible on a course already started

**Steps**

1. After starting a course (T07), return here.

**Expected**

- The card reflects progress rather than showing the course as untouched.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---
