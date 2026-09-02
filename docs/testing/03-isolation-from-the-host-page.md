# T03 · Isolation from the host page

**Assignee:** Amruth · **Surface:** MEDICE WordPress page · **Est.** 30 min

## Preconditions

- The widget rendering on a MEDICE page
- Devtools

## Cases

### T03.1 · The host's CSS cannot reach in

**Steps**

1. In devtools, add to the host page: `* { font-family: 'Comic Sans MS' !important; color: red !important; box-sizing: content-box !important; line-height: 3 !important; }`.
2. Look at the widget.

**Expected**

- The widget is visually unchanged.

> The widget renders into a closed Shadow DOM for exactly this reason: a customer's theme must not be able to restyle a screen that decides a CME point.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T03.2 · The widget's CSS does not leak out

**Steps**

1. Inspect MEDICE's own headings, buttons and text around the widget.

**Expected**

- Host styling is unchanged by the widget's presence.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T03.3 · The shadow root is closed

**Steps**

1. Run `document.querySelector('ds-lms').shadowRoot` in the console.

**Expected**

- It returns `null`.

> Closed on purpose. A node coming back is the finding, not the null.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T03.4 · The page's own scripts do not break it

**Steps**

1. Note any theme scripts running on the page — sliders, cookie banners, analytics.
2. Interact with the widget while they are active.

**Expected**

- No interference either way.
- A cookie banner overlaying the widget is a layout finding — record it.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T03.5 · The widget does not hijack the page

**Steps**

1. Scroll the host page while the widget is on screen.
2. Use the browser Back button after navigating inside the widget.

**Expected**

- Page scrolling is normal.
- Back behaves sensibly rather than leaving the site.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T03.6 · Two on one page

**Steps**

1. If a page can be arranged with two `<ds-lms>` elements, load it.
2. Remove one from the DOM in devtools.

**Expected**

- Both mount independently.
- Removing one produces no console error and does not affect the other.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

## Attach to the report

- The exact host CSS used in T03.1 and a screenshot of the widget under it.
