-- Reads for the Punktemeldung deadline alarm (P10-06).
--
-- WHY THESE ARE FUNCTIONS AND NOT QUERIES
--
-- The alarm asks a question no tenant can ask: "is *any* submission, anywhere,
-- about to miss its statutory deadline". `ds_app` is not BYPASSRLS and the
-- worker runs outside any request, so a plain SELECT either returns nothing or
-- — as the first version of this code discovered — errors outright, because the
-- policy casts an unset `app.customer_id` and a leftover empty string is not a
-- uuid. Silently returning nothing would have been worse: an alarm that finds
-- no submissions looks exactly like an alarm with nothing to report.
--
-- Same shape as `claim_due_eiv_submissions` (migration 0005), same owner, same
-- reasoning: a narrow SECURITY DEFINER function that returns **no tenant data**.
-- Between them these two return an enrolment id, a customer id, a timestamp, a
-- status, a count and an alert level. No EFN, no VNR, no name. That is what
-- makes reading them without a tenant context defensible rather than merely
-- convenient.

BEGIN;

-- ---------------------------------------------------------------------------
-- What is still unreported
-- ---------------------------------------------------------------------------
--
-- `submitted` is excluded: there is nothing to warn about. Everything else is
-- included, and `queued` is the important one — it looks healthy right up until
-- the window closes, which is the failure this whole alarm exists to catch.
--
-- The lookback bounds the sweep. A row that has just passed its deadline still
-- needs its `overdue` alert; one that missed it a month ago does not need
-- looking at on every tick forever.

CREATE FUNCTION unreported_eiv_submissions(p_now timestamptz, p_lookback_days integer)
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
     WHERE s.status <> 'submitted'
       AND s.report_due_at > p_now - make_interval(days => p_lookback_days)
     ORDER BY s.report_due_at ASC;
$$;

ALTER FUNCTION unreported_eiv_submissions(timestamptz, integer)
    OWNER TO ds_binding_resolver;

GRANT SELECT (enrolment_id, attempt_count) ON eiv_submissions TO ds_binding_resolver;

REVOKE ALL ON FUNCTION unreported_eiv_submissions(timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION unreported_eiv_submissions(timestamptz, integer) TO ds_app;

-- ---------------------------------------------------------------------------
-- Which alert levels have already been raised
-- ---------------------------------------------------------------------------
--
-- Read from the audit log rather than from a column on the submission, and that
-- is deliberate: `audit_log` cannot be UPDATEd or DELETEd (a rule on the table
-- refuses both), so an alert that was raised stays raised. A column could be
-- reset — by an operator, or by a migration nobody thought about — and the next
-- sweep would replay every level at whoever is on call. An alert channel
-- survives being wrong once; it does not survive crying wolf.

CREATE FUNCTION eiv_alerted_levels(p_enrolment_ids text[])
RETURNS TABLE (subject text, level text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT a.subject, a.detail->>'level'
      FROM audit_log a
     WHERE a.action = 'eiv.deadline_alert'
       AND a.subject = ANY(p_enrolment_ids)
       AND a.detail->>'level' IS NOT NULL;
$$;

ALTER FUNCTION eiv_alerted_levels(text[]) OWNER TO ds_binding_resolver;

GRANT SELECT (action, subject, detail) ON audit_log TO ds_binding_resolver;

REVOKE ALL ON FUNCTION eiv_alerted_levels(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION eiv_alerted_levels(text[]) TO ds_app;

-- The alarm reads this on every sweep, filtered by action and by a list of
-- enrolment ids.
CREATE INDEX audit_log_action_subject_idx ON audit_log (action, subject);

COMMENT ON FUNCTION unreported_eiv_submissions(timestamptz, integer) IS
    'Submissions not yet reported, across tenants, for the deadline alarm. '
    'Returns routing metadata only — no EFN, no VNR, no name.';

COMMENT ON FUNCTION eiv_alerted_levels(text[]) IS
    'Alert levels already raised per enrolment, from the append-only audit log. '
    'Read from there rather than a column so an alert cannot be un-raised.';

COMMIT;
