# T16 · Prepare the data in the console

**Assignee:** Amruth · **Surface:** Admin console · **Est.** 40 min

## Preconditions

- Console access on `medice`
- This ticket is **setup for the rest of the pack**, not a test area of its own. It is here so the journey has something to run against and so anything that blocks setup is caught early.

## Cases

### T16.0 · The installation will not file Punktemeldungen

**Steps**

1. Open Teilnahme → Punktemeldungen and read the banner.

**Expected**

- It reads **Meldungen werden nicht übermittelt**.

> **Stop the whole pack if it says otherwise.** Testing runs against ADHS Akademie adult, which carries the real VNR from the ÄKWL Bescheid. A completion with submissions on files a test EFN against a live accreditation, and a filed Punktemeldung cannot be unfiled — only withdrawn, which leaves its own record.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T16.1 · A test course can be created and published

**Steps**

1. Angebot → Fortbildungen → Neue Fortbildung.
2. Build two Modules, each with a Kapitel and a video, and one Lernerfolgskontrolle.
3. Fill the certificate fields, upload stamp and signature, set points and Kategorie.
4. Publish.

**Expected**

- New courses start as drafts and are invisible until published.
- Publishing is refused while anything mandatory is missing, and the refusal **names** what is missing.

> Do **not** restructure ADHS Akademie adult. The Bescheid requires changes of any kind be reported to the ÄKWL in writing.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T16.2 · Video, poster and subtitles upload

**Steps**

1. Upload a video, a poster and a subtitle file. Watch the Network tab.

**Expected**

- Each PUT to the object store succeeds. No CORS preflight failure.

> A failure here is a bucket/CSP problem, not an authoring one — record the console message verbatim.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T16.3 · The Zusammenfassung field exists

**Steps**

1. Find the field for the text shown under the video in the player.

**Expected**

- It exists, is labelled **Zusammenfassung**, and says where the text appears.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T16.4 · The VNR password is write-only

**Steps**

1. Enter a VNR password, save, reload.
2. Search the page source and API responses for the value.

**Expected**

- The screen says only that one is stored. The value appears nowhere.

> **Blocking** if retrievable.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T16.5 · Media can be reused

**Steps**

1. Open Angebot → Mediathek. Use **Aus Mediathek wählen** while adding a video.

**Expected**

- The picker works, including before the course has been saved.
- Deleting a file still in use is blocked, and the reason names the number of uses.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T16.6 · Embedding domains are configured

**Steps**

1. Verwaltung → Organisation → Projekte → the MEDICE project.
2. Check **Erlaubte Einbettungs-Domains** contains the MEDICE site's origin.

**Expected**

- It is listed.

> If it is not, every request the widget makes from that site is refused by CORS — which is what T04.2 would show.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

## Attach to the report

- The exact refusal message from T16.1.
- Anything that blocked setup, since it blocks the pack.
