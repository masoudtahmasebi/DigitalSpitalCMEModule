# T04 · Console, CSP and CORS on the MEDICE site

**Assignee:** Amruth · **Surface:** MEDICE WordPress page · **Est.** 35 min

## Preconditions

- Devtools open on Console and Network **throughout T05–T11** — this ticket is recorded as you go, not run separately

## Cases

### T04.1 · No CSP violation on the MEDICE page

**Steps**

1. Filter the console for `Content Security Policy`.
2. Load the page, play a video, open a PDF from the Mediathek.

**Expected**

- No violation.

> If the site sends a CSP it must name the widget host in `script-src`, and `media-src` must allow the video's origin. A CSP refusal happens between the browser and the far end and appears in **no server log** — this console is the only place it exists. Every video upload was refused for months exactly this way.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T04.2 · No CORS refusal against the API

**Steps**

1. Watch the Network tab while the widget loads data.

**Expected**

- No request is refused by CORS.

> The MEDICE site's origin has to be listed in the project's **Erlaubte Einbettungs-Domains**. A server-to-server reachability check passes without it, because such a request carries no `Origin` — so this is the only place the real answer shows.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T04.3 · No console errors through the whole journey

**Steps**

1. Walk T05–T11 with the Console tab open.
2. Record every error and warning with the screen it appeared on.

**Expected**

- No uncaught errors, no React warnings, no asset 404s.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T04.4 · No identifier in any payload

**Steps**

1. Search every response for a 15-digit number and for anything resembling a password.

**Expected**

- No full EFN. No VNR password.

> **Blocking.** The rendered screen can be clean while the payload is not.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T04.5 · Media requests succeed

**Steps**

1. Watch the Network tab during video playback.

**Expected**

- Range requests succeed. No repeated failed requests for the same object.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T04.6 · Failed requests are handled

**Steps**

1. Block the API domain in devtools.
2. Reload the page and interact.

**Expected**

- The widget reports a problem and offers a retry.
- It does not render an empty catalogue as though the answer were 'no courses'.

> An error rendered as an empty list is the worst outcome: a wrong answer presented confidently.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

## Attach to the report

- Every console error and warning, with its screen.
- Any CSP or CORS message, verbatim.
