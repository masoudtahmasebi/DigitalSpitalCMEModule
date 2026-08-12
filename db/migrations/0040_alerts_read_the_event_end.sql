-- The deadline alert derives its deadline instead of trusting a column (P58-02).
--
-- `unreported_eiv_submissions` returned `report_due_at`, and the alert service
-- alerted on it. The submission sweep does not: `planEivAttempt` recomputes the
-- window from `event_end_at` through `eivDeadlines`, which is the rule.
--
-- So the platform held two answers to "when is this Punktemeldung due", and QA
-- made them disagree in one sweep: with `report_due_at` moved to yesterday and
-- `event_end_at` still today, the alerter raised `level: "overdue",
-- hoursRemaining: -24` while the submitter — correctly — submitted. One of
-- those two was wrong about a statutory deadline, and nothing in the system
-- could have said which.
--
-- They agree in normal operation, because both columns are written once at
-- queue time and never updated. That is exactly what makes this worth fixing
-- now rather than after: the disagreement appears the first time somebody
-- corrects a completion date, and the symptom is either an alert nobody can
-- act on or silence while the window closes. CLAUDE.md §4 invariant 6 — one
-- rollup path — is the same rule one table across.
--
-- ## What changes
--
-- The function returns the **inputs** to the deadline rather than a
-- precomputed answer: `event_end_at` (the Veranstaltungsende, which for an
-- on-demand course is the learner's completion — see S11) and
-- `first_submitted_at`, which opens the 7-day correction window. The service
-- calls `eivDeadlines` with them, which is the same function the sweep uses.
--
-- The lookback filter moves to `event_end_at` for the same reason: a row whose
-- `report_due_at` column is wrong must not be filtered out of the alert sweep
-- by the wrong value. The window is widened by the reporting period so the
-- filter stays at least as generous as before.
--
-- `report_due_at` stays on the table. It is the record of what the deadline was
-- computed to be, which is worth having in an export and in a support query —
-- it is simply not what anything decides from.
BEGIN;

DROP FUNCTION IF EXISTS unreported_eiv_submissions(timestamptz, integer);

CREATE FUNCTION unreported_eiv_submissions(p_now timestamptz, p_lookback_days integer)
RETURNS TABLE (
    enrolment_id       uuid,
    customer_id        uuid,
    event_end_at       timestamptz,
    first_submitted_at timestamptz,
    report_due_at      timestamptz,
    status             text,
    attempt_count      integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT s.enrolment_id, s.customer_id, s.event_end_at, s.first_submitted_at,
           s.report_due_at, s.status::text, s.attempt_count
      FROM eiv_submissions s
     -- The allow-list from 0035, unchanged. `withdrawn` is a decision a named
     -- human made and recorded; `submitted` is done. Everything else is a row
     -- somebody may still have to act on.
     --
     -- Copied here deliberately rather than reconstructed: the first draft of
     -- this migration reinstated 0011's `status <> 'submitted'`, because that
     -- is the definition a reader finds first — and it would have resumed
     -- alarming three times about every withdrawn Meldung. The integration
     -- suite caught it, which is what it is for (CLAUDE.md §9.9: the oldest
     -- definition of a thing is not its current one).
     WHERE s.status IN ('queued', 'held', 'failed_retryable',
                        'failed_permanent', 'window_closed')
       -- Deliberately generous: `+ 8` covers the reporting window, so a row is
       -- selected on the same input the deadline is computed from and cannot be
       -- excluded by a stale `report_due_at`.
       AND s.event_end_at > p_now - make_interval(days => p_lookback_days + 8)
     ORDER BY s.event_end_at ASC;
$$;

ALTER FUNCTION unreported_eiv_submissions(timestamptz, integer)
    OWNER TO ds_binding_resolver;

-- The definer role holds column-level grants and nothing wider, so a function
-- that reads a new column needs the grant for exactly that column — which is
-- the design working: the first run of this migration failed with "permission
-- denied for table eiv_submissions" rather than quietly widening anything.
--
-- `report_due_at` is deliberately **not** re-granted beyond what it already
-- has: the alerter no longer decides from it, and this function returns it
-- only so a support query through the same function can see what was recorded.
GRANT SELECT (event_end_at, first_submitted_at) ON eiv_submissions TO ds_binding_resolver;

REVOKE ALL ON FUNCTION unreported_eiv_submissions(timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION unreported_eiv_submissions(timestamptz, integer) TO ds_app;

COMMENT ON FUNCTION unreported_eiv_submissions(timestamptz, integer) IS
  'Rows the deadline alerter must consider, with the inputs to the deadline '
  'rather than a precomputed one (P58-02): the caller applies eivDeadlines, '
  'which is the same rule the submission sweep applies.';

COMMIT;
