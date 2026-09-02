# T15 · Cross-browser and iOS

**Assignee:** Amruth · **Surface:** MEDICE WordPress page · **Est.** 45 min

## Preconditions

- Chrome, Firefox and Safari
- An iPhone if one is available

## Cases

### T15.1 · Video plays everywhere

**Steps**

1. Play a course video in each browser.

**Expected**

- Playback works in all three.

> Safari is the one to watch: strictest about codecs and Range requests, and it is what a physician on an iPhone or a Mac uses.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T15.2 · Gating behaves identically

**Steps**

1. Repeat T07.3 and T07.5 in each browser.

**Expected**

- Same behaviour in all three.

> A browser where forward seeking is **allowed** is the highest-value finding in this ticket.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T15.3 · The certificate opens

**Steps**

1. Download and open it in each browser.

**Expected**

- Renders identically, barcodes included.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T15.4 · Fonts and umlauts

**Steps**

1. Compare headings and body text; check ä ö ü ß.

**Expected**

- The intended font loads. No fallback glyphs.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T15.5 · iOS

**Steps**

1. On an iPhone: play a video, take an exam, download the certificate.

**Expected**

- Video plays inline, or if it forces fullscreen, progress is still recorded.
- The certificate is usable on the device.

> Mark `blocked` if no device is available. Do not simulate — the simulator does not reproduce iOS media behaviour.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

## Attach to the report

- A grid: case × browser × pass/fail, with versions.
