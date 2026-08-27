# T22 · Cross-browser and platform

**Assignee:** Amruth · **Area:** Learner widget · **Tenant:** `medice` · **Est.** 45 min

## Preconditions

- Chrome, Firefox and Safari — Safari on iOS if a device is available
- Run the learner path far enough to reach video, exam and certificate in each

## Cases

### T22.1 · Video plays in each browser

**Steps**

1. Play a course video in Chrome, Firefox and Safari.
2. Note codec or playback failures.

**Expected**

- Playback works in all three.

> Safari is the one to watch: it is strictest about codecs and about Range requests, and it is what a physician on an iPhone or a Mac will use.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T22.2 · Seeking and progress behave identically

**Steps**

1. In each browser, repeat T03.3 (forward seek refused) and T03.5 (resume at the last minute).

**Expected**

- Both behave the same in all three browsers.

> Record any browser where forward seeking is **allowed** — that is the highest-value finding in this ticket.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T22.3 · The certificate PDF opens

**Steps**

1. Download and open the certificate in each browser.

**Expected**

- It opens and renders identically, barcodes included.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T22.4 · Fonts and umlauts

**Steps**

1. Compare headings and body text across browsers.
2. Check ä, ö, ü and ß on each screen.

**Expected**

- The intended font loads in all three.
- No tofu or fallback glyphs.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T22.5 · iOS specifics

**Steps**

1. On an iPhone, play a video, take an exam and download the certificate.

**Expected**

- Video plays inline rather than forcing fullscreen, or if it forces fullscreen, progress is still recorded.
- The certificate download is usable on the device.

> Skip and mark `blocked` if no device is available — do not simulate this one, the simulator does not reproduce iOS media behaviour.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

## Attach to the report

- A grid: case × browser × pass/fail, with versions.
