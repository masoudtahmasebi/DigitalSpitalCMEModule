# T13 · Participants and certificate moderation

**Assignee:** Amruth · **Area:** Admin console · **Tenant:** `medice` · **Est.** 30 min

## Preconditions

- At least one completed participation

## Cases

### T13.1 · No full EFN is ever rendered

**Steps**

1. Open Teilnahme → Teilnehmende.
2. Search the list, a participant detail page, the DOM and the API responses for a 15-digit number.

**Expected**

- No full EFN anywhere. At most the last four digits.

> **Blocking.** The EFN is a national identifier tied to a named physician. Report at once.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T13.2 · Participant detail

**Steps**

1. Open a participant.
2. Deactivate and reactivate them.

**Expected**

- Progress, attempts and completion are shown.
- Deactivation takes effect immediately.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T13.3 · Certificate download matches the participant's

**Steps**

1. Open Teilnahme → Bescheinigungen.
2. Download an issued certificate.
3. Compare with the file the participant downloaded in T07.

**Expected**

- Identical document.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T13.4 · An undeliverable certificate says why

**Steps**

1. Find a certificate with status **unzustellbar**.
2. Read the sentence under the status.
3. Check whether **Erneut senden** is available.

**Expected**

- A sentence names the next step: no address on file, an address the server refused, or repeated temporary failures pointing at SMTP settings.
- **Erneut senden** is disabled for the first two and enabled for the third.

> A row that failed before this was built shows no sentence. That is correct — the reason was not recorded then.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T13.5 · Export

**Steps**

1. Filter by course and date range.
2. Export CSV.
3. Open it in Excel.

**Expected**

- Filters apply to the export.
- Umlauts survive.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

## Attach to the report

- Screenshot of the participant list with names redacted — the columns are what matters.
