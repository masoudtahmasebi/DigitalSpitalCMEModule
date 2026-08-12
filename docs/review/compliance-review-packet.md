# Compliance review packet — nine held items

**Branch** `claude/education-platform-roadmap-3vgrqh` · **head** `5aabd3b` ·
assembled 12.08.2026 (P62-01).

CLAUDE.md §2 holds anything touching **auth**, **assessment**, **eiv** or
**certificates** for human review before merge, because a wrong result in those
four areas is a compliance incident rather than a bug. Nine items are held. Each
is on the branch and each ticket carries an unticked `[ ] Human review` line.

This file exists because those nine lines are spread across seven tickets and
say what changed rather than what a reviewer must decide. **A reviewer does not
need a diff summary; they need the question.** Every section below states the
defect, the fix, the decision that is theirs, and — the part that is usually
missing — **what goes wrong if they decide the other way**, so that "approve"
and "reject" are both informed choices.

## Before anything else: the label has no vehicle

`needs-human-review` is a **pull-request** label, and there is no open pull
request for this branch. PRs #8 and #9 were opened from it and are closed;
nothing since P44 has a review vehicle at all.

So the honest statement is: **the nine items are marked in their tickets and
labelled nowhere.** That is a process gap, not a code one, and it is the first
thing to fix — a review gate that exists only in a Markdown file is CLAUDE.md
§9.3 applied to a workflow: a rule written is not a rule enforced.

Recommended: open one PR from this branch, apply `needs-human-review`, and link
this packet from its description. Not done here because opening a PR is the
client's call.

---

## Reading order

The nine are not equally consequential. In descending order of what a wrong
decision costs:

| #   | Item   | Area         | If the reviewer is wrong                                        |
| --- | ------ | ------------ | --------------------------------------------------------------- |
| 1   | P55-01 | assessment   | a CME point issued for a video nobody watched                   |
| 2   | P56-01 | assessment   | the answer key handed to a physician being examined             |
| 3   | P58-02 | eiv          | a statutory deadline missed, or an alarm nobody can act on      |
| 4   | P58-01 | eiv          | an operator told a correction window is closed when it is open  |
| 5   | P54-02 | auth         | a physician's permanent identifier readable by the wrong person |
| 6   | P60-01 | certificates | personal data in a bucket that erasure cannot reach             |
| 7   | P59-01 | certificates | earned certificates never delivered                             |
| 8   | P60-02 | certificates | an EFN printed on a document that travels by e-mail             |
| 9   | P53-01 | —            | an accredited course hidden from the physicians enrolled on it  |

P59-02 and P60-03/04 are held with their siblings but carry no independent
decision; they are noted at the end.

---

## 1 · P55-01 — the first playback report had no wall-clock floor

**Area: assessment.** Ticket: `docs/backlog/P55.md`. Commit `d2ee843`.

### The defect

Every playback report after the first was checked against elapsed wall-clock
time — you cannot claim 600 seconds of video in 60 seconds of real time. The
**first** report of a session had nothing to check against, because the budget
was measured from the previous report and there was none.

So a client could enrol and immediately claim the whole video in one request.
The watch gate is what a CME point is issued against, and it was open by exactly
one request per session.

### The fix

The budget for a first report runs from the **enrolment's own `created_at`**
rather than from a previous report. There is always a prior instant; it was
simply not being used.

### The decision the reviewer owns

**Is elapsed wall-clock time the right budget at all, and is the enrolment the
right anchor for the first report?**

The alternative anchors are the session start (which the server does not
observe) and the content's first `GET` (which would need a new stored
timestamp). The enrolment was chosen because it exists, is server-set, and
cannot be moved by a client.

### What goes wrong if it is decided the other way

- **Reject the wall-clock budget entirely** and the union-of-intervals rule is
  the only defence left. That rule stops a _scrub bar_, not a scripted client:
  a caller posting `{startSec: 0, endSec: 1500}` gets 100 % watched and a CME
  point. This is the case QA reproduced.
- **Anchor on something later than the enrolment** — a first `GET` — and a
  learner who opens a course, leaves, and returns three days later gets a budget
  of three days on their first report, which is the same hole with an extra
  step.
- **Anchor on something earlier** and there is nothing earlier.

