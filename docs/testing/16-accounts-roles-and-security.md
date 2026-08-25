# 16 · Accounts, roles and two-factor

**Assignee: Philipp Burka**
**Area:** Admin console · **Duration:** approx. 35 minutes

## Goal

Check that each role sees exactly the screens it is allowed to use — and that
nobody is offered a button the system then refuses.

## Prerequisites

- An account with administrator rights
- An authenticator app for the second factor
- **Two browsers**, or a private window, to work as a second role in parallel

## Steps

1. Open **Einstellungen → Konten**.
2. Invite a new account. Read the invitation text: is it clear **what** you are
   being given — a link, a password, a code?
3. Accept the invitation in the second browser and set the account up.
4. Use **the same invitation a second time**. What happens?
5. Set up two-factor and sign out and in once.
6. Check whether the console offers to reset **your own** second factor.
7. Give the new account a **restricted role**.
8. Sign in as that account and **click every menu entry** that is offered.
9. Note whether any offered menu entry leads to "keine Berechtigung".
10. Deactivate an account while it is signed in in another browser. What happens
    there on the next click?
11. Open **Einstellungen → Sicherheit** and look at what is there.

## Expected

- Step 4: a used invitation does **not** work a second time.
- Step 6: your own second factor **cannot** be reset by yourself — and if the
  button is absent, it says **why** and who can do it.
- **Step 9 is the core of this ticket: there must not be a single one.** A menu
  entry that leads to "keine Berechtigung" is a finding — please report it with
  the role and the entry.
- Step 10: access ends there and then, not at the next sign-in.

## Pay particular attention to

Step 2. The invitation text has previously been mistaken for a password. Please
report verbatim what it says, and whether it was unambiguous.

## Please report with

A table: **role × menu entry clicked × worked (yes/no)**. That is the most
valuable report from this ticket.
