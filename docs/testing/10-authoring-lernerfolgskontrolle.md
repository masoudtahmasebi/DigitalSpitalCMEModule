# T10 · Authoring: edit a Lernerfolgskontrolle after it has been sat

**Assignee:** Amruth · **Area:** Admin console · **Tenant:** `medice` · **Est.** 40 min

## Preconditions

- The test course from T09
- A second browser or private window for the participant role

## Cases

### T10.1 · Answer-key validation

**Steps**

1. Create three questions: one single-correct, one multi-correct, one incomplete.
2. Save a question with **no** correct answer.
3. Mark two options correct on a single-answer question and save.

**Expected**

- Both are refused, and the message names the question.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T10.2 · Delete an unanswered question

**Steps**

1. Delete a question nobody has answered.

**Expected**

- It is deleted outright.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T10.3 · An answered question is marked as in use

**Steps**

1. As a participant, sit the exam so answers are recorded.
2. Return to the console.

**Expected**

- The answered question carries a marker such as _In Verwendung_ or an answer count.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T10.4 · An answered question is retired, not deleted

**Steps**

1. Remove the answered question.
2. Read the confirmation dialog.
3. Save.

**Expected**

- The dialog states the question will be **removed from the exam but not deleted**, and that submitted attempts keep their result.
- The save reports how many questions were removed.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T10.5 · The retired question is no longer asked

**Steps**

1. As a participant, open the exam again.

**Expected**

- The removed question does not appear.
- The remaining questions are numbered without a gap.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T10.6 · An earlier result is unchanged

**Steps**

1. Open the affected participant's record.

**Expected**

- Their earlier score and pass/fail are exactly as before.

> **Blocking if it changes.** A CME point depends on this record. Report immediately and stop.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

## Attach to the report

- The confirmation dialog text from T10.4, verbatim.
