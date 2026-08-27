# T20 · Browser console, CSP and network hygiene

**Assignee:** Amruth · **Area:** Learner widget + console · **Tenant:** `medice` · **Est.** 35 min

## Preconditions

- Devtools open on the Console and Network tabs throughout
- This ticket is run **while** doing T01–T08 — keep devtools open and record as you go

## Cases

### T20.1 · No console errors on any screen

**Steps**

1. Walk the whole learner path with the Console tab open.
2. Record every error and warning, with the screen it appeared on.

**Expected**

- No uncaught errors.
- No React key or hydration warnings.
- No 404s for assets.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T20.2 · No CSP violations

**Steps**

1. Filter the console for `Content Security Policy`.
2. Exercise video playback, file upload, poster loading and the widget embed.

**Expected**

- No CSP violation is reported.

> This is how a real defect was found: every video upload was refused by the browser for months with a clean server log, because the refusal happens between the browser and the bucket. A CSP violation here is a genuine finding and will not appear in any server log.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T20.3 · Uploads reach the bucket

**Steps**

1. In the console, upload a video, a poster and a PDF.
2. Watch the Network tab for the PUT to the object store.

**Expected**

- Each PUT succeeds.
- No CORS preflight failure.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T20.4 · No secret or identifier in a payload

**Steps**

1. With the Network tab open, complete a course and open the admin screens.
2. Search the responses for a 15-digit number and for anything resembling a password.

**Expected**

- No full EFN in any response.
- No VNR password in any response.

> **Blocking** if either appears. Search the raw responses, not just the rendered screen.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T20.5 · Requests are not repeated per keystroke

**Steps**

1. Type into the media library's rename field and into a course settings field.
2. Watch the Network tab.

**Expected**

- No request per keystroke. Saves happen on blur or explicit submit.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T20.6 · The bundle is served by the platform

**Steps**

1. On the learner portal, find the widget bundle request in the Network tab.

**Expected**

- It comes from the platform's widget host, not from a copy shipped elsewhere.
- Note its `Cache-Control` header.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

## Attach to the report

- The full list of console errors and warnings, with the screen for each.
- Any CSP violation, verbatim.
