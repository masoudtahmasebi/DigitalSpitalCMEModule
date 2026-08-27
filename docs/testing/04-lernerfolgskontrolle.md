# T04 · Lernerfolgskontrolle

**Assignee:** Amruth · **Area:** Learner widget · **Tenant:** `medice` · **Est.** 30 min

## Preconditions

- T03 passed for at least one module's videos

## Cases

### T04.1 · A locked exam names its blocker

**Steps**

1. Open a module whose videos are unfinished.
2. Click its Lernerfolgskontrolle.

**Expected**

- It is locked.
- The screen names **which video** is outstanding — not merely that it is locked.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T04.2 · The exam identifies itself

**Steps**

1. Open an unlocked exam.
2. Read the heading, the start button and the result screen.

**Expected**

- Each carries the exam's own title, so which module's exam it is, is unambiguous.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T04.3 · Submitting nothing is refused clearly

**Steps**

1. Click Weiter without answering.

**Expected**

- A visible prompt appears. Nothing silently does nothing.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T04.4 · A failed attempt reports the arithmetic

**Steps**

1. Answer deliberately wrong and submit.

**Expected**

- The result states how many were correct and how many were required.
- Correct answers are **not** revealed — that is a certification requirement.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T04.5 · A passed exam offers a way forward

**Steps**

1. Retake and pass.
2. Read every control on the passed screen.

**Expected**

- There is a way to continue to the next content — not only a way back to the overview.

> A passed screen that only leads backwards is a finding.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T04.6 · A pass is not withdrawn by reopening

**Steps**

1. Open the passed exam again.

**Expected**

- The pass still stands. A new attempt does not revoke the earlier result.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

## Attach to the report

- Full screenshot of the passed screen, with every button visible.