### What a reviewer can check without reading code

`packages/domain` holds the rule and is exhaustively tested; the integration
suite exercises the call site. The property to be satisfied with is: _no
sequence of requests can credit more watched seconds than have elapsed since the
learner enrolled._

---

## 2 · P56-01 — the answer key was revealable on a point-bearing course

**Area: assessment.** Ticket: `docs/backlog/P56.md`. Commit `94f1d67`.

### The defect

`courses.reveal_correct_answers` made per-question correctness visible in the
quiz result. It was intended for practice material. Nothing stopped it being set
on a course that awards CME points — where the Lernerfolgskontrolle is an
examination, and showing the key turns unlimited retries into a guaranteed pass.

### The fix

Two layers. `mayRevealCorrectAnswers` in `@ds/domain` refuses the reveal
whenever the course awards points, and a CHECK constraint
(`courses_no_answer_key_for_points`, migration 0039) refuses the row.

### The decision the reviewer owns

**Is "awards CME points" the right line, or should the platform never reveal
correct answers at all?**

### What goes wrong if it is decided the other way

- **Never reveal**, and a genuinely educational point-free course loses a
  legitimate teaching feature — the reveal exists because somebody asked for it.
  Cost: a feature nobody can turn on. Reversible.
- **Keep the toggle unconditional** and an author, or an import, or a
  copy-of-a-course, can put the answer key in front of a physician sitting an
  accredited examination. Cost: the accreditation's 70 % condition becomes
  meaningless, and it is not visible from any screen that it has. Not
  reversible, because the points were already reported.

The asymmetry is why the current line was chosen. A reviewer who disagrees
should say which of the two costs they prefer, not merely that the line is
arbitrary.

---

## 3 · P58-02 — the alerter and the submitter disagreed about a statutory deadline

**Area: eiv.** Ticket: `docs/backlog/P58.md`. Commit `88352ca`.

### The defect

Two answers to "when is this Punktemeldung due". The submission sweep computed
it from `event_end_at` through `eivDeadlines` — the rule. The deadline alerter
read the stored `report_due_at` column. QA made them disagree in one sweep: the
alerter raised `level: "overdue", hoursRemaining: -24` while the submitter,
correctly, submitted the row.

They agree in normal operation because both are written once at queue time and
never updated — which is what made this survive.

### The fix

`unreported_eiv_submissions` (migration 0040) returns the **inputs** —
`event_end_at`, `first_submitted_at` — and the alert service applies
`eivDeadlines`. One rule, one answer. `report_due_at` stays as a record of what
was computed and is no longer what anything decides from.

### The decision the reviewer owns

**Is the derived deadline authoritative, or should the stored column be?**

Behind it sits a question only the ÄKWL can answer, recorded in
`docs/show-stoppers.md`: **what is `Veranstaltungsende` for an on-demand
course?** The platform currently passes the learner's completion instant. If
that is wrong, both the alerter and the submitter are wrong together — which is
better than being wrong separately, and is the actual argument for this change.

### What goes wrong if it is decided the other way

- **Trust the column** and the first correction to a completion date produces
  either an alarm nobody can act on (deadline appears passed, submission
  succeeds) or silence while an 8-day statutory window closes. Nothing in the
  system can say which of the two answers is right, because both are stored
  facts.
- **Keep both** — the state before this change — and the disagreement is
  invisible until somebody edits a date.

---

## 4 · P58-01 — the correction window was never recorded

**Area: eiv.** Ticket: `docs/backlog/P58.md`. Commit `88352ca`.

### The defect

`eiv_submissions.correction_window_ends_at` was NULL on every successfully
submitted row, permanently. The window opens when the first Meldung lands, so
the plan computed _before_ that submission had no window to store — and a
submitted row is never swept again, so nothing came back to fill it in.

Nothing _decided_ from the column, which is why it survived. But it is the
record an operator reads, an export carries and a support query answers from,
and NULL there says "no correction window" about a Meldung whose window closes
in seven days.

### The fix

The service recomputes the deadlines with the `firstSubmittedAt` it is about to
record, and stores that. The window is anchored to the **first** submission and
stays there: a row that retried on day three does not get ten days to correct.

### The decision the reviewer owns

