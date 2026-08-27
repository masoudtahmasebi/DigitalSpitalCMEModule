# T18 · Responsive behaviour across breakpoints

**Assignee:** Amruth · **Area:** Learner widget + console · **Tenant:** `medice` · **Est.** 40 min

## Preconditions

- Devtools device toolbar
- `docs/design/mobile/*.png` for the mobile renders

## Cases

### T18.1 · Five widths, no horizontal scroll

**Steps**

1. Open catalogue, course detail, player, exam and completion at 320, 430, 768, 1024 and 1440 px.
2. At each width, check `document.documentElement.scrollWidth <= clientWidth` in the console.

**Expected**

- No page scrolls horizontally at any of the five widths.

> Record the width and the screen for every failure. `scrollWidth` is the objective check — a page can look fine and still overflow by a few pixels.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T18.2 · Mobile layouts match their renders

**Steps**

1. Compare the mobile catalogue, detail page and player against `docs/design/mobile/*.png`.

**Expected**

- The mobile arrangement is the drawn one, not the desktop layout squeezed.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T18.3 · The module outline survives the narrow layout

**Steps**

1. At 320 px, from the player, reach the module outline.

**Expected**

- It is reachable and discoverable.
- On desktop it sits beside the video; note where it goes on a phone.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T18.4 · Tables and long content scroll inside themselves

**Steps**

1. At 768 px, open the console's Teilnehmende, Bescheinigungen and Punktemeldungen tables.

**Expected**

- Wide tables scroll **within their own container**, not by moving the page.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T18.5 · Touch targets

**Steps**

1. At 320 px, measure the player controls, tab row and primary buttons.

**Expected**

- No interactive target is smaller than roughly 44 × 44 px.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T18.6 · Long German compounds do not break the layout

**Steps**

1. Find the longest labels on screen — Lernerfolgskontrolle, Teilnahmebescheinigung, Anerkennungsbescheid — at 320 px.

**Expected**

- They wrap or truncate cleanly. Nothing overlaps or overflows its container.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

## Attach to the report

- A grid: screen × width × pass/fail.
- Screenshots at the failing width for anything that overflowed.
