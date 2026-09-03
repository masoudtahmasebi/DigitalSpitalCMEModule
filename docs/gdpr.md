# Datenschutz — what the platform processes, and why

This is the engineering-side record for the DS Education Platform: what personal
data exists, where it lives, on what legal basis, how long it stays, and what
happens when somebody exercises a right.

It is not a Datenschutzerklärung and it is not legal advice. It is the document
a DPO can be handed to write one, and the document a reviewer can check the code
against. Every claim here corresponds to something enforced in the schema, the
API or the build — where it does not, it says so.

Introduced by **P10-10**.

---

## 1. Roles

|                                     |                                                                                                                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Controller** (Verantwortlicher)   | The customer. For the first deployment: MEDICE Arzneimittel Pütter GmbH & Co. KG. They decide that the Fortbildung happens and who may take it.                                |
| **Processor** (Auftragsverarbeiter) | DigitalSpital, operating this platform on the customer's instruction. An AV-Vertrag under Art. 28 is a precondition of go-live.                                                |
| **Separate controller**             | The Ärztekammer, for the Punktemeldung. Once an EFN and a VNR reach the EIV-FOBI interface, the Kammer processes them under its own statutory mandate, not on our instruction. |

This split is the reason erasure works the way it does — see §5.

---

## 2. What is processed

Everything in one table, because the honest version of this document is short.

| Data                                    | Where                                                                      | Why it exists                                                                                                                                                                                                                                 |
| --------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity-provider subject + realm       | `user_identities`                                                          | The stable identity. Not a name; an opaque id issued by the customer's own IdP. Moved out of `users` by P21-01 so one physician learning with two customers is one person, not two (§2.1).                                                    |
| Name, e-mail                            | `users`                                                                    | Written from the token's claims. Name is printed on the Teilnahmebescheinigung; e-mail is for the future certificate delivery.                                                                                                                |
| Which customers a person learns with    | `user_customers`                                                           | A membership, and the only tenant-scoped part of a person. A customer admin sees that someone learns with them and learns nothing about where else they learn.                                                                                |
| Attested address                        | `enrolments.attested_address`                                              | The Muster's "Anschrift:" line, supplied with the Punktemeldung form (P60-03). Optional — the Bescheid does not require it — and printed on the certificate when given. Cleared by `erase_subject`.                                           |
| Attested name                           | `enrolments.attested_name`                                                 | What the learner confirmed should be printed, which may differ from a stale Keycloak profile.                                                                                                                                                 |
| Attested name, in parts                 | `enrolments.attested_title`, `attested_given_name`, `attested_family_name` | The three fields layout page 13 captures. Composed into `attested_name` by one function in `@ds/domain`; kept apart so a correction does not have to re-parse a string. Cleared by `erase_subject`.                                           |
| Punktemeldung consent                   | `enrolments.consent_given_at`, `consent_document`                          | When the learner ticked the consent box and which privacy notice they agreed to. Art. 7(1) — see §3. **Survives erasure by design**; it names nobody once the name and EFN are gone.                                                          |
| **EFN**                                 | `efn_profiles`                                                             | The 15-digit Fortbildungsnummer. The key the Ärztekammer credits points against. **Readable only by its own subject**: `GET /profile/efn` answers for the authenticated principal and nothing else returns an EFN (ADR-0004, amended P54-02). |
| Watched intervals, quiz answers, scores | `content_progress`, `quiz_attempts`, `quiz_answers`                        | The compliance evidence. A CME point is only defensible if what earned it is recorded.                                                                                                                                                        |
| Evaluation answers                      | `evaluation_responses`                                                     | Required for the Anerkennung. Free-text answers are the one place a physician may type something about a patient — treated accordingly in §5.                                                                                                 |
| Completion, VNR, points                 | `enrolments`                                                               | The participation record.                                                                                                                                                                                                                     |
| Punktemeldung state                     | `eiv_submissions`                                                          | Including the EFN as submitted, every attempt and every failure. Append-only in effect: the row is the evidence a statutory report was made.                                                                                                  |
| Certificate state                       | `certificates`                                                             | Status and the name printed. The serving path renders on demand (P59). **Since P60-01 the issued bytes are also archived in object storage** — see §2.2 — and the row holds the key and a SHA-256, never a URL.                               |
| Admin actions                           | `audit_log`                                                                | Ids, counts and field names. Never a name, an EFN or an answer.                                                                                                                                                                               |

