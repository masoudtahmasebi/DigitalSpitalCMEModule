# 01 · Sign-in and course catalogue

**Assignee: Philipp Burka**
**Area:** Participant portal · **Duration:** approx. 20 minutes

## Goal

Check that a physician can sign in and finds the catalogue in a state where she
knows what to click without being told.

## Prerequisites

- Credentials for the `ds` tenant (test tenant)
- The portal address including the tenant path, i.e. `…/ds`

## Steps

1. Open the portal address **without** a tenant path. What happens?
2. Open it with an **invented** tenant path, e.g. `…/doesnotexist`. What does
   the screen say?
3. Open `…/ds` and sign in.
4. Sign in with the **wrong password**. What does the message say?
5. Signed in: look at the catalogue. Click through the filters.
6. Search for a term that matches nothing.
7. Reload the page. Am I still signed in?
8. Sign out, then press the browser's back button.

## Expected

- Step 2 names **no** existing tenants. The list of our customers is not
  something any visitor should be able to ask for — that the answer is
  therefore unhelpful is deliberate.
- Step 4 does not reveal whether the address exists.
- Step 6 says nothing was found and offers a way back.
- Step 8 shows no signed-in content.

## Pay particular attention to

- Are the headings above the catalogue sections understandable?
- Can you tell from a card **how many CME points** it carries and **how long**
  the course is?
- Is there any English text on a German screen?

## Please report with

A full-width screenshot of the catalogue, and an answer to: _would a physician
seeing this page for the first time know where to click?_
