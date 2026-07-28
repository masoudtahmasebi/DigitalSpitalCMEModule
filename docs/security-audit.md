# Security audit — 28.07.2026

Reviewer: Claude Code. Scope: the whole repository at commit `d8c7d85`, plus the
fixes recorded below.

This is P10-01's review carried out in full rather than as a checklist, and it
is written to be re-run: every finding names how it was found and how to
reproduce it, because a finding nobody can reproduce is a finding nobody can
verify was fixed.

**Six findings. All fixed.** Two were in code written the same day; two were
latent from migration 0001; two were dependency and configuration hygiene.
Nothing found was exploitable through the API as shipped — the two database
findings were bounded by application-level filtering that was, in both cases,
correct at every call site. That is precisely why they mattered: `CLAUDE.md` §4
invariant 3 says application filtering is defence in depth and never the only
defence, and in two places it was the only defence.

---

## Findings

### S-01 · `efn_profiles` had no row-level security — **fixed, migration 0013**

**Severity:** high (latent). **Found by:** enumerating `pg_class.relrowsecurity`
across every table rather than trusting that the policy loop had covered them.

Four tables have no RLS. `schema_migrations` holds no tenant data; `users` and
`user_roles` are global by design and documented (a physician holds enrolments
across customers, and roles must be readable _before_ a tenant context exists —
the same chicken-and-egg as project binding). `efn_profiles` was the outlier: it
has no `customer_id`, deliberately (ADR-0004), so migration 0001's policy loop —
which keys on `customer_id` — skipped it, and nothing said so.

Every one of the four call sites filters by a user id taken from a validated
token, so nothing was reachable. But a future query that forgot the filter would
have returned **every physician's EFN across every customer**, and it would have
looked like working code.

_Fixed_ with a policy that grants two distinct rights: read your own row
(`app.user_id`, already set by `runInTenant`), or read a row belonging to
somebody enrolled in the customer whose context is open — which is what the
admin participant list's "EFN: ja/nein" column needs. `WITH CHECK` allows only
the first: an admin may see _that_ a participant has an EFN and may never set
one, because an EFN is the physician's own claim to their Ärztekammer and an
admin who could write it could credit the wrong Punktekonto.

_Verify:_ five tests in `tenant-isolation.integration.test.ts`, including an
unfiltered `SELECT user_id FROM efn_profiles` as a `customer_admin` in tenant A
returning tenant A's physician and not tenant B's.

### S-02 · Tenant policies raised instead of matching nothing — **fixed, migration 0014**

