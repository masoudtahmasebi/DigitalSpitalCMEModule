# T03 · Video progress, seeking and resume

**Assignee:** Amruth · **Area:** Learner widget · **Tenant:** `medice` · **Est.** 40 min

## Preconditions

- T02 passed
- A video of at least 2 minutes
- Watch requirement is **100 %** — that is the configured value, not a fault

## Cases

### T03.1 · Progress is the union of what was watched

**Steps**

1. Play 60 seconds. Note the percentage.
2. Rewind and re-watch the same 60 seconds.
3. Note the percentage again.

**Expected**

- The percentage does **not** increase for the re-watch — each second counts once.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T03.2 · Progress survives reload and tab close

**Steps**

1. Pause mid-video and note the percentage.
2. Reload (F5).
3. Close the tab, reopen the portal, return to the course.

**Expected**

- The percentage is unchanged after both.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T03.3 · Forward seeking is refused

**Steps**

1. Play to roughly 30 seconds.
2. Drag the progress slider to the far right.
3. Note where the playhead lands.

**Expected**

- The playhead stops at approximately what has been watched, plus about 5 seconds of tolerance.
- It does **not** reach the end.

> The tolerance is deliberate, so small nudges work. Dragging to the end is what must be refused. Report the two numbers: where you were, where you landed.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T03.4 · Backwards seeking still works

**Steps**

1. From the same position, drag the slider back to 5 seconds.

**Expected**

- The playhead moves there.

> Control case. A player that refused every seek would pass T03.3 and be worse — re-watching is legitimate.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T03.5 · Resume returns to the last whole minute

**Steps**

1. Watch past 3 minutes, pause at a position with seconds on it (e.g. 3:34).
2. Close the tab.
3. Reopen and return to the same video.

**Expected**

- Playback opens at the last whole **minute** — 3:00 for 3:34 — not at 0:00 and not at 3:34.

> Flooring to the minute is the rule. Report the exact pause position and the exact resume position.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T03.6 · A gap is named and clears when closed

**Steps**

1. Watch with a deliberate gap.
2. Read any notice naming the missing passage.
3. Seek back to that passage and watch it.

**Expected**

- The notice names a time span.
- It clears once the gap is closed — note whether immediately or only after reload.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T03.7 · Player controls

**Steps**

1. Exercise volume, playback speed, fullscreen, picture-in-picture.

**Expected**

- Each works and none resets the playhead.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

## Attach to the report

- Screenshot showing the percentage and the slider together.
- For T03.3 and T03.5: the exact before/after positions in seconds.
