-- Keep the answer EIV gave us (P119-01).
--
-- ## What was being thrown away
--
-- `packages/eiv-client` separates the two permanent rejections, and its own
-- header says why the distinction is load-bearing:
--
--   * `business` (406) — the VNR is unknown or blocked, or the date is outside
--     the accredited period. **The event is the problem**, and only an operator
--     or the Ärztekammer can fix it.
--   * `validation` (422) — a failed EFN check digit, a point value out of
--     range. **The physician's EFN is the problem.**
--
--   "Retrying either forever hides the problem until the correction window has
--    closed. Reporting them identically sends an operator to the wrong place."
--
-- The classification is made, used to decide that neither is retryable — and
-- then discarded. `planEivAttempt` collapses `auth`, `business` and
-- `validation` into one plan reason, `permanent_rejection`, and
-- `recordPermanentFailure` writes *that* into `last_error`. So the one fact
-- that decides **who can fix this** survives exactly as far as the line that
-- stores it.
--
-- This is CLAUDE.md §9.3 at its sharpest so far: a rule written, tested, and
-- commented with its own justification, whose output is dropped on the floor.
--
-- ## Why a second column and not a wider `last_error`
--
-- They answer different questions and both are worth keeping:
--
--   * `last_error` — **why we stopped.** `attempts_exhausted`,
--     `reporting_window_missed`, `correction_window_closed`,
--     `missing_vnr_password`, `permanent_rejection`. This is the queue's own
--     reasoning and it is what an operator debugging the *worker* wants.
--   * `failure_kind` — **what the far end said.** The EIV client's vocabulary,
--     unchanged. This is what decides whether the physician or the operator is
--     the person who can act.
--
-- Overloading one column would have meant every reader guessing which
-- vocabulary a given value came from, and the guess would be wrong for
-- precisely the rows that matter.
--
-- ## What is deliberately not stored
--
-- EIV's own message. It can carry the EFN and the responding server, and this
-- column is read by a screen a physician sees. A fixed vocabulary cannot leak
-- what a free-text field can (§9.5).

BEGIN;

ALTER TABLE eiv_submissions
  ADD COLUMN failure_kind text;

COMMENT ON COLUMN eiv_submissions.failure_kind IS
  'What EIV-FOBI said on the last failed attempt, in the client''s own '
  'vocabulary: transport, server, rate_limited, auth, business, validation, '
  'unknown. Distinct from last_error, which is why the queue stopped. This is '
  'the column that decides whether the physician or the operator can fix it '
  '(P119-01).';

-- The same vocabulary the client throws and the domain plans against. A CHECK
-- rather than an enum: this is a foreign system's answer, and a value it adds
-- should widen the column without a migration on the type — `unknown` is the
-- landing place and `toFailure` already maps to it.
ALTER TABLE eiv_submissions
  ADD CONSTRAINT eiv_submissions_failure_kind_known
  CHECK (
    failure_kind IS NULL
    OR failure_kind IN (
      'transport', 'server', 'rate_limited',
      'auth', 'business', 'validation', 'unknown'
    )
  );

-- ---------------------------------------------------------------------------
-- Backfill: what can be said honestly about rows that already failed
-- ---------------------------------------------------------------------------
--
-- Almost nothing, and that is the correct outcome rather than a shortfall.
--
-- `missing_vnr_password` is the exception: it never reached EIV at all, so
-- there is no far-end answer to have lost, and the platform itself is the thing
-- that stopped — which is `auth` in the client's vocabulary, in the sense that
-- decides who acts.
--
-- Every historic `permanent_rejection` stays NULL. It could have been any of
-- the three, and inventing one would put "check your EFN" in front of a
-- physician whose VNR was the problem — the §9.2 failure this whole ticket
-- exists to prevent, introduced by the migration meant to fix it.
--
-- The RLS dance is 0042's, for 0042's reason: FORCE ROW LEVEL SECURITY applies
-- to `ds_migrator`, so an UPDATE without it matches zero rows and reports
-- success (§9.6).
ALTER TABLE eiv_submissions NO FORCE ROW LEVEL SECURITY;
ALTER TABLE eiv_submissions DISABLE ROW LEVEL SECURITY;

UPDATE eiv_submissions
   SET failure_kind = 'auth'
 WHERE last_error = 'missing_vnr_password';

ALTER TABLE eiv_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE eiv_submissions FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_class
         WHERE relname = 'eiv_submissions'
           AND relrowsecurity AND relforcerowsecurity
    ) THEN
        RAISE EXCEPTION 'eiv_submissions left without FORCE ROW LEVEL SECURITY — refusing to commit';
    END IF;
END
$$;

COMMIT;
