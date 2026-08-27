# T01 · Sign-in and catalogue

**Assignee:** Amruth · **Area:** Learner portal · **Tenant:** `medice` · **Est.** 20 min

## Preconditions

- P0 confirmed (see 00-README)
- A participant account on the `medice` tenant
- Portal URL including the tenant path: `…/medice`

## Cases

### T01.1 · Tenant path is required

**Steps**

1. Open the portal URL with **no** tenant path.
2. Open it with an invented path, e.g. `…/doesnotexist`.

**Expected**

- Both refuse.
- Neither response names any existing tenant. The customer list is not something an anonymous visitor can enumerate — the answer being unhelpful is the intended behaviour, not a gap.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T01.2 · Sign-in does not disclose whether an account exists

**Steps**

1. Sign in with a valid address and a wrong password.
2. Sign in with an address that does not exist.

**Expected**

- The two messages are **identical**.
- Neither confirms whether the address is registered.

> A difference between these two responses is a finding. It turns the sign-in form into a way to test whether a named physician is enrolled with MEDICE.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T01.3 · Catalogue renders and filters

**Steps**

1. Sign in at `…/medice`.
2. Click through every filter chip.
3. Search a term matching nothing.

**Expected**

- ADHS Akademie adult is listed.
- Each card shows CME points and duration.
- The empty search states that nothing matched and offers a way back.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T01.4 · Session survives reload and ends on sign-out

**Steps**

1. Reload the page while signed in.
2. Sign out, then press the browser Back button.

**Expected**

- Still signed in after reload.
- Back shows no signed-in content and no participant data.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

## Attach to the report

- Full-width screenshot of the catalogue.
- Any English string found on a German screen, with the screen name.
