# ADR-0005 — EIV-FOBI integration is built contract-first, behind a harness

- **Status:** Accepted
- **Date:** 2026-07-27
- **Ticket:** P0-05, P7-01, P7-02
- **Deciders:** Masoud Tahmasebi

## Context

EIV-FOBI is the accreditation interface that receives _Punktemeldungen_ — the
report that a named physician (by EFN) participated in an accredited event (by
VNR). It is the only external, legally binding interface in the system.

Two facts make it the dominant schedule risk:

1. **We have not observed its behaviour.** We have documentation. Documentation
   and implementation differ in ways that are only discovered by sending a real
   request — error shapes, field-length limits, date formats, what a duplicate
   submission does.
2. **We do not have credentials.** Sandbox access has been requested and has not
   arrived. It is outside our control.

The reporting obligations are hard: a participation must be reported **within 8
days** of the event end, with a **7-day correction window**. Getting these wrong
is a compliance failure, not a defect.

The default schedule would place this integration in week 5, where the phase
budget puts it. That would mean discovering any documentation/reality divergence
with one week left before a fixed launch date, and it would mean the entire
feature is blocked on a third party's credential turnaround.

## Decision

**Build the test before the integration, in week 1, and separate the deadline
logic from the transport entirely.**

Three parts:

1. **`apps/eiv-harness`** — a standalone runnable CLI that performs the real
   sequence: authenticate (VNR + password) → JWT →
   `POST /fobi/veranstalter/push_teilnahme` with a test EFN and
   `rolle: TEILNEHMER`, and prints exactly what was sent and exactly what came
   back, including non-2xx bodies.

2. **A mock server built to the documented contract**, shipped alongside it. Until
   credentials arrive, the harness and the production submission path both run
   against the mock, so every code path — success, rejection, timeout, retry,
   duplicate, deadline breach — is exercised before any credential exists.
   `EIV_BASE_URL` is the only thing that changes between mock, sandbox and live.

3. **Deadline invariants as pure functions in `packages/domain`**
   (`eivDeadlines`), unit-tested with zero external dependency: the 8-day
   reporting due date, the 7-day correction window, `isOverdue`, `needsAlert`.

Every attempt — success or failure — writes to an append-only audit log. A
submission approaching its deadline raises an alert rather than failing silently.

## Rationale

**A harness converts an unknown-duration risk into a fixed-duration one.** The
question "does the API behave as documented?" is currently unanswerable and could
cost anywhere between zero and several days. With the harness already written, the
moment credentials arrive that question is answered in minutes, whatever week that
happens in. The work that can be done without credentials is done first; only the
irreducible unknown waits.

**Building the mock to the documented contract is what makes week 1 productive.**
Without it, the retry queue, the deadline handling, the audit log and the error
taxonomy would all have to be written blind and untested in week 5. With it, they
are written and tested in weeks 1 and 5 against a known contract, and pointing at
the sandbox becomes a configuration change plus a diff review — not new
development.

**The deadline logic must not live in the transport layer.** The 8-day and 7-day
rules are the part with legal weight, and they are also the part most easily
tested — they are date arithmetic. Putting them in `packages/domain` means they
can be exhaustively covered (day 8 exactly, DST boundaries, submission on the last
valid day, correction attempted one day late) without an HTTP client, a network,
or credentials. Coupling them to the API client would make every one of those
tests need a mock, and some of them would simply not get written.

**Alerting rather than silent failure.** A queued submission that never sends
looks identical to a healthy system from the outside — the learner has their
certificate, the record exists locally, and nothing is on fire. The only thing
that surfaces it is an explicit alert on approaching deadline. This is why
`needsAlert` is part of the domain function rather than an operational
afterthought.

## Consequences

**Positive**

- The launch date is no longer hostage to credential turnaround. The declared
  fallback — launch with submissions queued and held, flip to live as a small
  follow-up — is viable precisely because the code path is already tested.
- Divergence between documentation and reality is discovered with weeks of slack
  rather than days.
- The compliance-critical arithmetic is covered by fast, dependency-free tests
  that run on every commit.

**Negative**

