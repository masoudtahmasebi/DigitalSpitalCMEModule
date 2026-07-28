# Datenschutz — what the platform processes, and why

This is the engineering-side record for the DS Education Platform: what personal
data exists, where it lives, on what legal basis, how long it stays, and what
happens when somebody exercises a right.

It is not a Datenschutzerklärung and it is not legal advice. It is the document
a DPO can be handed to write one, and the document a reviewer can check the code
against. Every claim here corresponds to something enforced in the schema, the
API or the build — where it does not, it says so.

Introduced by **P10-06**.

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

| Data                                    | Where                                               | Why it exists                                                                                                                                                      |
| --------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Keycloak subject + realm                | `users`                                             | The stable identity. Not a name; an opaque id issued by the customer's own IdP.                                                                                    |
| Name, e-mail                            | `users`                                             | Written from the token's claims. Name is printed on the Teilnahmebescheinigung; e-mail is for the future certificate delivery.                                     |
| Attested name                           | `enrolments.attested_name`                          | What the learner confirmed should be printed, which may differ from a stale Keycloak profile.                                                                      |
| **EFN**                                 | `efn_profiles`                                      | The 15-digit Fortbildungsnummer. The key the Ärztekammer credits points against. **Write-only through the API** — there is no endpoint that returns it (ADR-0004). |
| Watched intervals, quiz answers, scores | `content_progress`, `quiz_attempts`, `quiz_answers` | The compliance evidence. A CME point is only defensible if what earned it is recorded.                                                                             |
| Evaluation answers                      | `evaluation_responses`                              | Required for the Anerkennung. Free-text answers are the one place a physician may type something about a patient — treated accordingly in §5.                      |
| Completion, VNR, points                 | `enrolments`                                        | The participation record.                                                                                                                                          |
| Punktemeldung state                     | `eiv_submissions`                                   | Including the EFN as submitted, every attempt and every failure. Append-only in effect: the row is the evidence a statutory report was made.                       |
| Certificate state                       | `certificates`                                      | Status and the name printed. Not the PDF — it is rendered on demand.                                                                                               |
| Admin actions                           | `audit_log`                                         | Ids, counts and field names. Never a name, an EFN or an answer.                                                                                                    |