**Severity:** medium (availability and a false guarantee, not disclosure).
**Found by:** S-01's new test failing with `invalid input syntax for type uuid:
""` on a code path that should have returned zero rows.

Migration 0001 states: _"`current_setting(..., true)` returns NULL when unset, so
an unset tenant context matches nothing: the system fails closed."_ That holds
exactly once per connection. `set_config(…, true)` is transaction-local, and at
`COMMIT` the setting reverts to the **empty string** rather than disappearing —
so on every pooled connection after its first tenant request, which after a
minute of traffic is every connection, the policies evaluated `''::uuid` and
raised.

Reproduce:

```sql
BEGIN;
SELECT set_config('app.customer_id', '<a real customer>', true);
SELECT count(*) FROM courses;
COMMIT;
SELECT count(*) FROM courses;   -- ERROR: invalid input syntax for type uuid: ""
```

Fail-closed, so nothing leaked. But an exception is not "matches nothing": a
query that should have returned an empty list returned a 500 with a Postgres
message attached, and the integration test asserting the guarantee passed only
because it ran on a connection that had not yet served a tenant.

_Fixed_ by recreating every policy with `nullif(current_setting(…, true), '')`,
which is NULL for both "never set" and "reverted after a transaction".

_Verify:_ `returns zero rows on a connection that previously served a tenant`,
which is a different test from the pre-existing fresh-connection one and fails
against the old policies.

### S-03 · nodemailer ^7 carried six advisories — **fixed**

**Severity:** high (one advisory), introduced the same day. **Found by:**
`pnpm audit --prod` immediately after adding the dependency.

The range picked when adding certificate delivery admitted a version with six
known issues, one high: a message-level `raw` option bypassing
`disableFileAccess`/`disableUrlAccess` (arbitrary file read and full-response
SSRF), CRLF injection in transport names and `List-*` header comments, and
improper TLS certificate validation during OAuth2 token fetch.

_Fixed_ by moving to `^9.0.3`. `pnpm audit --prod --audit-level=moderate` is
clean, and CI gates on it.

_Note for next time:_ the range was written from memory rather than from the
registry. `pnpm add <pkg>@latest` and then narrowing is the safer order.

### S-04 · Email header injection — **fixed**

**Severity:** high, introduced the same day. **Found by:** reading S-03's CRLF
advisories and asking whether the same class existed in our own code.

The certificate email's sender display name escaped quotes and backslashes but
not CR or LF. A project's `smtp_from_name` is edited by an admin in the console,
so `MEDICE\r\nBcc: attacker@example.com` would have split one header into two —
a silent `Bcc:` on a message carrying a named physician's Teilnahmebescheinigung.
The `subject` (which embeds an author-supplied course title) and `to` were
equally exposed.

_Fixed_ by stripping CR, LF and NUL from every header-bound field before it
leaves the service — not delegated to nodemailer, so the property does not
depend on a version range. The body is deliberately untouched: it is the
message, not a header, and its newlines are the paragraphs.

_Verify:_ `strips CRLF from every header-bound field`, confirmed meaningful by
removing `\r\n` from the character class and watching it fail.

### S-05 · The certificate email linked to a route that does not exist — **fixed**

**Severity:** low (broken link), but the fix is a security improvement.
**Found by:** grepping for a handler matching the URL the email advertised.

The email linked to `/zertifikat/<download-token>` on the portal. No such route
exists in the portal or the API, so the link 404s.

_Fixed_ by linking to the **course page**, which requires signing in, rather
than adding the tokenised route P8-04 imagined. A URL that hands over a
Teilnahmebescheinigung to whoever presents it is a bearer credential sitting in
a mailbox — and mailboxes are forwarded, backed up, synced to phones and
occasionally breached, for a document naming a physician and stating what they
were examined on. The authenticated path (`GET /courses/{slug}/certificate/pdf`,
scoped to the calling learner) satisfies P8-04's actual requirement more
strongly, and Keycloak's SSO session usually makes the sign-in invisible.

The download token stays on the row: it is the certificate's non-enumerable
identifier, and it is what a tokenised URL would use if one is ever genuinely
wanted — with an expiry, which a permanent link in an inbox would also need.

Also fixed alongside: with `PORTAL_BASE_URL` unset the link would have been
`/kurs/<slug>`, a relative path no mail client can resolve. The paragraph is now
omitted entirely; the attachment still arrives.

### S-06 · `ALLOWED_ORIGINS` accepted `*` — **fixed**

**Severity:** low. **Found by:** reading the config schema for values that would
be accepted but shouldn't be.

`cors` treats an array containing `"*"` as a literal origin to match, so a
wildcard would in fact have denied everything — safe, but it reads as "CORS is
broken" and invites somebody to reach for a configuration that genuinely is
open.

_Fixed_ by refusing it at boot with a message saying to list origins explicitly.

---

## Areas reviewed and found sound

Recorded so a future audit knows what was already checked, and how.

| Area                               | Finding                                                                                                                                                                                                                                         |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SQL injection**                  | Every `${…}` inside a Drizzle `sql` template is a bound parameter or a column reference. The single `sql.raw` takes `users.email.name`, a compile-time constant. No string concatenation into SQL anywhere.                                     |
| **Token validation**               | Algorithms restricted to an explicit allow-list, so `alg: none` and HMAC downgrade are refused structurally. Issuer and audience come from the resolved project binding, never from the token.                                                  |
| **Secrets in responses**           | `vnrPassword` and `smtpPassword` are write-only inputs; the read shapes carry only `hasVnrPassword` / `hasSmtpPassword` booleans. No DTO can express the ciphertext.                                                                            |
| **Secrets in logs**                | No logger call interpolates an EFN, an email, a name or a token. The delivery worker logs counts; the SMTP channel returns an error _code_ rather than the server's message, which on a misconfigured server has been known to echo a username. |
| **Personal data in the audit log** | Field names and counts only. Asserted by test for both the EIV and delivery paths.                                                                                                                                                              |
| **XSS**                            | No `dangerouslySetInnerHTML`, no `innerHTML` outside a test, no `eval`, no `new Function`.                                                                                                                                                      |
| **Certificate authorisation**      | Download is scoped to `principal.userId` from the validated token, rate-limited, and `no-store, private`.                                                                                                                                       |
| **CSRF**                           | The API is bearer-token only with `credentials: false` on CORS, so there is no ambient credential to ride. The WordPress token endpoint additionally checks the `wp_rest` nonce in its permission callback, before WordPress's own check.       |
| **WordPress plugin**               | Nonce plus `is_user_logged_in()` on the token endpoint; the token never appears in page HTML; output escaped throughout. 36 checks in `tests/security-test.php`.                                                                                |
| **Committed secrets**              | No high-entropy strings, no private keys. gitleaks gates CI.                                                                                                                                                                                    |
| **Containers**                     | The API image runs as `node`, not root.                                                                                                                                                                                                         |
| **Dependencies**                   | `pnpm audit --prod --audit-level=moderate` clean; CodeQL and gitleaks in CI.                                                                                                                                                                    |
| **Rate limiting**                  | Present on quiz submission, EFN write, completion, certificate PDF, admin upload and admin export — the write paths and the expensive reads.                                                                                                    |

## Accepted risks

Named rather than fixed, with the reasoning, so the next reviewer inherits the
argument instead of rediscovering it.

**`users` and `user_roles` have no RLS.** Both are global by construction. Roles
in particular must be readable before any tenant context exists — resolving
which tenant a caller may act in _is_ the thing roles decide, so a policy keyed
on `app.customer_id` would make the auth path unable to run. The bound is that
`rolesFor` is always `WHERE user_id = <token subject>`, so it can only ever
return the caller's own grants. Revisit if a query against either table is ever
written that is not keyed on a single user id.

**`ParticipationReport.credentials` and `OutboundMessage.transport` are
`Record<string, string>`.** Weaker typing than named fields, accepted because
what a credential _is_ differs per accreditation authority and per transport.
Both carry a "never log this" contract in their doc comments, and both are
asserted absent from audit records by test.

**No automatic retention expiry.** Unchanged from `architecture.md` §10: the
Ärztekammer has not said how long a participation record must be kept, and a
scheduled job deleting CME records on a guessed schedule is the worst available
outcome. Tracked in `docs/show-stoppers.md`.
