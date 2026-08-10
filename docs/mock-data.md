# Mock data — everything standing in for something real

> for anything that is missing, please create mock data, but flag it, and we
> will do it afterwards

This is the flag. Every value in the platform that is a placeholder is listed
here with **what it is**, **where it lives**, **what has to replace it**, and
**who owns that**. Nothing on this page is real, and nothing real belongs on it.

The list exists because the alternative is worse than an empty database: a
placeholder somebody mistakes for content is a placeholder that ships. Where a
mock value could reach a third party — the Ärztekammer, a physician's inbox —
it is not merely marked, it is **constructed so it cannot**, and the mechanism
is named below.

**Before a customer's own physicians use an installation**, work down the
"Before go-live" column. Nothing here should survive that pass.

---

## 1 · Accounts

| What                                                              | Where                                                                                       | Replace with                                                                                    | Owner         |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------- |
| `demo@ds.example` / `demo@dscustomer.example` — demo participants | `packages/seed`                                                                             | Nothing. Delete the account. A demo learner on a live tenant is a points record nobody claimed. | DigitalSpital |
| `verwaltung@<slug>.example` — demo `customer_admin`               | `packages/seed/src/staff.ts`                                                                | The customer's own administrator, invited through **Konten**                                    | Customer      |
| `redaktion@<slug>.example` — demo `course_editor`                 | `packages/seed/src/staff.ts`                                                                | The customer's own author, or their agency                                                      | Customer      |
| The generated passwords                                           | printed once by the seed; `SEED_STAFF_PASSWORD` / `SEED_PARTICIPANT_PASSWORD` override them | —                                                                                               | —             |

Two properties hold and are worth stating because they are what makes seeding
accounts acceptable at all:

- **The addresses cannot receive mail.** `.example` is reserved by RFC 2606, so
  no password reset, no certificate and no invitation can ever be delivered to
  one of these.
- **None of them is exempt from the second factor.** They hold no TOTP secret,
  so the first sign-in follows whatever policy applies — the platform's for a
  `super_admin`, the customer's for these two. Seeding a factor would mean
  seeding a shared secret into the repository, which is the thing the whole
  design refuses.

The first super administrator is **not** seeded. `bootstrap-admin` creates it,
prints its password once, and stores only an Argon2id hash — see
`docs/deployment.md`.

---

## 2 · Accreditation and EIV

This is the part that could do damage, so it is the part built so it cannot.

| What                               | Value                                            | Why it is safe                                                                                                          | Before go-live                                                                                               |
| ---------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| DS demo VNR                        | `9999999999999999999`                            | Nineteen nines is not an issued VNR                                                                                     | Real VNR from the Anerkennungsbescheid, set on the course in **Fortbildungen → Einstellungen**               |
| DS demo Ärztekammer                | "Musterärztekammer (fiktiv, nur zu Testzwecken)" | Says so in the field a certificate prints                                                                               | The accrediting chamber — ÄKWL for the MEDICE course                                                         |
| `DSCourse` (default customer)      | **no** VNR, **no** points, **no** body           | A course without points produces no EIV submission at all — the strongest form of "cannot reach a third party"          | Nothing. This course is meant to stay pointless.                                                             |
| VNR password                       | **never seeded, in any seed**                    | Without it a submission cannot authenticate, so nothing seeded can file a Punktemeldung even with a plausible VNR       | Set per course in the console. It is write-only: encrypted at rest, never returned by any API, never logged. |
| EIV base URL                       | `EIV_BASE_URL`, defaulting to the test host      | `EIV_ALLOW_LIVE` must be `yes` before any `*.eiv-fobi.de` host is contacted (ADR-0005)                                  | The production endpoint — blocked on **S26**                                                                 |
| Point flags                        | assumed                                          | —                                                                                                                       | **S25**: which flags this course's Meldung must carry                                                        |
| `Veranstaltungsende` for on-demand | assumed to be the participant's completion date  | The 8-day reporting clock runs from it, so a wrong value is either a rejected submission or a missed statutory deadline | **S11**: ÄKWL must answer. `CLAUDE.md` §7 — do not guess on compliance semantics.                            |
| Test credentials                   | none                                             | —                                                                                                                       | **S27**: EIV support must issue them before the backend-test configuration can be proven at all              |

