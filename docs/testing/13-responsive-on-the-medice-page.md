# T13 · Responsive behaviour on the MEDICE page

**Assignee:** Amruth · **Surface:** MEDICE WordPress page · **Est.** 40 min

## Preconditions

- Devtools device toolbar
- `docs/design/mobile/*.png`

## Cases

### T13.1 · Five widths, no horizontal scroll

**Steps**

1. At 320, 430, 768, 1024 and 1440 px open the list, detail, player, exam and completion.
2. At each, check `document.documentElement.scrollWidth <= document.documentElement.clientWidth`.

**Expected**

- No page scrolls horizontally at any width.

> `scrollWidth` is the objective check — a page can look fine and overflow by four pixels. Record the width and screen for every failure.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T13.2 · Mobile matches its renders

**Steps**

1. Compare against `docs/design/mobile/*.png`.

**Expected**

- The mobile arrangement is the drawn one, not the desktop squeezed.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T13.3 · The module outline on a phone

**Steps**

1. At 320 px, reach the module outline from the player.

**Expected**

- Reachable and discoverable.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T13.4 · Touch targets

**Steps**

1. Measure player controls, tabs and primary buttons at 320 px.

**Expected**

- Nothing interactive is much under 44 × 44 px.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T13.5 · Long German compounds

**Steps**

1. At 320 px find Lernerfolgskontrolle, Teilnahmebescheinigung, Anerkennungsbescheid on screen.

**Expected**

- They wrap or truncate cleanly. Nothing overlaps or overflows.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T13.6 · The widget inside the theme's own responsive layout

**Steps**

1. Resize with the MEDICE header, footer and any sidebar present.

**Expected**

- The widget reflows with the theme rather than forcing its own width.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

## Attach to the report

- A grid: screen × width × pass/fail, with screenshots of every overflow.