**What is deliberately not collected:** postal address (on the ÄKWL Muster but
not in the Bescheid's minimum list — see `docs/show-stoppers.md` S12), date of
birth, telephone number, IP-based analytics, and any behavioural profile beyond
the watch intervals the accreditation requires.

**Data-minimisation decisions worth naming:**

- The catalogue does not return material file URLs; media is resolved per
  request behind the gate, so nothing about a course leaks to a learner who has
  not reached it.
- The admin console reports `efnPresent: boolean`, never the EFN.
- Certificate images are reported by presence, never by bytes.
- Log lines carry the request **path** and never the query string
  (`problem-details.filter.ts`), so a capability token in a URL cannot end up in
  a log file.

---

## 3. Legal bases

| Processing                                           | Basis                                                                                                                                               |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Delivering the Fortbildung to a registered physician | Art. 6(1)(b) — performance of the contract between the physician and the customer                                                                   |
| Recording watch time, quiz results and evaluation    | Art. 6(1)(c) with the Fortbildungsordnung and the Anerkennungsbescheid — the Kammer's conditions are what make these mandatory rather than optional |
| Reporting points to the Ärztekammer                  | Art. 6(1)(c). The learner supplies their EFN precisely so that this happens; without the report the participation earns nothing                     |
| Issuing the Teilnahmebescheinigung                   | Art. 6(1)(b) and (c)                                                                                                                                |
| Audit log                                            | Art. 6(1)(f) and Art. 32 — accountability for who changed a compliance-relevant setting                                                             |

**Health data (Art. 9) is not processed.** The subject is a physician's
professional training, not any patient. The one place that could change is a
free-text evaluation answer, which is why free text is what erasure removes
first.

---

## 4. Retention

| Data                                                        | Kept                                                                                            | Why                                                  |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Participation record (course, VNR, points, completion date) | Until the Kammer's own retention need lapses; not deleted by the platform on its own initiative | It is the counterpart of a report already filed      |
| `eiv_submissions`                                           | Same                                                                                            | Evidence that, and when, a statutory report was made |
| Name and e-mail                                             | Until erasure, or until the customer deletes the Keycloak account                               |                                                      |
| EFN                                                         | Until erasure. Deleted immediately on erasure                                                   |                                                      |
| Free-text evaluation answers                                | Until erasure. Redacted on erasure                                                              |                                                      |
| `audit_log`                                                 | Indefinitely. Append-only — a database rule refuses UPDATE and DELETE                           | An audit trail that can be edited is not one         |
| Application logs                                            | Whatever the host's retention is. **No personal data is written to them** — see §7              |                                                      |

**Open item for the controller:** the Kammer has not been asked how long the
participation record must be retained after the accreditation window closes.
Until they answer, nothing is deleted. That is the conservative direction and
it is a decision for MEDICE, not for the platform.

---

## 5. Subject rights

### Auskunft (Art. 15)

Every figure a learner is entitled to see is already on their own screen — the
API has no data about a learner that the learner cannot read, with two
exceptions:

- the **EFN**, which is write-only by design (ADR-0004) and which the subject
  supplied in the first place;
- the **audit log**, which records administrative actions rather than the
  learner's own activity.

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

`db/migrations/0009_subject_erasure.sql`, invoked through
`apps/api/src/subject-erasure.ts`.

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
| Attested name                                               | That a Punktemeldung was made, and its outcome                              |
| Free-text evaluation answers                                | Scale answers — numbers in an aggregate once the enrolment is pseudonymised |
| The name printed on the certificate                         | Watch and quiz evidence, now unattributable                                 |

What remains cannot be attributed to a person without the Keycloak account,
which the customer deletes on their own side. Pseudonymisation in the sense of
Art. 4(5) becomes anonymisation once the realm entry is gone.

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
   update once `erased_at` is set. There is an integration test that fails when
   the trigger is removed.

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

|                         |                                                                                                                                                                                                            |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hosting**             | Hetzner Cloud, Germany. AV-Vertrag with Hetzner required.                                                                                                                                                  |
| **Database**            | PostgreSQL on the same host, on an internal Docker network with no published port.                                                                                                                         |
| **Identity**            | Keycloak, the customer's own realm. The platform never sees a password and never stores a token.                                                                                                           |
| **Object storage (S3)** | Course media only. Keys are prefixed per customer and the prefix is checked on every resolve, so a key belonging to one customer cannot be signed for another. **No personal data.**                       |
| **EIV-FOBI**            | Receives VNR + EFN. This is the intended disclosure — the whole point of the platform — and the recipient is a separate controller.                                                                        |
| **E-mail**              | Not yet. When certificate delivery ships it uses the **customer's own SMTP**, so the message never transits a DigitalSpital mail service. Credentials are encrypted at rest and never returned by any API. |

**No third-party frontend requests at all.** No font CDN, no analytics, no tag
manager, no embedded video platform. The white-label typeface is uploaded by
the customer and served from the API's own origin, which is why
`GET /branding/font` exists (P10-05): a German healthcare site pulling a webfont
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
# On the host, in the API container. Dry run first — this is irreversible.
docker compose -f docker-compose.prod.yml --env-file .env.production \
  exec -e MIGRATION_DATABASE_URL="$MIGRATION_DATABASE_URL" api \
  node dist/subject-erasure.js --subject <keycloak-sub> --reason "Antrag vom 2026-07-28"

# Then, once the printed plan is the right person:
… --subject <keycloak-sub> --reason "Antrag vom 2026-07-28" --confirm
```

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