**Is the correction window anchored to the first submission or to the most
recent one?** The Bescheid says seven days; it does not say seven days from
what, and the platform has chosen the first.

This is the one item in the packet where the reviewer may need to ask the ÄKWL
rather than decide. If they do, it belongs in `docs/show-stoppers.md` with an
owner rather than being settled here.

### What goes wrong if it is decided the other way

- **Anchor on the latest attempt** and a submission that retried for three days
  appears to have ten days of correction window. If the Kammer counts from the
  first, the platform will tell an operator a window is open after it has
  closed, and the correction will be refused at the point it matters.
- **Leave it NULL** — the state before this change — and every operator reading
  the row concludes there is no window at all.

---

## 5 · P54-02 — a physician may read their own EFN

**Area: auth.** Ticket: `docs/backlog/P54.md`. Commit `2e8ac93`/`d11c92f`.

### The defect

There was no way for a physician to see the EFN the platform holds for them.
ADR-0004 had said no endpoint returns an EFN, full stop. That is safe and it
means a typo in a fifteen-digit number is uncorrectable, because you cannot
check what you cannot see — and a wrong EFN credits another physician's
Punktekonto and looks exactly like success.

### The fix

`GET /profile/efn` answers for the authenticated principal and takes no subject
parameter. ADR-0004 is amended in place with the reasoning. Nothing else
returns an EFN — QA checked eight endpoints for the value, for any fifteen-digit
run, and for an `efn` key.

### The decision the reviewer owns

**Is "the subject, and only the subject" where the line belongs?**

This reverses a documented data-protection decision. The reviewer is being
asked to agree with the reversal, not merely to notice it.

### What goes wrong if it is decided the other way

- **Restore the absolute rule** and the platform holds a permanent identifier
  for a named physician that the physician themselves cannot audit. A
  transcription error is then only discoverable when the Kammer credits the
  wrong account — after the reporting window has closed.
- **Widen it** — allow a customer admin to read a participant's EFN — and the
  argument for enumeration protection (§9.5) collapses: the accounts are named
  physicians enrolled with a named pharmaceutical company.

The endpoint is rate-limited separately (60/min) and returns only the caller's
own row; there is no parameter to widen.

---

## 6 · P60-01 — the archived certificate is the first personal data outside Postgres

**Area: certificates.** Ticket: `docs/backlog/P60.md`. Commit `abcc0af`.

### The change

MEDICE asked that issued certificates be kept "for later verification, per
course and per customer". The PDF is now written to
`<customer>/certificates/<course>/<certificate>.pdf` with a SHA-256 on the row.
The serving path is unchanged — download and e-mail still render from the
record.

### The decision the reviewer owns

**Two, and they are separable.**

1. **Should the platform keep the bytes at all?** A rendered document answers
   "show me my certificate"; only stored bytes answer "prove what was issued on
   12.08.2026", because a re-render years later has different fonts, a possibly
   replaced stamp and possibly a lapsed accreditation.
2. **Is the erasure mechanism sufficient?** This is the part that is genuinely
   new risk. `erase_subject` cannot delete an object in a bucket, so it queues
   the key in `object_erasures` and the API deletes it — in the erasure request
   itself and again on boot — stamping `deleted_at` only after the bucket
   confirms.

### What goes wrong if it is decided the other way

- **Do not keep the bytes** and a dispute years later can only be answered with
  a reconstruction, which is not evidence. Cost is borne by MEDICE, who asked
  for the archive.
- **Keep the bytes without the queue** — the version that nearly shipped — and
  an erasure returns 200, `audit_log` records it, every table looks right, and a
  PDF carrying a name, an Anschrift and an EFN stays in storage indefinitely.
  This is the failure that matters, and it announces itself to nobody.
- **Queue but never drain** and the obligation is recorded and unmet. That state
  is at least queryable: `object_erasures WHERE deleted_at IS NULL`.

**What the reviewer should specifically check:** the drain runs on the erasure
request and on API boot, and **not on a timer**. That is a deliberate choice —
erasures are rare and a five-minute sweep that finds nothing is a sweep whose
failures nobody reads — but it means an installation that never restarts and
never erases again keeps a failed deletion outstanding. If that is not
acceptable, the fix is a timer and it is small.