- The mock is built from documentation, so it encodes our _assumptions_. A
  divergence in the real API will still require changes — the harness shortens the
  discovery, it does not eliminate the work. The mock must be corrected to match
  reality once observed, or it becomes actively misleading.
- Maintaining a mock server is real, if small, ongoing cost.
- The audit log grows unboundedly and needs a retention policy before launch.

**Submission timing (added 27.07.2026):** the Punktemeldung fires **immediately on
completion**, not batched or scheduled, then retries **3 times at 10-minute
intervals** before slower backoff. This is a compliance decision, not a
performance one. The 8-day reporting window runs from `Veranstaltungsende`, whose
value for an on-demand course is still an open question with the Ärztekammer (show
stoppers S11) — but submitting within seconds of completion means no plausible
reading of that date, except an already-expired one, can put the submission
outside its window. Speed is the cheapest hedge against an ambiguity we do not yet
control. It is a hedge, not a fix: if `Veranstaltungsende` turns out to be the
event date already past, EIV rejects regardless of speed, and the retry loop must
still stop when `shouldStopRetrying` is set rather than hammer a closed window.

**Hard checkpoint:** if EIV sandbox credentials have not arrived by **23.08.2026**
(end of week 4), the fallback applies: launch with submissions queued and held,
flip to live submission as a follow-up. The learner experience and the certificate
are unaffected by that fallback — this is a deliberate property of the design, and
the reason the certificate path (P8) has no dependency on a successful EIV
submission.

## Alternatives considered

**Integrate in week 5 as originally budgeted** — the conventional ordering, and
cheaper if everything goes right. Rejected: it concentrates the only
externally-dependent unknown in the last week before a fixed date.

**Wait for sandbox credentials before writing any EIV code** — avoids building
against assumptions. Rejected: it makes the schedule a function of a third party's
response time, with no work possible in the meantime.

**Skip the mock and test only against the sandbox once available** — avoids
encoding assumptions in a mock. Rejected: it leaves retry, deadline and error
handling untestable in CI, permanently, since CI cannot depend on an external
sandbox.

## Update — 09.08.2026: the specification arrived, and the decision held

The Veranstalter Swagger was supplied on 09.08, closing S24. **Five of the six
contract assumptions this ADR was built on were wrong** (P31-01):

| This ADR said                            | It actually is                                    |
| ---------------------------------------- | ------------------------------------------------- |
| authenticate (VNR + password) → JWT      | `GET /fobi/veranstalter-auth/jwt`, HTTP **Basic** |
| `POST /fobi/veranstalter/push_teilnahme` | correct                                           |
| body carries `rolle: TEILNEHMER`         | no such field; also no `vnr`                      |
| a validation rejection is `422`          | `406` is business, `422` is _format_              |
| success returns a reference              | it returns nothing contractual                    |

**The decision is unchanged and is what made the correction cheap.** All three
parts did the job they were chosen for:

1. The **harness** turned first contact into a diff. Every path, field name and
   status code was one constant away from correct, and `EivExchange` had recorded
   verbatim requests and responses from the start.
2. The **mock** was the weak part, and precisely in the way this ADR's third
   rejected alternative predicted the _absence_ of one would be: it encoded the
   assumptions, so CI asserted them. Eighteen green tests proved agreement with
   ourselves. That is not an argument against the mock — without it the retry and
   deadline paths would have been untested for months — but it is the reason the
   mock's README lists assumptions field by field, and the reason that list was
   the reconciliation checklist.
3. The **pure deadline functions** needed no change at all. `eivDeadlines` and
   `planEivAttempt` gained two failure kinds and nothing else.

**What the specification added that we had not planned for:** a withdrawal
mechanism (a push with the points zeroed), an endpoint returning the accredited
period, and an endpoint returning what the Kammer already holds. The last two
answer S11 and S25 by asking rather than by writing to the Ärztekammer.

The one architectural claim worth restating: _"`EIV_BASE_URL` is the only thing
that changes between mock, sandbox and live."_ That survived. The rewrite touched
the transport's field names and status handling and reached neither the worker
nor the domain.
