# T19 · Loading, empty, error and boundary states

**Assignee:** Amruth · **Area:** Learner widget + console · **Tenant:** `medice` · **Est.** 40 min

## Preconditions

- Devtools network throttling and request blocking

## Cases

### T19.1 · Loading states exist

**Steps**

1. Throttle the network to Slow 3G.
2. Open the catalogue, a course, the player and three console screens.

**Expected**

- Each shows a loading state — not a blank page, and not a flash of an empty state that then fills.

> A blank region during load reads as a broken screen. An empty state shown _before_ data arrives reads as no data.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T19.2 · Empty states are distinguishable from failures

**Steps**

1. Find or arrange: an empty catalogue search, a course with no Mediathek entries, an empty Punktemeldungen filter.

**Expected**

- Each says it is empty and offers a way back.
- None is indistinguishable from a failed load.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T19.3 · A failed request is reported, not swallowed

**Steps**

1. In devtools, block the API domain.
2. Reload the catalogue, then a course, then a console screen.

**Expected**

- Each shows an error state saying something went wrong and offering a retry.
- None shows an empty list as though the answer were 'nothing'.

> An error rendered as an empty list is the worst of the three: it is a wrong answer presented confidently.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T19.4 · A failed write does not lose the input

**Steps**

1. Block the API. Fill in the Evaluationsbogen and submit.
2. Unblock and retry.

**Expected**

- The error is reported.
- The typed answers are still there — the form does not clear on failure.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T19.5 · Disabled controls say why

**Steps**

1. Find three disabled controls across the product — a locked exam, a blocked deletion, a disabled Erneut senden.

**Expected**

- Each conveys the reason at the point somebody looks, not only on hover.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T19.6 · Long and awkward content

**Steps**

1. Create a course with a 200-character title and a module with a very long name.
2. View it in the catalogue, the player sidebar and the console list.

**Expected**

- Nothing overlaps, escapes its container, or pushes the layout sideways.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

## Attach to the report

- For T19.3: a screenshot of each error state, and any screen that showed an empty list instead.
