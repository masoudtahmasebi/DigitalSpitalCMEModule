# T02 · Sign-in — the MEDICE token, and DocCheck

**Assignee:** Amruth · **Surface:** MEDICE WordPress page · **Est.** 35 min

## Preconditions

- A MEDICE account that signs in through the site's own Keycloak login
- A DocCheck account, if one is available
- **There is no WordPress login for physicians.** `is_user_logged_in()` is false for every one of them — do not look for a WordPress user.

## Cases

### T02.1 · Signed out, the widget says so

**Steps**

1. Open the page as an anonymous visitor.
2. Look at the widget.

**Expected**

- It shows a signed-out state and offers the site's sign-in.
- It does not show course content, and it does not error.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T02.2 · A MEDICE sign-in reaches the widget

**Steps**

1. Sign in through the MEDICE site's own login.
2. Return to the page carrying the widget.

**Expected**

- The widget is signed in and shows the catalogue for that physician.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T02.3 · The token endpoint answers for the caller only

**Steps**

1. Signed in, open `/wp-json/ds-lms/v1/token` in the same browser.
2. Then open it in a private window with no session.

**Expected**

- Signed in: a token is returned.
- Signed out: **404** with `no_token_held` or equivalent — never another person's token.

> **Blocking** if a signed-out or different session receives a token. It is the visitor's Keycloak access token.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T02.4 · DocCheck is a signed-out state, not a fault

**Steps**

1. Sign in via DocCheck.
2. Open the page.

**Expected**

- The widget shows its **signed-out** state.

> Correct, not broken. DocCheck involves no Keycloak, so such a visitor holds no access token. Record what the screen says — whether it is clear to a physician who has just logged in somewhere that they are not signed in _here_ is a real question and worth your judgement.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T02.5 · The token appears nowhere it should not

**Steps**

1. With the Network tab open and signed in, search the page source and every response for the token value.

**Expected**

- It is in no rendered HTML, no enqueued asset and no log.
- It reaches the widget only through the token endpoint.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

### T02.6 · Session expiry

**Steps**

1. Sign in, then let the session lapse — or clear the site's session cookie.
2. Interact with the widget.

**Expected**

- The widget notices and returns to its signed-out state.
- It does not sit showing stale content or fail silently.

**Result** ☐ pass ☐ fail ☐ blocked

**Observed**

---

## Attach to the report

- What the signed-out state says, verbatim, in both the anonymous and the DocCheck case.