---

## 7 · P59-01 — completing a course issued no certificate

**Area: certificates.** Ticket: `docs/backlog/P59.md`. Commit `1dae306`.

### The defect

`certificates` rows were created lazily by the first request that _fetched_ the
certificate. The delivery sweep claims `status = 'issued'`, so the entire
durable delivery pipeline could only ever run for people who had **already
downloaded the certificate themselves** — precisely the population that did not
need the e-mail. A physician who finished a course and closed the tab was never
sent anything.

### The fix

`complete()` issues the certificate, one line below the Punktemeldung.
`issueForEnrolment` answers `undefined` rather than throwing when a course is
missing its stamp, so an authoring gap cannot fail a completion.

### The decision the reviewer owns

**Should a certificate that cannot be rendered still let the completion stand?**

The platform says yes: the physician met every condition, the point is earned
and the Meldung is queued; a missing stamp image is the organiser's problem.

### What goes wrong if it is decided the other way

- **Fail the completion** and a physician who has watched, passed and evaluated
  is refused their CME point because somebody did not upload a PNG — and the
  8-day reporting window keeps running while it is sorted out.
- **Leave issuance lazy** and delivery silently serves nobody, which is the
  defect.

---

## 8 · P60-02 — the EFN is printed on the certificate

**Area: certificates.** Ticket: `docs/backlog/P60.md`. Commit `abcc0af`.

### The change

MEDICE instructed that the EFN appear on the Teilnahmebescheinigung. It does,
as a labelled line, drawn only when there is one.

### The decision the reviewer owns

**Does the client's instruction override ADR-0004's minimal-footprint reading
for the printed document?**

The ÄKWL Muster has no EFN field. The EFN's function is to identify the
physician to the Kammer through EIV-FOBI, which happens whether or not it is
printed. Printing it puts a permanent physician identifier onto a PDF that is
e-mailed, downloaded, forwarded and filed.

### What goes wrong if it is decided the other way

- **Do not print it** and MEDICE do not get the document they asked for. They
  are the controller and it is their certificate.
- **Print it** — the current state — and the identifier's exposure widens from
  "our database and the Kammer" to "wherever that PDF ends up". The mitigation
  is that the document is already about that physician and already names them;
  the EFN adds a cross-service identifier to a document that had none.

The reviewer should record which of those two they chose and why, because
ADR-0004 will be read again.

---

## 9 · P53-01 — courses are drafts until published

**Area: content, held because it can hide an accredited course.** Ticket:
`docs/backlog/P53.md`.

### The defect

Every course was visible to learners from the moment it was created. A
half-authored Fortbildung was in the catalogue.

### The fix

`courses.status` (migration 0038), defaulting to draft. Learner-facing reads
require `published`.

### The decision the reviewer owns

**Is the retraction warning strong enough?** Unpublishing is one button, and it
hides an accredited course from physicians already enrolled on it. That is the
intended behaviour — a course withdrawn by the Kammer must be withdrawable —
but the wording is what stands between "unpublish" and "unpublish by accident".

### What goes wrong if it is decided the other way

- **No unpublish** and a course the Kammer has withdrawn stays in front of
  learners.
- **Unpublish without a strong warning** and an admin tidying a catalogue
  removes a live Fortbildung from people mid-course.

---

## The three held with their siblings, carrying no separate decision

- **P59-02** — the delivery e-mail promised an attachment and carried none. The
  copy has said "im Anhang" since P8-03 and `compose()` never set
  `attachments`. There is no judgement call: the message was wrong.
- **P60-03** — the Anschrift is captured and printed when supplied. Optional by
  design while **S12 is open with the ÄKWL** (is a blank Anschrift acceptable
  for an online on-demand format?). If the ÄKWL says it is mandatory, this
  becomes a required field and a publish precondition, not a redesign.
- **P60-04** — a test pinning the existing gate: the certificate is issued on
  completion, not on a successful Punktemeldung. Worth a reviewer's eye only to
  confirm they agree with the gate, which the test now states explicitly.

---

## What is _not_ in this packet

Items closed without a review gate, listed so their absence is deliberate:
P54-01, P56-02, P57-01, P60-04's implementation, P61-01. None touches the four
areas.
