# T07 · Video: gating, seeking and resume

**Assignee:** Amruth · **Surface:** MEDICE WordPress page · **Est.** 45 min

## Preconditions

- A video of at least 2 minutes
- Watch requirement is **100 %** — the configured value, not a fault

## Cases

### T07.1 · Progress counts each second once

**Steps**

1. Watch 60 s. Note the percentage.
2. Rewind and re-watch the same 60 s. Note it again.

**Expected**

- It does not increase for the re-watch.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T07.2 · Progress survives reload and leaving the page

**Steps**

1. Pause and note the percentage.
2. Reload.
3. Navigate away to another MEDICE page and come back.

**Expected**

- Unchanged after both.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T07.3 · Forward seeking is refused

**Steps**

1. Play to about 30 s.
2. Drag the slider to the far right.
3. Note where it lands.

**Expected**

- It stops at roughly what has been watched plus about 5 s of tolerance.
- It does **not** reach the end.

> The tolerance is deliberate so small nudges work; dragging to the end must be refused. Record both numbers: where you were, where you landed.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T07.4 · Backwards seeking still works

**Steps**

1. Drag back to 5 s.

**Expected**

- It moves there.

> Control case. A player refusing every seek would pass T07.3 and be worse.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T07.5 · Resume returns to the last whole minute

**Steps**

1. Watch past 3 minutes and pause at a position with seconds on it, e.g. 3:34.
2. Close the tab. Reopen the MEDICE page and return to the video.

**Expected**

- It opens at the last whole **minute** — 3:00 for 3:34 — not 0:00 and not 3:34.

> Report the exact pause and resume positions.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T07.6 · A gap is named and clears

**Steps**

1. Watch with a deliberate gap.
2. Read the notice.
3. Watch the named passage.

**Expected**

- The notice names a time span and clears once closed — note whether immediately or after reload.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T07.7 · Controls

**Steps**

1. Exercise volume, speed, fullscreen and picture-in-picture.

**Expected**

- Each works. None resets the playhead.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

## Attach to the report

- For T07.3 and T07.5, the exact before/after positions in seconds.
