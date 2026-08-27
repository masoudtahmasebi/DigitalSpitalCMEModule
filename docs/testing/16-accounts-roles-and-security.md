# T16 · Accounts, roles and access control

**Assignee:** Amruth · **Area:** Admin console · **Tenant:** `medice` · **Est.** 40 min

## Preconditions

- An admin account on `medice`
- A second browser for the invited account

## Cases

### T16.1 · The invitation says what it is handing you

**Steps**

1. Einstellungen → Konten. Invite an account.
2. Read the invitation text.

**Expected**

- It is unambiguous whether the recipient is being given a link, a password or a code.

> This text has previously been mistaken for a password. Report it verbatim.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T16.2 · An invitation is single-use

**Steps**

1. Accept the invitation in the second browser and complete setup.
2. Use the same invitation link again.

**Expected**

- The second use is refused.

> **Blocking if it works twice.** A replayable invitation is a permanent key to a console account.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T16.3 · Two-factor

**Steps**

1. Set up 2FA on the new account. Sign out and in.
2. Look for a control to reset **your own** second factor.

**Expected**

- 2FA is enforced on sign-in.
- Self-reset is not offered — and where it would be, the screen says why and who can do it.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T16.4 · Every offered menu entry works for the role

**Steps**

1. Give the new account a restricted role.
2. Sign in as it.
3. Click **every** menu entry offered.
4. Record role × entry × worked.

**Expected**

- **Not one entry leads to 'keine Berechtigung'.**

> This is the core of the ticket. An offered control the API refuses is a finding — report the role and the entry.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T16.5 · Deactivation takes effect immediately

**Steps**

1. With the second browser signed in, deactivate that account from the first.
2. Click anything in the second browser.

**Expected**

- Access ends at that click, not at the next sign-in.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T16.6 · Security screen

**Steps**

1. Open Einstellungen → Sicherheit.

**Expected**

- It renders and its entries are understandable.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

## Attach to the report

- The role × menu entry × worked table from T16.4 — the most useful artefact in this pack.