### 2.3 Name and email forwarded by the host site (P105-01)

MEDICE's Keycloak realm issues access tokens carrying no `email`, `given_name`
or `family_name`. Without them a completed course has no name to print on the
Teilnahmebescheinigung, and a certificate with no name is not a valid document.

Their own theme already holds the data: it calls `getUserInfoByToken()` at
sign-in and keeps the profile in the PHP session. The `ds-lms` plugin now
forwards **three fields — email, given name, family name** — to the platform
alongside the token it was already sending.

|                        |                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Category**           | Name, email address                                                                                                 |
| **Source**             | The customer's own site, from their own Keycloak's userinfo                                                         |
| **Legal basis**        | The same as the rest of the enrolment record — Art. 6(1)(b), performance of the CME service the physician asked for |
| **Retention**          | As `users.email`, `first_name`, `last_name`. No separate copy is kept                                               |
| **Purpose limitation** | Filling the certificate and addressing its delivery. Nothing else reads these fields                                |

Two properties worth recording because they bound the risk:

1. **It cannot decide who anybody is.** Identity comes from the `sub` of a token
   verified against the customer's JWKS. `provision_learner` matches on
   `(provider, realm, sub)`; email is never a lookup key.
2. **A claim in the token always wins.** The forwarded value fills only a field
   the token left empty, so a realm that adds the mappers later silently stops
   using it.

**The learner is told.** The widget says that name and email come from the
MEDICE account and that progress is held against it — on the screen, where a
physician can see it, rather than only here. That was the client's own
instruction and it is the right instinct: a transfer nobody is told about is one
nobody can object to.

### 2.2 The one artefact outside the database (P60-01)

Every other item above is a column, and `erase_subject` can redact a column.
The **archived Teilnahmebescheinigung** is an object in a bucket carrying the
participant's name, their Anschrift and their EFN on its face — the platform's
first personal data somewhere SQL cannot reach.

It exists because a rendered document answers "show me my certificate" and only
the stored bytes answer "prove what was issued on 12.08.2026": a re-render years
later has different fonts, a replaced stamp and possibly a lapsed
accreditation. The Kammer, an audit or a dispute asks the second question.

Three consequences, all implemented rather than intended:

- **The key is customer-first**, `<customer>/certificates/<course>/<id>.pdf`,
  checked by a CHECK constraint against the row's own `customer_id`. A bucket
  has no RLS, so the isolation has to be the key.
- **Erasure reaches it.** `erase_subject` writes the key to `object_erasures`
  before clearing the row that names it, and the API deletes the object — in
  the erasure request itself, and again on boot for anything a storage outage
  left behind. `deleted_at` is stamped only after the bucket confirms, so an
  obligation cannot be discharged by being forgotten.
- **Retention follows the certificate**, not a separate clock: the object is
  kept exactly as long as the participation record it evidences (§4).

### 2.1 One person, many customers

Until P21-01 a person _was_ their credential: `users` was keyed
`(keycloak_realm, keycloak_sub)`, so a physician who appeared in two customers'
Keycloak realms was two rows, two `user.id`s — and therefore two EFN slots,
because `efn_profiles` is keyed on `user_id`. Divergent EFNs are the failure
ADR-0004 exists to prevent: a Punktemeldung credits the wrong physician's
Punktekonto, and it looks exactly like success.

So identity is now three things. The **person** (`users`) is global; their
**credentials** (`user_identities`) are global, because the auth guard resolves
one before any tenant context exists; their **memberships** (`user_customers`)
are tenant-scoped and carry the RLS policy.

The data-protection consequence worth naming: two credentials are linked to one
person **only by an explicit, verified act** (P21-05), never automatically
because two identity providers reported the same e-mail address. A provider
that does not verify e-mail could otherwise assert its way into an existing
physician's CME history and EFN, and the platform cannot tell which providers
verify. A credential the platform has not seen creates a new person, always.

