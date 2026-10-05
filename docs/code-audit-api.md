# Code audit — `apps/api` — baseline 05.10.2026

Reviewer: Claude Code, with the vendored `nestjs-code-audit` skill (P244-01).
Scope: `apps/api` at commit `d0339fc`. Read-only: nothing was changed by the
audit, and the integration and browser suites were not run.

This file is the **baseline** the weekly audit routine compares against
(P246-01). It reports what is **new** since this list and what has
**disappeared** from it. When a finding is fixed, strike it here in the
fixing commit (`~~SEC-1~~ fixed in P2xx-01`) so the next run does not report
it as resolved again. When a finding is accepted as intended, say so here with
the reason.

Verified: lines marked ✔ were re-read against the code by the session that
wrote this file. Others are the review lane's reading, with file and line, not
re-checked.

## Gates at baseline

| Check                                            | Result                  |
| ------------------------------------------------ | ----------------------- |
| `tsc --noEmit`, run in `apps/api`                | pass                    |
| `eslint apps/api --no-fix`                       | 0 errors, 4 warnings    |
| `pnpm exec vitest run --config vitest.config.ts` | 41 files, 648 tests     |
| `pnpm test:integration`, `pnpm test:e2e`         | not run (need services) |

## Findings

| ID                          | Sev    | Where                                                                       | Finding                                                                                                         |
| --------------------------- | ------ | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| SEC-1                       | high   | `participant.repository.ts:124`, `:238`; `0033_participant_merge.sql:173` ✔ | After a cross-customer merge, customer A's admin can reset (and receives) the shared password, or disable, at B |
| ARCH-1                      | high   | `admin.service.ts:558`; `completion.ts:188` ✔                               | Admin list omits `hasEvaluation`: console and learner disagree on "complete" for a course without questions     |
| ~~RUN-2~~ fixed in P249-02  | high   | `moderation.controller.ts:239`; `object-erasure.service.ts:79` ✔            | Erasure drains the bucket queue inside the ambient transaction; a backlog turns a done erasure into a 500       |
| ~~TEST-1~~ fixed in P250-01 | high   | `staff.service.ts:835`                                                      | The existing-grant check in `setScope` has no test at any layer                                                 |
| ~~TEST-2~~ fixed in P250-01 | high   | `completion.repository.ts:49`, `:170` ✔                                     | Delivery-email route untested; the comment says RLS is the defence, the `userId` predicate is                   |
| ~~TEST-3~~ fixed in P250-01 | high   | `0005_eiv_claim_function.sql:43`                                            | No concurrent test of the EIV claim (`FOR UPDATE SKIP LOCKED`)                                                  |
| ARCH-2                      | medium | `moderation.repository.ts:141` ✔                                            | "Angesehen %" averages every progress row; disagrees with the shared rollup                                     |
| ARCH-3                      | medium | `assessment.service.ts:166`, `:246`; `learning.service.ts:1253`             | Pass-threshold comparison copied outside `@ds/domain`                                                           |
| SEC-2                       | medium | `authoring.dto.ts:327`; `media-check.service.ts:102`                        | Media check fetches any URL and returns its status: SSRF oracle                                                 |
| SEC-3                       | medium | `jwks.provider.ts:58`, `:95`                                                | Every verified token triggers a JWKS fetch                                                                      |
| ~~RUN-1~~ fixed in P249-01  | medium | `problem-details.filter.ts:167`                                             | Oversize body answers 500, not 413; framework 404 text echoes the query string                                  |
| RUN-3                       | medium | `db.module.ts:180`                                                          | Redis has no command timeout; 31 rate-limited routes 500 when Redis is down                                     |
| ~~RUN-4~~ fixed in P249-04  | medium | `db.module.ts:242`; `main.ts:26`                                            | Pools close before the HTTP server on shutdown; in-flight scheduler ticks not awaited                           |
| ~~TEST-4~~ fixed in P250-02 | medium | `eiv-admin.integration.test.ts`                                             | EIV admin routes tested at service level only; guards and response bodies untested                              |
| ~~TEST-5~~ fixed in P250-02 | medium | `test/support/fake-s3.ts`                                                   | Multipart upload (every file ≥ 32 MiB) has no integration test                                                  |
| SEC-4                       | low    | `staff-auth.controller.ts:224`, `:328`                                      | Staff login and TOTP verify have no per-IP throttle                                                             |
| OOP-1                       | low    | `learning.service.ts:1017`                                                  | Comment says `cmePoints` is the enrolment snapshot; it is the course's                                          |
| ~~TEST-6~~ fixed in P250-02 | low    | `uploads.integration.test.ts:801`                                           | Stall test sleeps 300 ms instead of waiting for the held count                                                  |

## Needs verification

- Department scope on participant password reset (`isMember` is customer-wide).
  **Checked in P250-03 and left open — it needs a decision, not a test.**
  The code lets a `department_admin` reset the password of, or disable, any
  participant of their customer: `PARTICIPANT_ROLES` includes the role
  deliberately (`participant.controller.ts:53`), `isMember` counts
  `user_customers` under RLS (`participant.repository.ts:124`), that table
  has no department column (`0025_person_credentials_memberships.sql:207`),
  and no RLS policy anywhere reads a department (`grep -rln app.department
db/migrations` → nothing). The documents say the role's scope is one
  department: `docs/content-model.md:242` ("`department_admin` | one
  department | … learners …"), P1-04 (`docs/backlog/P1.md:127`, unticked),
  P2-01 (`P2.md:39`) and P9-06 (`P9.md:235`, unticked). A participant
  belongs to a customer, not a department, so the documented rule has
  nothing in the data model to apply to. Making it apply is an auth
  behaviour change (and a schema one); recorded as S37 in
  `docs/show-stoppers.md` for the client.
- A key removed from Keycloak may still verify for up to `JWKS_CACHE_TTL_SEC`.
- ~~Duplicate EIV filing if a submission succeeds and its result row cannot be
  written during shutdown.~~ settled in P249-04: no duplicate filing — EIV is
  idempotent per `(EFN, VNR)` and a repeat answers 200, recorded as success
  (`eiv-client/src/client.ts:27`, `:261`; `eiv.service.ts:227`); the sweep is
  now awaited on shutdown, so the window no longer opens on an orderly stop.
- ~~`listEnrolments` has no LIMIT and one `inArray` of every id.~~ settled in
  P250-03: it was a defect, not a risk — at 65,600 enrolments the participant
  list answered 500 (`bind message has 64 parameter formats but 0
parameters`). The five follow-up reads now bind one `uuid[]`
  (`admin.repository.ts`, `anyId`); `completion-flow.integration.test.ts`
  lists 65,600 and reads the last one's EFN. `listEnrolments` itself stays
  unpaged: the screen shows a course's whole roster and paging it is a
  product decision, not this fix.
- ~~`?q` as an array, and a non-uuid id in a path, answer 500.~~ fixed in
  P250-03 for the whole class: 26 admin routes answered 500 to a non-uuid id
  and 3 list routes to a repeated query parameter; all now answer a 400
  problem document via `shared/request-params.ts`, and
  `request-params.test.ts` fails on a new controller parameter without the
  pipe.
- ~~`db.module.ts:99` justifies the 120 s idle timeout with the false "2 GB
  upload" claim recorded in CLAUDE.md §11.~~ settled in P249-02: the claim was
  false (the API never carries upload bytes) and the comment is corrected.
