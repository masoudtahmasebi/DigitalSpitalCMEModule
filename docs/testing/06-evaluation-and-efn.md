# T06 · Evaluationsbogen and EFN

**Assignee:** Amruth · **Area:** Learner widget · **Tenant:** `medice` · **Est.** 25 min

## Preconditions

- All videos watched and all Lernerfolgskontrollen passed
- **Use a test EFN, not a real physician's number.**

## Cases

### T06.1 · Ordering: evaluation before EFN

**Steps**

1. Open the Zertifizierung tab and follow the path to completion.

**Expected**

- The Evaluationsbogen is asked for **before** the EFN.

> The order matters: being refused after entering an identifier is the worst moment to be refused.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T06.2 · Incomplete evaluation is refused

**Steps**

1. Submit the Evaluationsbogen with mandatory answers missing.

**Expected**

- Missing answers are named before submission.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T06.3 · EFN validation is 15 digits

**Steps**

1. Read the EFN hint text and note the digit count it states.
2. Enter 14 digits.
3. Enter 15 characters including a letter.
4. Enter 15 digits.

**Expected**

- The hint says **15**. Any other number is a finding.
- 14 digits and the letter case are both refused, with a message stating what is expected.
- 15 digits is accepted.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T06.4 · The stored EFN is readable back by its owner

**Steps**

1. Reopen the EFN page.

**Expected**

- The participant can see the number the platform will report on their behalf.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T06.5 · Data protection notice

**Steps**

1. Read the notice shown with the EFN field.

**Expected**

- It is present and states what happens to the number.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

## Attach to the report

- The exact wording of the EFN hint text, typed out or screenshotted.
