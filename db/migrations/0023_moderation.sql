-- What moderation needs that the schema did not have (P12-05).
--
-- Two gaps, both found by building the console path and running it rather than
-- by reading the schema.
--
-- ===========================================================================
-- 1. A certificate can be withdrawn
-- ===========================================================================
--
-- `certificate_status` had `pending`, `issued`, `delivered` and `bounced` —
-- four states of *delivery*, and no state for "this document should no longer
-- be relied on". A certificate carrying a misspelled name or a wrong date has
-- to be withdrawable, and the alternative people reach for when there is no
-- such state is deleting the row, which takes the evidence with it.
--
-- Revoking is deliberately not deleting. The enrolment, the progress, the quiz
-- attempts and any Punktemeldung stay exactly where they were: what the
-- physician earned, they earned. What is withdrawn is the PDF.

BEGIN;

-- Inside the transaction, which PostgreSQL 12+ permits for `ADD VALUE` as long
-- as the new label is not *used* in the same transaction. It is not: nothing
-- here writes a `revoked` row.
ALTER TYPE certificate_status ADD VALUE IF NOT EXISTS 'revoked';

COMMENT ON TYPE certificate_status IS
    'pending → issued → delivered is the happy path; bounced is a delivery '
    'failure; revoked withdraws the document without touching the record '
    'behind it (P12-05).';

-- ===========================================================================
-- 2. The application may perform a subject erasure
-- ===========================================================================
--
-- `erase_subject` (migration 0009) was granted to `ds_migrator` and to nobody
-- else, so the only way to honour a GDPR Art. 17 request was for somebody with
-- migration credentials to run it by hand. That was a reasonable place to start
-- — an irreversible cross-tenant operation is not one to expose casually — but
-- it means the erasure path the documentation describes has never been reachable
-- from the product, and a subject right that depends on a DBA being available is
-- not much of a right.
--
-- ## What granting this does and does not open
--
-- `ds_app` gains the ability to call one function. It does **not** gain
-- BYPASSRLS, and it does not gain any privilege on the tables the function
-- touches — `SECURITY DEFINER` means the body runs as `ds_erasure`, whose
-- grants are enumerated in 0009 and are narrower than `ds_app`'s own.
--
-- The function is also not a blunt instrument: it refuses while a Punktemeldung
-- is pending, it pseudonymises rather than deleting enrolments so the CME
-- record survives, and it writes its own audit row. Everything that makes an
-- erasure safe is inside it, which is exactly why the API calls it instead of
-- doing any of that itself.
--
-- The application-side controls are the ones that belong in the application:
-- `customer_admin` or above (`learner_record` capability), a hard rate limit,
-- and a second audit row naming the operator.

GRANT EXECUTE ON FUNCTION erase_subject(uuid, text) TO ds_app;

COMMIT;
