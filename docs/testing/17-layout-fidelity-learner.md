# T17 · Layout fidelity — learner screens

**Assignee:** Amruth · **Area:** Learner widget · **Tenant:** `medice` · **Est.** 50 min

This ticket compares the built screens against the rendered layout. It is the only ticket in the pack about how the product **looks** rather than what it does.

## Preconditions

- `docs/design/screens/page-01.png` … `page-13.png` — the rendered MEDICE layout, which is **the authority**
- `docs/design/README.md` — the existing screen-by-screen verdict table
- Desktop at 1440 px

## Cases

### T17.1 · Catalogue against pages 01–02

**Steps**

1. Open the catalogue at 1440 px.
2. Place `page-01.png` beside it.
3. Compare: card grid, headings, filter row, spacing, seal, points and duration.

**Expected**

- Every element the layout draws is present.
- Differences are recorded as **differs** with the difference named — not as a general impression.

> `docs/design/README.md` already lists known verdicts. Check yours against it: a row it calls **deliberate** is not a finding, a row it calls **matches** that no longer does is a regression.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T17.2 · Course detail tabs against pages 03–05

**Steps**

1. Compare Übersicht, Experten/Referenten, Zertifizierung and Mediathek against their renders.
2. Also compare against `docs/design/desktop/detailseite-*.png`.

**Expected**

- Tab row, hero split, section rules and the Mehr-lesen affordance match.
- Kapitel are nested under their Modul as drawn.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T17.3 · Player against pages 06–07

**Steps**

1. Compare the player screen and its sidebar against the renders.
2. Compare the Zusammenfassung block against `player-zusammenfassung-v1.png` and `-v2.png`.

**Expected**

- The sidebar carries the module outline as drawn, not a tab row.
- Progress card, colours and control shapes match.
- Note which Zusammenfassung variant is built — v1 or v2.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T17.4 · Exam screens against pages 08–11

**Steps**

1. Compare intro, question, passed and failed states against the renders.

**Expected**

- Each state matches, including the button set on the passed screen.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T17.5 · Punktemeldung form against pages 12–13

**Steps**

1. Compare the completion form against the renders: title select, name fields, address, EFN, consent.

**Expected**

- Field order and labels match the layout.
- The new Punktemeldung panel (T07.4) is **not** in the layout — it is an addition. Confirm it does not displace anything the layout draws.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T17.6 · Colour, type and spacing

**Steps**

1. Sample the brand colour, the completed/teal state and the pause/outlined state with devtools.
2. Compare heading sizes and weights against a render.

**Expected**

- Colours match the layout's palette.
- Completed is teal; pause is outlined, not filled.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

## Attach to the report

- A verdict table: screen × element × matches/differs/missing, with the difference named on every `differs`.
- Side-by-side screenshots for anything marked `differs`.
