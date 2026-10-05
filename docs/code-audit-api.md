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
| TEST-4                      | medium | `eiv-admin.integration.test.ts`                                             | EIV admin routes tested at service level only; guards and response bodies untested                              |
| TEST-5                      | medium | `test/support/fake-s3.ts`                                                   | Multipart upload (every file ≥ 32 MiB) has no integration test                                                  |
| SEC-4                       | low    | `staff-auth.controller.ts:224`, `:328`                                      | Staff login and TOTP verify have no per-IP throttle                                                             |
| OOP-1                       | low    | `learning.service.ts:1017`                                                  | Comment says `cmePoints` is the enrolment snapshot; it is the course's                                          |
| TEST-6                      | low    | `uploads.integration.test.ts:801`                                           | Stall test sleeps 300 ms instead of waiting for the held count                                                  |

## Needs verification

- Department scope on participant password reset (`isMember` is customer-wide).
- A key removed from Keycloak may still verify for up to `JWKS_CACHE_TTL_SEC`.
- ~~Duplicate EIV filing if a submission succeeds and its result row cannot be
  written during shutdown.~~ settled in P249-04: no duplicate filing — EIV is
  idempotent per `(EFN, VNR)` and a repeat answers 200, recorded as success
  (`eiv-client/src/client.ts:27`, `:261`; `eiv.service.ts:227`); the sweep is
  now awaited on shutdown, so the window no longer opens on an orderly stop.
- `listEnrolments` has no LIMIT and one `inArray` of every id.
- ~~`db.module.ts:99` justifies the 120 s idle timeout with the false "2 GB
  upload" claim recorded in CLAUDE.md §11.~~ settled in P249-02: the claim was
  false (the API never carries upload bytes) and the comment is corrected.
