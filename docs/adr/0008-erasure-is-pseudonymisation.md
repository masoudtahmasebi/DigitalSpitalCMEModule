# ADR-0008 — Erasure of a data subject means pseudonymisation, not deletion

- **Status:** Accepted
- **Date:** 2026-07-28
- **Ticket:** P10-10
- **Deciders:** Masoud Tahmasebi

## Context

A physician can ask for their data to be erased under Art. 17 GDPR. The platform
has to be able to honour that, and the mechanism has to be decided before launch
rather than improvised on the first request — an erasure is irreversible, and an
improvised one is irreversible and wrong.

The difficulty is that the data is not all the same kind of thing:

- **The participation record** — which course, which VNR, how many points, when
  it completed — is the counterpart of a Punktemeldung already filed with the
  Ärztekammer. The Kammer has credited points against a named physician's
  Fortbildungskonto on the strength of it, and may ask to see the
  Teilnahmebescheinigung years later.
- **The identifiers** — name, e-mail, EFN, attested name, free-text evaluation
  answers — are personal data with no independent reason to exist once the
  subject has asked for them to go.

Deleting the first would not honour a right. It would destroy the evidence
behind a report that was made, under a name, to a public body — leaving the
Kammer's record and ours unable to be reconciled.

Two further complications shape the mechanism rather than the principle:

**The data spans tenants.** One physician has one EFN (ADR-0004) and may hold
enrolments at several customers. There is no tenant context in which "erase this
person" is expressible.

**A Punktemeldung may be in flight.** The EFN is the key the report is credited
against. Removing it while a submission is queued, held or retrying leaves a
report that can neither be completed nor corrected, and the Bescheid's correction
window closes permanently.

## Decision

**Erasure is pseudonymisation.** The fact of participation survives; every
identifier is removed.

| Removed                                  | Retained                                       |
| ---------------------------------------- | ---------------------------------------------- |
| `users.email`, `first_name`, `last_name` | course, VNR, points, category                  |
| `efn_profiles` row (the EFN itself)      | `completed_at`                                 |
| `enrolments.attested_name`               | that a Punktemeldung was made, and its outcome |
| free-text evaluation answers             | scale evaluation answers                       |
| `certificates.participant_name`          | watch and quiz evidence, now unattributable    |
| the EFN as submitted (→ fifteen zeroes)  |                                                |

Implemented as `erase_subject(uuid, text)` in migration 0009, with four
supporting decisions:

1. **Owned by `ds_erasure`** — `NOLOGIN`, `BYPASSRLS`, owning this one function
   and nothing else, with verb-level grants on the six tables it touches.
   Executable by `ds_migrator` and explicitly **not** by `ds_app`, the role every
   HTTP request runs as.
2. **Refused while any Punktemeldung is `queued`, `held` or `failed_retryable`.**
   The delay is measured in days; Art. 12(3) allows a month.
3. **A trigger keeps an erased profile erased.** `provisionOrUpdate` writes name
   and e-mail from the token on every single request, so a subject signing in
   again would silently undo the erasure as a side effect of a normal page load.
4. **An operator CLI, not an endpoint** (`apps/api/src/subject-erasure.ts`), with
   a dry run by default. The dry run reads through the same
   `SECURITY DEFINER` owner as the erasure, because a preview that cannot see
   what the operation sees is not a preview.

Free text goes and scale answers stay: a scale answer is a number in an
aggregate once the enrolment is pseudonymised, while a free-text answer is
whatever the physician chose to type, which may name a patient.

## Rationale

Art. 17(3)(b) excepts processing necessary for compliance with a legal
obligation. A CME participation record is squarely within it, and the ICO's and
the German DSK's guidance on pseudonymisation as a proportionate response to an
erasure request where retention is mandatory is the standard reading.

What remains cannot be attributed to a person without the Keycloak account,
which the customer deletes on their own side. Pseudonymisation under Art. 4(5)
becomes anonymisation once the realm entry is gone — so the subject's outcome is
the same as deletion, while the Kammer's record stays reconcilable.

The cross-tenant nature is why this is not an admin console button. A
`customer_admin` erasing "their" learner would remove an identifier another
customer's pending report depends on, and no amount of UI copy makes that
somebody's informed choice.

## Consequences

**Positive**

- A lawful erasure request can be honoured without destroying a compliance
  record or breaking a statutory report.
- `ds_app` cannot perform an erasure, so no controller bug is an erasure
  primitive.
- The refusal on an open Punktemeldung makes the dangerous ordering impossible
  rather than documented.
- The trigger means the guarantee holds against every writer, including one a
  later ticket generates.

**Negative**

- **A second `BYPASSRLS` role exists.** ADR-0002's claim is "RLS is the
  isolation", and every exception weakens the sentence. Mitigated by the role
  being `NOLOGIN`, owning one fixed function whose whole body is in a reviewed
  migration, and holding only the verbs that function uses — but it is a real
  cost and it is the reason this decision needed a record.
- **Erasure is not instant.** A subject with a report in flight waits for the
  window to close. That has to be explained in the response to their request.
- **The retained record is not nothing.** A determined correlation attack against
  someone with an unusual completion timestamp is conceivable. The alternative —
  deleting the record — trades that for a worse problem.
- **An operator, not an admin, performs it.** That is a manual step in a
  process that has a legal deadline, so it needs to be in the runbook and not
  only in this file. It is, in `infra/deploy/README.md` and `docs/gdpr.md`.

## Alternatives considered

**Hard delete.** Simplest to explain and to implement, and wrong: it destroys
the counterpart of a filed report. The Kammer's record would survive with no
corresponding record here, which is worse for the subject too — a disputed point
could not be evidenced.

**Retain everything and refuse the request.** Defensible for the participation
record, indefensible for the e-mail address and the free-text answers, which are
not needed for any legal obligation.

**Crypto-shredding** — encrypt each subject's identifiers under a per-subject
key and discard the key. Cleaner in theory. It means a key-management system, a
key per subject, and a new class of "the key is gone but the data was needed"
incident, for a platform whose entire subject population is a few thousand
physicians. Not proportionate at this size.

**Admin console button.** Rejected on the cross-tenant argument above. It also
puts an irreversible action one click from a screen used for routine edits.
