-- Security audit finding: `efn_profiles` was protected by application code alone.
--
-- ## What was wrong
--
-- `CLAUDE.md` §4 invariant 3 is explicit: "Application code that filters by
-- `customer_id` in a `WHERE` clause is defence in depth, never the only
-- defence." `efn_profiles` was the one tenant-relevant table where it *was* the
-- only defence.
--
-- It has no `customer_id`, deliberately — one physician has one EFN across every
-- customer (ADR-0004), because divergent EFNs would let a Punktemeldung credit
-- the wrong person's Punktekonto. So the blanket policy loop in migration 0001,
-- which keys on `customer_id`, skipped it and nobody noticed.
--
-- Nothing was exploitable: every query against it filters by a user id taken
-- from a validated token, and the audit checked all four call sites. But the
-- failure mode is exactly the one RLS exists to prevent — a future query that
-- forgets the filter returns *every physician's EFN across every customer*, and
-- it would look like working code.
--
-- ## The policy
--
-- Two ways a row is visible, and they are not the same right:
--
--   1. **It is yours.** `app.user_id` is already set by `runInTenant` for every
--      request, so this needs no new plumbing. Covers the learner reading and
--      writing their own EFN.
--   2. **You are looking at your own tenant's participants.** An admin's
--      participant list shows "EFN: ja/nein" per learner, which means reading
--      rows belonging to other people — but only people enrolled in a course of
--      the customer whose context is open.
--
-- `WITH CHECK` allows only the first. An admin may see *that* a participant has
-- an EFN; they may never set one. The EFN is the physician's own claim about
-- their identity to their Ärztekammer (ADR-0004), and an admin who could write
-- it could credit somebody else's Punktekonto.
--
-- ## `nullif(..., '')`
--
-- `current_setting('app.user_id', true)` returns `''` — not NULL — when the
-- variable was never set, and `''::uuid` raises rather than yielding NULL. A
-- background worker runs with no `app.user_id`, so without the `nullif` the
-- first clause would throw instead of simply being false.

BEGIN;

ALTER TABLE efn_profiles ENABLE ROW LEVEL SECURITY;
-- FORCE, so the policy applies to the table's owner too. Without it a future
-- migration that runs as the owner would silently see everything.
ALTER TABLE efn_profiles FORCE ROW LEVEL SECURITY;

CREATE POLICY efn_profiles_scope ON efn_profiles
  USING (
    user_id = nullif(current_setting('app.user_id', true), '')::uuid
    OR EXISTS (
      SELECT 1
        FROM enrolments e
       WHERE e.user_id = efn_profiles.user_id
         AND e.customer_id = nullif(current_setting('app.customer_id', true), '')::uuid
    )
  )
  WITH CHECK (
    user_id = nullif(current_setting('app.user_id', true), '')::uuid
  );

COMMIT;
