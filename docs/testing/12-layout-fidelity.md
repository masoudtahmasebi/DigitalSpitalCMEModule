# T12 · Layout fidelity against the MEDICE renders

**Assignee:** Amruth · **Surface:** MEDICE WordPress page · **Est.** 50 min

## Preconditions

- `docs/design/screens/page-01.png` … `page-13.png` — **the authority**
- `docs/design/desktop/*.png` and `docs/design/mobile/*.png`
- `docs/design/README.md` — the existing verdict table
- Desktop at 1440 px

## Cases

### T12.1 · List and detail

**Steps**

1. Compare the Fortbildungsbereich against page-01/02 and the detail tabs against page-03/05 and `detailseite-*.png`.

**Expected**

- Every drawn element is present.
- Differences are recorded as **differs** with the difference named.

> `docs/design/README.md` already carries verdicts. A row it calls **deliberate** is not a finding; a row it calls **matches** that no longer does is a regression.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T12.2 · Player

**Steps**

1. Compare against page-06/07 and `player-zusammenfassung-v1/-v2.png`.

**Expected**

- The module outline is in the sidebar as drawn, not a tab row.
- Note which Zusammenfassung variant is built.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T12.3 · Exam screens

**Steps**

1. Compare intro, question, passed and failed against page-08…11.

**Expected**

- Each matches, including the button set on the passed screen.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T12.4 · Completion form

**Steps**

1. Compare against page-12/13.

**Expected**

- Field order and labels match.
- The Punktemeldung panel is an addition not in the layout — confirm it displaces nothing drawn.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T12.5 · Colour and type

**Steps**

1. Sample the brand colour, the completed/teal state and the pause/outlined state with devtools.

**Expected**

- Completed is teal; pause is outlined, not filled.
- Headings match the layout's scale.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T12.6 · It still looks like MEDICE's page

**Steps**

1. Step back and look at the whole page.

**Expected**

- The widget sits in the MEDICE design rather than looking pasted on.
- Record anything that reads as foreign — spacing at the edges, a clashing typeface, a container that fights the theme's width.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

## Attach to the report

- A verdict table: screen × element × matches/differs/missing, with every `differs` named.
- Side-by-side screenshots for each `differs`.
