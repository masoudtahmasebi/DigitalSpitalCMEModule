# T12 · Course settings, certificate assets and VNR

**Assignee:** Amruth · **Area:** Admin console · **Tenant:** `medice` · **Est.** 35 min

## Preconditions

- The test course from T09 — **not** ADHS Akademie adult

## Cases

### T12.1 · Certificate fields persist

**Steps**

1. Fill Veranstalter, Ort, Ärztekammer, wissenschaftliche Leitung, place of issue.
2. Set CME points and Kategorie.
3. Upload stamp and signature.
4. Save and reload.

**Expected**

- Every value persists.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T12.2 · The VNR password is write-only

**Steps**

1. Enter a VNR password. Save.
2. Reload the settings screen.
3. Inspect the page source and any API response for the value.

**Expected**

- The screen states only that a password is stored.
- The value appears nowhere — not on screen, not in the DOM, not in any response.

> **Blocking if the value is retrievable.** Report immediately.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T12.3 · VNR format is deliberately not validated

**Steps**

1. Enter an obviously wrong VNR, e.g. `1234`. Save.

**Expected**

- It is accepted.

> Expected, not a defect. The check-digit rule is unconfirmed by the Ärztekammer and a guessed rule would refuse a legitimate number from another Kammer. Record what happens; do not file it.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T12.4 · The placeholder VNR is refused at publish

**Steps**

1. Set the VNR to `0000000000000000000`.
2. Give the course CME points.
3. Attempt to publish.

**Expected**

- Publishing is **refused**, naming the VNR.
- Setting a plausible VNR then publishes normally.

> This refuses exactly that one string, which is our own seed placeholder. It is not format validation — see T12.3.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T12.5 · Publishing refuses an incomplete certificate

**Steps**

1. Clear one certificate field and attempt to publish.

**Expected**

- Refused, naming the missing field.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T12.6 · Referenten and Evaluationsbogen

**Steps**

1. Create one entry in each tab.
2. Reload.

**Expected**

- Both persist and appear in the portal.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

## Attach to the report

- The exact refusal message from T12.4.
