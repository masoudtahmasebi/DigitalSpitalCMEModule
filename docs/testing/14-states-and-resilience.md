# T14 · Loading, empty, error and boundary states

**Assignee:** Amruth · **Surface:** MEDICE WordPress page · **Est.** 35 min

## Preconditions

- Devtools network throttling and request blocking

## Cases

### T14.1 · Loading states exist

**Steps**

1. Throttle to Slow 3G and open list, detail and player.

**Expected**

- Each shows a loading state — not a blank area, and not an empty state that then fills.

> An empty state shown before data arrives reads as 'no data'.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T14.2 · Empty and failed are distinguishable

**Steps**

1. Arrange an empty search and an empty Mediathek.
2. Then block the API and reload.

**Expected**

- Empty says it is empty and offers a way back.
- The failure says something went wrong and offers a retry.
- Neither is rendered as the other.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T14.3 · A failed write does not lose input

**Steps**

1. Block the API. Fill the Evaluationsbogen and submit. Unblock and retry.

**Expected**

- The error is reported and the typed answers survive.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T14.4 · Disabled controls say why

**Steps**

1. Find three disabled controls — a locked exam, a locked material, a blocked action.

**Expected**

- Each conveys the reason where somebody looks, not only on hover.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T14.5 · Long and awkward content

**Steps**

1. View a course with a very long title and module name in the list, sidebar and player.

**Expected**

- Nothing overlaps, escapes its container or pushes the layout sideways.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T14.6 · Slow video

**Steps**

1. Throttle hard and start a video.

**Expected**

- Buffering is communicated. The player does not appear frozen or broken.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---
