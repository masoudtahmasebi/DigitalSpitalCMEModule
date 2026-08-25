# 03 · Video playback, progress and resuming

**Assignee: Philipp Burka**
**Area:** Participant portal · **Duration:** approx. 40 minutes

## Goal

Check that progress is counted correctly, stored reliably and presented
comprehensibly. This is the core of the accreditation: awarding points depends
on the material having been **seen**.

## Prerequisites

- A test course with at least one video of 2+ minutes
- **Note:** the requirement is set to **100 % watched**. That is decided, not a
  misconfiguration.

## Steps

1. Start a video and watch **one minute**. Note the percentage.
2. Pause. **Reload** the page. Is the percentage still there?
3. Watch through to the end. What does the screen say now?
4. **Try to skip forward** — drag the slider to the right, past what you have
   watched. What happens?
5. **Rewind** and re-watch a passage. Does the percentage change?
6. Deliberately watch with a gap (skip a section, if possible). Does a notice
   appear naming **which passages are missing**?
7. If such a notice appears: seek to the passage it names and watch it. **Does
   the notice disappear?**
8. Close the tab, reopen it, return to the course. Where do you land?
9. Try volume, playback speed, fullscreen and picture-in-picture.

## Expected

- Steps 2 and 8: progress survives a reload and a tab change.
- Step 4: skipping forward is possible **up to what has already been watched**
  and no further. The locked remainder is visible on the slider.
- Step 5: re-watching does **not** change the percentage — each second counts
  once.
- Step 7: the notice disappears once the gap is closed.

## Background, so the observation can be placed

Progress is the **union of the passages actually watched**, not the furthest
position reached. Skipping leaves a hole the percentage never fills. The slider
limit is therefore a courtesy, not the safeguard — even without it, no point
could be obtained unearned.

## Pay particular attention to

**Steps 6 and 7 are the most important.** Please record precisely: which time
span is named? Does the notice clear after catching up — immediately, after a
reload, or not at all?

## Please report with

A screenshot showing the percentage **and** the slider, plus the exact wording
of any gap notice.