**The EFN `123456789012345`** appears in the e2e and integration suites only. It
is fifteen sequential digits — structurally valid, and obviously not anybody's.

---

## 3 · Course content

| What                                                                      | Where                 | Replace with                                                                                                                                                                                               |
| ------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lorem ipsum prose                                                         | `DSCustomer`'s course | Nothing — it is deliberately, visibly placeholder text                                                                                                                                                     |
| "Demo-Frage 1: Welche Antwort ist die richtige?" ×5, first option correct | both demo tenants     | The real Lernerfolgskontrolle. **The MEDICE course needs 11 single-choice questions and a 70 % pass threshold** — 70 % is an accreditation condition, not a preference: lowering it voids the Anerkennung. |
| `https://media.example.org/…` video and PDF URLs                          | both demo tenants     | Uploaded files, or a real CDN. The domain is reserved; nothing resolves.                                                                                                                                   |
| `duration_sec` on demo chapters                                           | 660–1500 s            | The real runtime. It is not cosmetic — the watch gate is a percentage of it.                                                                                                                               |
| "Dr. Lorem Ipsum", "Musterinstitut"                                       | `course_experts`      | The wissenschaftliche Leitung and their institution                                                                                                                                                        |
| A 1×1 PNG as stamp and signature                                          | `PLACEHOLDER_IMAGE`   | The real stamp. Deliberately a single transparent pixel rather than convincing artwork — a plausible fake stamp is one somebody eventually ships.                                                          |

### The one the certificate depends on

**S11 (Originalstempel).** The Muster says a Bescheinigung is valid only with the
_Originalstempel_ of the ärztliche Leitung. Whether an embedded stamp image in
an emailed PDF satisfies that is ÄKWL's call, and until they answer, the stamp
above is a placeholder for something that may not be a stamp at all.

---

## 4 · Infrastructure

| What                                                        | Where                                    | Note                                                                                                                                       |
| ----------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `SECRETS_KMS_KEY`, `BACKUP_ENCRYPTION_KEY`                  | generated by `deploy.sh` if unset        | **Never regenerate.** A new KMS key makes every encrypted column unreadable; a new backup key makes every existing backup unreadable.      |
| Keycloak dev realm                                          | `infra/keycloak`                         | Development only. A project's real issuer, audience and realm are set per project in **Organisation**, never in the deployment's env file. |
| `KEYCLOAK_CONSENT_API_KEY` in the supplied WordPress plugin | **not in this repository, deliberately** | The key shipped in the customer's plugin zip is live and should be rotated — **S15**. It has never been committed here and must not be.    |
| S3 credentials                                              | operator-supplied                        | Not generated, not requested and not committed by this repository.                                                                         |

---

## 5 · Known gaps that are not mock data

Recorded here because somebody checking this page will wonder about them.

- **A single-customer operator's app bar shows the platform's name, not their
  customer's.** The console fetches the customer registry only for operators
  holding the `customer` capability, which is exactly the one a `customer_admin`
  lacks — so the label always falls back. Naming it properly means putting the
  customer's name on the _session_, which is a registry read from a pool that is
  not tenant-scoped. Filed in `docs/backlog/P38.md`, not bodged.
- **The learner widget's shadow root is `mode: "closed"`,** so the browser suite
  can assert the seam around it and not the UI inside it. That is the isolation
  working; the widget's own component tests cover what is inside.
- **`ALERT_WEBHOOK_URL` is empty,** so the EIV deadline alarm reaches a log file
  and nothing else. `deploy.sh` warns about it. It wants an endpoint a person
  reads.

---

## 6 · How to seed a complete installation

One command per tenant, each idempotent on its slugs, each printing its
credentials exactly once:

```
pnpm db:seed:default   # DSCustomer / DSOrganisation / DSProject / DSCourse
pnpm db:seed:ds        # the DS test tenant, two courses, one with points
pnpm db:seed           # the MEDICE ADHS course
```

Then the first operator, which no seed creates:

```
docker compose run --rm --entrypoint node api dist/bootstrap-admin.js \
  --email <address> --name "<name>"
```

Every seeded tenant reaches the portal at
`https://<PORTAL_LABEL>.<BASE_DOMAIN>/<project-slug>` and the console at
`https://<ADMIN_LABEL>.<BASE_DOMAIN>` — both hostnames derived from the one
`BASE_DOMAIN`, see `infra/deploy/domains.sh`.
