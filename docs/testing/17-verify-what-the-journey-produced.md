# T17 · Verify what the journey produced

**Assignee:** Amruth · **Surface:** Admin console · **Est.** 35 min

## Preconditions

- T05–T11 completed at least once, so there is a participation to look at

## Cases

### T17.1 · The participation is recorded correctly

**Steps**

1. Teilnahme → Teilnehmende. Find your test participant.
2. Compare progress, attempts and completion against what you actually did.

**Expected**

- They agree.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T17.2 · No full EFN anywhere

**Steps**

1. Search the list, the detail page, the DOM and the API responses for a 15-digit number.

**Expected**

- Never in full. At most the last four digits.

> **Blocking.** The EFN is a national identifier tied to a named physician.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T17.3 · The certificate matches the one downloaded

**Steps**

1. Teilnahme → Bescheinigungen. Download it.
2. Compare with the file from T11.

**Expected**

- Identical.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T17.4 · An undeliverable certificate says why

**Steps**

1. Find a certificate marked **unzustellbar**, or arrange one.
2. Read the sentence under the status and check whether **Erneut senden** is offered.

**Expected**

- A sentence names the next step.
- The button is disabled where resending could only fail again.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T17.5 · The Punktemeldung state agrees with what the physician was shown

**Steps**

1. Teilnahme → Punktemeldungen. Find the row for your completion.
2. Compare with the panel text recorded in T11.4.

**Expected**

- They describe the same state.

> A disagreement here is significant: it means the physician and the operator are being told different things about the same CME points.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T17.6 · A failed row says who can fix it

**Steps**

1. Expand a failed row.

**Expected**

- A sentence names who can act — the participant for a rejected EFN, the operator for a rejected event or credentials.
- A row that failed before this was built has no sentence, which is correct.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T17.7 · Export

**Steps**

1. Export CSV and open it in Excel.

**Expected**

- Filters apply. Umlauts survive.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---
