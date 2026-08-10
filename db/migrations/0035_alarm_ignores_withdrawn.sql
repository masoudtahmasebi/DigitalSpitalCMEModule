-- A withdrawn Punktemeldung is not an unreported one (P33-01).
--
-- `unreported_eiv_submissions` has selected `status <> 'submitted'` since
-- migration 0011, when those were the only two outcomes that mattered: a row
-- was either reported or it still needed reporting.
--
-- P31-02 added `withdrawn` — a Meldung a named human deliberately took back
-- inside the 7-day correction window, which EIV keeps as a record with its
-- points zeroed. It is the *opposite* of unreported: it was reported, and then
-- retracted on purpose.
--
-- Under the old predicate every withdrawal became a permanent alarm candidate.
-- Nothing would ever move it to `submitted`, so it would escalate `warning` at
-- 48 h, `urgent` at 12 h and `overdue` after that, at whoever is on call, about
-- a decision somebody made deliberately and recorded.
--
-- `eiv-alert.service.ts` says why that matters more than the noise: "An
-- alerting path that re-sends every sweep is one somebody mutes, and a muted
-- alert is worse than none because it is believed to be working." The first
-- alarms this platform would have raised in production would have been three
-- false ones per withdrawal.
--
-- The function is otherwise unchanged, including its grants and owner — this
-- replaces one WHERE clause. Listing the excluded statuses rather than adding
-- `AND status <> 'withdrawn'` is deliberate: the next status added to the enum
-- should have to think about this predicate, and a positive list makes that
-- unavoidable rather than a thing to remember.

BEGIN;

CREATE OR REPLACE FUNCTION unreported_eiv_submissions(p_now timestamptz, p_lookback_days integer)
RETURNS TABLE (
    enrolment_id  uuid,
    customer_id   uuid,
    report_due_at timestamptz,
    status        text,
    attempt_count integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT s.enrolment_id, s.customer_id, s.report_due_at,
           s.status::text, s.attempt_count
      FROM eiv_submissions s
     WHERE s.status IN ('queued', 'held', 'failed_retryable',
                        'failed_permanent', 'window_closed')
       AND s.report_due_at > p_now - make_interval(days => p_lookback_days)
     ORDER BY s.report_due_at ASC;
$$;

COMMIT;
