# ADR-0004 — EFN is stored in our PostgreSQL as system of record

- **Status:** Accepted
- **Date:** 2026-07-27
- **Ticket:** P1-05, P7-04
- **Deciders:** Masoud Tahmasebi

## Context

The EFN (*Einheitliche Fortbildungsnummer*) is the 15-digit identifier that ties a
physician to their continuing-education account at the Landesärztekammer. Without
it, a completed course cannot be reported to EIV-FOBI and the learner does not
receive their CME points. It is the single most important user-supplied datum in
the system.

Three places could have held it:

- a custom attribute on the user's MEDICE Keycloak account,
- Salesforce, where MEDICE already has a `vDMC_EFN__c` field,
- our own database.

## Decision

**`efn_profiles` in our PostgreSQL is the system of record.** The EFN is captured
in the learner completion flow, stored by us, and read from our database when a
submission is built. No dependency on a Keycloak attribute; no dependency on
Salesforce. Salesforce synchronisation remains possible later and is explicitly
out of scope for this budget.

The EFN is:

- validated for format before storage (15 digits, checksum where defined) and
  re-validated at submission time,
- stored per user, not per enrolment — one physician has one EFN,
- treated as personal data: access is tenant-scoped under ADR-0002, it is never
  written to application logs, and it is redacted in error reporting.

## Rationale

**Keycloak attributes are MEDICE's to change.** Writing a custom attribute into
their realm means a schema dependency on a system operated by the client, on their
release cycle. If the attribute is renamed, unmapped from the token, or simply not
populated for users who registered before the change, submissions start failing —
and they fail at the last step of a journey the learner has already completed. It
also means the EFN would need to be present in every token, widening what is
exposed to the browser for no benefit.

**Salesforce is not on the critical path and should not become so.** MEDICE having
`vDMC_EFN__c` is useful context, but making it the source would put a CRM
integration between a physician finishing a course and receiving their points.
That integration is not in the 140 h, and its availability is not ours to
guarantee.

**Owning the data matches where the obligation sits.** We are the party that must
report participation to EIV-FOBI within 8 days, and we are the party that must be
able to correct a submission within the 7-day correction window. Both of those
require reading the EFN reliably, at a time of our choosing, possibly during a
retry hours after the learner has left. That argues for it being in the same
transactional store as the submission record itself.

**One EFN per user, not per enrolment.** The EFN identifies the person, not their
participation. Storing it per enrolment would let the same physician accumulate
divergent EFNs across courses, and a wrong one produces a submission that is
accepted by EIV but credits the wrong account — the worst failure mode available,
because it looks like success.

## Consequences

**Positive**

- The submission path has no external dependency other than EIV-FOBI itself.
- Retries and corrections work without needing the learner or any third-party
  system to be available.
- Salesforce sync stays possible as a later additive feature in either direction.

**Negative**

- We hold additional personal data and inherit the corresponding GDPR duties:
  lawful basis, retention period, subject access and erasure. These must be
  covered in the privacy documentation before launch.
- The learner is asked for their EFN, which is friction in the completion flow.
  Mitigated by asking once and reusing it for every subsequent course.
- If MEDICE later populates EFNs in Keycloak or Salesforce, there will be two
  values that can disagree. A reconciliation rule will be needed at that point;
  it is not needed now.

## Alternatives considered

**Keycloak custom attribute** — no storage on our side and it arrives with the
token. Rejected: hard dependency on a client-operated system for a
compliance-critical field, plus coverage gaps for existing users.

**Salesforce `vDMC_EFN__c` as source** — matches where MEDICE already manages
physician data. Rejected: puts a CRM integration on the critical path of CME point
award, and the integration is deferred scope.

**Ask for the EFN at submission time without storing it** — minimal data held.
Rejected: makes retries and corrections impossible without re-contacting the
learner, which defeats the 8-day reporting obligation.