**What is deliberately not collected:** postal address (on the ÄKWL Muster but
not in the Bescheid's minimum list — see `docs/show-stoppers.md` S12), date of
birth, telephone number, IP-based analytics, and any behavioural profile beyond
the watch intervals the accreditation requires.

**Data-minimisation decisions worth naming:**

- The catalogue does not return material file URLs; media is resolved per
  request behind the gate, so nothing about a course leaks to a learner who has
  not reached it.
- The admin console reports `efnPresent: boolean` and, since **P179-03**, a
  **masked** EFN — the last four digits — on the participant list, alongside a
  boolean saying whether the queued Punktemeldung still agrees with it. Never
  the full number, and never on any learner-facing route.

  The amendment is narrow and it is the narrowest one that answers the
  question. Two admin screens have carried a masked EFN since P12-05 and P31;
  the participant list is where somebody actually supports a physician whose
  EFN is wrong, and they were the one operator who could not see enough to
  confirm which number was wrong. Four digits confirm a number being read aloud
  and disclose nothing to anybody who does not already have it.

  **Writing** an EFN remains the subject's alone: `efn_profiles`'s RLS
  `WITH CHECK` admits only `user_id = app.user_id`. An operator may correct the
  EFN on a queued **Punktemeldung** — our own outbound report — and cannot
  touch the profile (P179-03).

- Certificate images are reported by presence, never by bytes.
- Log lines carry the request **path** and never the query string
  (`problem-details.filter.ts`), so a capability token in a URL cannot end up in
  a log file.

---

## 3. Legal bases

| Processing                                           | Basis                                                                                                                                                              |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Delivering the Fortbildung to a registered physician | Art. 6(1)(b) — performance of the contract between the physician and the customer                                                                                  |
| Recording watch time, quiz results and evaluation    | Art. 6(1)(c) with the Fortbildungsordnung and the Anerkennungsbescheid — the Kammer's conditions are what make these mandatory rather than optional                |
| Reporting points to the Ärztekammer                  | Art. 6(1)(c). The learner supplies their EFN precisely so that this happens; without the report the participation earns nothing                                    |
| Issuing the Teilnahmebescheinigung                   | Art. 6(1)(b) and (c)                                                                                                                                               |
| Audit log                                            | Art. 6(1)(f) and Art. 32 — accountability for who changed a compliance-relevant setting                                                                            |
| Recording the consent itself                         | Art. 7(1) — the controller must be able to demonstrate that consent was given, which is a duty attached to the consent rather than a processing with its own basis |

**On the consent checkbox (layout page 13).** The transmission to the
Ärztekammer rests on Art. 6(1)(c): the Fortbildungsordnung is what makes it
mandatory, and a physician who supplies their EFN is asking for exactly that
report. The checkbox is therefore **not** the legal basis — withdrawing it would
not make the statutory report unlawful.

It is still recorded, and recorded properly, for two reasons. The layout shows
it, so a physician is told their data is transmitted and is given the chance to
stop before it happens; and if the basis is ever argued to be Art. 6(1)(a)
instead, Art. 7(1) requires evidence that consent was given — evidence a
checkbox nobody wrote down cannot provide. Storing the notice **version** rather
than a boolean is what makes the record mean something: consent to the January
wording is not consent to the June wording.

**Health data (Art. 9) is not processed.** The subject is a physician's
professional training, not any patient. The one place that could change is a
free-text evaluation answer, which is why free text is what erasure removes
first.

---

## 4. Retention

| Data                                                        | Kept                                                                                                                                                  | Why                                                                                  |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Participation record (course, VNR, points, completion date) | Until the Kammer's own retention need lapses; not deleted by the platform on its own initiative                                                       | It is the counterpart of a report already filed                                      |
| `eiv_submissions`                                           | Same                                                                                                                                                  | Evidence that, and when, a statutory report was made                                 |
| Name and e-mail                                             | Until erasure, or until the customer deletes the Keycloak account                                                                                     |                                                                                      |
| EFN                                                         | Until erasure. Deleted immediately on erasure                                                                                                         |                                                                                      |
| Free-text evaluation answers                                | Until erasure. Redacted on erasure                                                                                                                    |                                                                                      |
| `audit_log`                                                 | Indefinitely. Append-only — a database rule refuses UPDATE and DELETE                                                                                 | An audit trail that can be edited is not one                                         |
| `storage_audit_log`                                         | 24 months, then pruned by the maintenance job                                                                                                         | See below — it holds no personal data, and object storage has no RLS to fall back on |
| Application logs                                            | Whatever the host's retention is. **No personal data is written to them** — enforced by `observability/redact.ts`, see §7 and `docs/observability.md` |                                                                                      |

### `storage_audit_log` — why it is here at all (P23-02)

Course media is not personal data: it is a lecture, a slide deck, a handout. So
a log of who uploaded what is **not** a processing record about a participant,
and this table is listed for completeness rather than because a subject request
would ever reach it.

It is still worth naming what it holds, because "it has no personal data in it"
is a claim somebody has to be able to check:

- **`object_key`** — two UUIDs and a filename _we_ generated. The uploader's own
  filename never reaches the platform (`uploadObjectName`), specifically so a
  working title or a patient name in a file called
  `Fallbericht_Müller_final.mp4` cannot end up in a bucket listing or here.
- **`actor_id`** — a pseudonymous identifier for a member of staff, never a
  participant. No name, no e-mail.
- **`detail`** — a short technical reason written by us from a closed set
  (`unsupported_type`, `too_large`, `the object was not found in the bucket`).
  Never a value echoed back from a request.

**Why it exists at all:** object storage has no row-level security. Tenant
isolation there is the `<customerId>/` key prefix plus the server refusing to
sign anything outside the caller's own — a guarantee that lives in application
code rather than in the store, and one that therefore has to be auditable. The
refusals are the entries that matter.

**24 months** because that is long enough to answer "when did this file get
here, and who put it there" for a course still inside its accreditation window,
and there is no reason to keep it past the point where the objects themselves
are gone.

**Open item for the controller:** the Kammer has not been asked how long the
participation record must be retained after the accreditation window closes.
Until they answer, nothing is deleted. That is the conservative direction and
it is a decision for MEDICE, not for the platform.

---

## 5. Subject rights

### Auskunft (Art. 15)

Every figure a learner is entitled to see is already on their own screen — the
API has no data about a learner that the learner cannot read, with one
exception:

- the **audit log**, which records administrative actions rather than the
  learner's own activity.

The EFN used to be the second exception. It is not any more: `GET /profile/efn`
returns the caller's own (P54-02), because a physician who cannot see the
identifier we will report on their behalf cannot notice a typo in it before the
Kammer credits somebody else.

A formal Auskunft is therefore a database export against one `user_id`,
performed by the processor on the controller's request. There is deliberately no
self-service export endpoint — see §8.

### Berichtigung (Art. 16)

Name and e-mail come from Keycloak and are corrected there; the next request
rewrites them. The **attested name** — the one printed on the certificate — is
supplied by the learner at completion, which is the correction mechanism.

The EFN can be re-submitted at any time before completion. Afterwards it cannot,
because it has been reported.

### Löschung (Art. 17) — erasure means pseudonymisation here

`db/migrations/0009_subject_erasure.sql`, last amended by
`db/migrations/0024_layout_fields.sql`, invoked through
`apps/api/src/subject-erasure.ts`.

**Every migration that adds a personal-data column has to amend this function.**
An erasure routine that misses a field added after it was written is this
schema's most predictable failure, and it fails silently: the request succeeds,
the report says three tables were cleared, and the name is still in the row.
0024 is the worked example — three name-part columns, cleared in the same
statement as the composed name they were derived from.

Art. 17(3)(b) excepts processing necessary for compliance with a legal
obligation, and a CME participation record is exactly that: the Punktemeldung
has gone to the Kammer, points are credited against it, and the
Teilnahmebescheinigung is a document a Kammer may ask to see. Deleting the row
would not honour a right — it would destroy the counterpart of a report filed
under somebody's name.

So the fact of participation survives and every identifier is removed:

| Removed                                                     | Kept                                                                        |
| ----------------------------------------------------------- | --------------------------------------------------------------------------- |
| Name, e-mail                                                | Which course, which VNR                                                     |
| EFN (row deleted; the reported copy becomes fifteen zeroes) | Points, category, completion date                                           |
| Attested name, and its title / Vorname / Nachname parts     | That a Punktemeldung was made, and its outcome                              |
| —                                                           | **The consent record** — see below                                          |
| Free-text evaluation answers                                | Scale answers — numbers in an aggregate once the enrolment is pseudonymised |
| The name printed on the certificate                         | Watch and quiz evidence, now unattributable                                 |

What remains cannot be attributed to a person without the Keycloak account,
which the customer deletes on their own side. Pseudonymisation in the sense of
Art. 4(5) becomes anonymisation once the realm entry is gone.

**The credential rows survive the erasure, and that is deliberate.** A
`user_identities` row holds an opaque subject issued by the customer's IdP and
nothing else — no name, no address, no e-mail. Keeping it is what makes an
erased physician who signs in again resolve to the same, still-erased person
rather than to a fresh one with their name written straight back from the
token; see the second refusal below. Delete the credential and the erasure
becomes undoable by the subject themselves.

**The consent record is kept, deliberately.** `consent_given_at` and
`consent_document` survive an erasure. Art. 17(3)(b) and (e) except processing
necessary for a legal obligation and for the establishment or defence of legal
claims, and the evidence that a transmission to the Ärztekammer was authorised
is squarely both. It also names nobody: a timestamp and a document version
attached to a row whose name and EFN are gone identify no one, and erasing it
would destroy the one thing that answers "was this report authorised?" while
leaving the report itself in place.

**Two things the implementation refuses to do:**

1. **Erase while a Punktemeldung is open.** The EFN is the key the report is
   credited against; removing it mid-flight leaves a report that can neither be
   completed nor corrected, and the correction window closes permanently. The
   function raises rather than proceeding. The delay is days; Art. 12(3) allows
   a month.
2. **Let an erasure be undone by a sign-in.** `provisionOrUpdate` writes the
   profile from the token on every request, so an erased subject signing in
   again would have their name written straight back — silently, as a side
   effect of a normal request. A database trigger blanks the columns on every
   update once `erased_at` is set. It still fires through `provision_learner`
   (migration 0025), which is the only writer on that path. There is an
   integration test that fails when the trigger is removed.

The erasure is recorded in `audit_log` with the user id, the stated reason and
counts — never the erased values, which would make the audit row the one place
the name survived.

### Datenübertragbarkeit (Art. 20)

The participant CSV export in the admin console covers the controller's side.
A subject-initiated export is not built; the Auskunft path in §5 covers the
right, and a self-service export endpoint is a new authenticated route that
returns a complete personal dossier — see §8.

### Widerspruch (Art. 21)

Not applicable to the compliance processing, which rests on Art. 6(1)(c).

---

## 6. Where the data is, and who else touches it

|                         |                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hosting**             | Hetzner Cloud, Germany. AV-Vertrag with Hetzner required.                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Database**            | PostgreSQL on the same host, on an internal Docker network with no published port.                                                                                                                                                                                                                                                                                                                                                                               |
| **Identity**            | Keycloak, the customer's own realm. The platform never sees a password and never stores a token.                                                                                                                                                                                                                                                                                                                                                                 |
| **Object storage (S3)** | Course media only. Keys are prefixed per customer and the prefix is checked on every resolve, so a key belonging to one customer cannot be signed for another. **No personal data.**                                                                                                                                                                                                                                                                             |
| **EIV-FOBI**            | Receives VNR + EFN. This is the intended disclosure — the whole point of the platform — and the recipient is a separate controller.                                                                                                                                                                                                                                                                                                                              |
| **E-mail**              | The **customer's own SMTP**, so the message never transits a DigitalSpital mail service. Credentials are encrypted at rest and never returned by any API. Since P59-02 the message carries the Teilnahmebescheinigung as a PDF attachment — a name, a course title, a VNR and a points figure, rendered per attempt and never stored. The body still carries no EFN and no score, and the link is to the authenticated course page, never a bearer download URL. |

**No third-party frontend requests at all.** No font CDN, no analytics, no tag
manager, no embedded video platform. The white-label typeface is uploaded by
the customer and served from the API's own origin, which is why
`GET /branding/font` exists (P10-08): a German healthcare site pulling a webfont
from Google transmits every visitor's IP to a US service, and LG München I
(3 O 17493/20) found that unlawful without consent.

**The learner widget sets no cookies and writes nothing to `localStorage` or
`sessionStorage`.** The bearer token is held in a JavaScript closure for the
lifetime of the page and re-fetched from the WordPress endpoint when it expires
(ADR-0003). Nothing the widget does requires a consent banner under §25 TTDSG,
because nothing is stored on or read from the learner's device.

The **admin console** does write three `sessionStorage` entries: the PKCE
verifier, the OAuth `state`, and the page to return to after sign-in. All three
are deleted the moment the callback is handled, none is personal data, and all
are strictly necessary for the login the admin just initiated (§25(2) TTDSG).
The access token itself is not among them — it lives in a closure there too.

---

## 7. Technical and organisational measures (Art. 32)

Enforced, not aspirational — each of these has a test or a database constraint
behind it:

- **Tenant isolation by PostgreSQL RLS**, not application code. `ds_app` is not
  `BYPASSRLS` and owns no table. A dedicated suite attempts cross-tenant reads
  and asserts zero rows (ADR-0002).
- **Every token validated against Keycloak JWKS** — signature, issuer, audience,
  expiry — independently of what WordPress claims (ADR-0003).
- **Secrets encrypted at rest** with the application KMS key: VNR passwords,
  SMTP credentials. Write-only; no API returns them, in any shape.
- **No personal data in logs.** Error logs carry a correlation id, the request
  path without its query string, and an internal reason written by us. The
  reason may name ids and slugs; ADR-0004 forbids an EFN, a name or a free-text
  answer.
- **Problem details only.** No stack trace, no internal identifier and no
  database message crosses the API boundary.
- **Uploads are validated by their bytes.** Certificate images must be PNG or
  JPEG by magic number; fonts must be woff2 or woff by container signature and
  exactly as long as their own header claims. SVG is unreachable in both paths —
  it is executable markup served from our origin.
- **Append-only audit log**, enforced by a rule on the table.
- **TLS everywhere**, automatic Let's Encrypt, no plaintext port published.
- **Dependency and code scanning in CI**: `pnpm audit`, CodeQL, and a lint rule
  set that includes `eslint-plugin-security`.

---

## 8. Deliberately not built, and why

Naming these is part of the record — a reviewer should be able to tell the
difference between an omission and a decision.

- **A self-service data export endpoint.** It is a new authenticated route
  whose successful response is a complete personal dossier: the highest-value
  target in the API, for a right that §5's Auskunft path already satisfies at
  the volumes this platform sees. If it is ever built it needs step-up
  authentication, rate limiting and its own audit trail.
- **An admin-facing erasure button.** The data spans tenants — one physician has
  one EFN and may hold enrolments at several customers — so a `customer_admin`
  erasing "their" learner would remove an identifier another customer's pending
  report depends on. Erasure is an operator action on the controller's written
  instruction.
- **Automatic retention expiry.** Nothing is deleted on a timer, because the
  Kammer has not said how long the participation record must be kept (§4). A
  scheduled job that deleted CME records on a guessed schedule would be the
  worst available outcome.
- **Analytics of any kind.** Out of scope by `CLAUDE.md` §3, and welcome to stay
  there.

---

## 9. Running an erasure

```bash
# On the host, in infra/deploy. Dry run first — this is irreversible.
./dsc as-migrator dist/subject-erasure.js \
  --subject <idp-sub> --reason "Antrag vom 2026-07-28"

# Then, once the printed plan is the right person:
… --subject <idp-sub> --reason "Antrag vom 2026-07-28" --confirm
```

`as-migrator` builds the `ds_migrator` connection string from
`~/ds-education/secrets.env` and injects it into a one-shot container. The form
that used to be here read `$MIGRATION_DATABASE_URL` from the operator's shell,
where it has never been set, and `--env-file .env.production`, a file that has
not existed since the configuration moved out of the clone.

It reports what it will remove — counts only, never names — refuses while a
Punktemeldung is open, and is idempotent: a repeated request is answered rather
than re-executed.

Afterwards, the **controller deletes the Keycloak account**. Until they do, the
subject's name still exists in their IdP, which is theirs to manage and outside
this platform.

---

## 10. Open items before go-live

|                                                                              | Owner         |
| ---------------------------------------------------------------------------- | ------------- |
| AV-Vertrag between MEDICE and DigitalSpital                                  | Both          |
| AV-Vertrag with Hetzner                                                      | DigitalSpital |
| Retention period for the participation record after the accreditation window | MEDICE → ÄKWL |
| Verzeichnis von Verarbeitungstätigkeiten entry, derived from §2 and §3       | MEDICE        |
| Whether the Anschrift on the ÄKWL Muster must be collected (S12)             | MEDICE → ÄKWL |
| Datenschutzerklärung text on the WordPress page hosting the widget           | MEDICE        |
