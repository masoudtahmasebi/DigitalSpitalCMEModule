# T21 · The `<ds-lms>` embed and its isolation

**Assignee:** Amruth · **Area:** Learner widget · **Tenant:** `medice` · **Est.** 35 min

## Preconditions

- A page embedding the widget — the WordPress plugin, or the standalone embed
- The host page should have its own CSS, ideally aggressive

## Cases

### T21.1 · The widget mounts inside a host page

**Steps**

1. Open a host page containing `<ds-lms>`.
2. Confirm the widget renders.

**Expected**

- It mounts and is usable.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T21.2 · Host CSS does not leak in

**Steps**

1. In devtools, add aggressive rules to the host page: `* { font-family: Comic Sans MS !important; color: red !important; box-sizing: content-box !important; }`.
2. Look at the widget.

**Expected**

- The widget is unaffected.

> The widget renders into a closed Shadow DOM for exactly this reason. A customer's theme must not be able to restyle a screen that decides a CME point.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T21.3 · Widget CSS does not leak out

**Steps**

1. Inspect the host page's own elements around the widget.

**Expected**

- Host styling is unchanged by the widget's presence.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T21.4 · The shadow root is closed

**Steps**

1. In the console, run `document.querySelector('ds-lms').shadowRoot`.

**Expected**

- It returns `null`.

> A closed root is deliberate. If it returns a node, that is a finding — report it.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T21.5 · The widget works without the host being signed in to WordPress

**Steps**

1. Load the embed as an anonymous visitor.
2. Follow whatever sign-in the widget itself offers.

**Expected**

- Authentication is the platform's, not WordPress's.
- No WordPress login is required or implied.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T21.6 · Two widgets on one page, and unmounting

**Steps**

1. If the host allows, place two `<ds-lms>` elements on one page.
2. Then remove one from the DOM in devtools.

**Expected**

- Both mount independently.
- Removing one leaves no console error and does not affect the other.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

## Attach to the report

- The exact host CSS used in T21.2 and a screenshot of the widget under it.
