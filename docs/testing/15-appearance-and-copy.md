# T15 · Appearance and copy overrides

**Assignee:** Amruth · **Area:** Admin console · **Tenant:** `medice` · **Est.** 25 min

## Preconditions

- Console access on `medice` with a project-level role

## Cases

### T15.1 · Brand colour and logo reach the portal

**Steps**

1. Einstellungen → Erscheinungsbild. Change the brand colour. Save.
2. Upload a logo. Save.
3. Check the portal.

**Expected**

- Both changes appear in the portal.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T15.2 · An invalid colour is refused by field, not by value

**Steps**

1. Enter `rot`, then `#12`.

**Expected**

- Both refused.
- The message names the **field**. It need not echo the value entered.

> A message that echoes the entered value is a finding — the case that exercises this validation is a CSS injection.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T15.3 · Copy overrides apply and clear

**Steps**

1. Einstellungen → Texte. Override the catalogue heading. Save.
2. Check the portal.
3. Clear the override.
4. Check again.

**Expected**

- The override appears.
- Clearing restores the default text rather than leaving an empty line.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T15.4 · Text entries say where they appear

**Steps**

1. Read the Texte list without changing anything.

**Expected**

- Each entry indicates where the text is used.

> A list of snippets with no location is usable only by trial and error. Report if so.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T15.5 · English console is complete

**Steps**

1. Switch the console to EN. Visit at least eight screens.

**Expected**

- English throughout, **except** Lernerfolgskontrolle, Teilnahmebescheinigung, Punktemeldung, Anerkennungsbescheid, Ärztekammer, EFN, VNR.
- Those stay German deliberately — they appear verbatim on the Ärztekammer's documents.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

## Attach to the report

- Before/after screenshots of the portal after the colour and logo change.
- Any German string left on an English screen that is not in the exempt list.
