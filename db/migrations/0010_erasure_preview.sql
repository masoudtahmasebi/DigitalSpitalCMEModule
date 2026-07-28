-- The erasure dry run has to see what the erasure will see (P10-10).
--
-- WHAT WENT WRONG
--
-- `subject-erasure.ts --reason … ` without `--confirm` prints a plan: how many
-- enrolments, how many open Punktemeldungen, whether an EFN is on file. It
-- built that plan with ordinary SELECTs on the CLI's own connection — as
-- `ds_migrator`, with no tenant context — so RLS filtered every tenant-scoped
-- count to zero. A subject with three enrolments and a queued report was
-- reported as:
--
--     { "enrolments": 0, "openSubmissions": 0, "hasEfn": false }
--
-- Two ways that is worse than a crash. An operator reads "0 enrolments" and
-- concludes they have the wrong person, so a lawful request goes unactioned.
-- Or they read "0 open submissions", pass `--confirm`, and are surprised when
-- the erasure refuses — the one number the dry run exists to surface being the
-- one it could not see.
--
-- The erasure itself was never wrong: it runs as `ds_erasure` and refused
-- correctly. Only the preview lied, which is the more dangerous half, because
-- the preview is what a human reads before deciding.
--
-- THE FIX
--
-- The same owner, the same visibility, one function. A preview that cannot see
-- what the operation sees is not a preview.
--
-- Counts only — never a name, an e-mail or an EFN. This is printed to a
-- terminal and, in a runbook, pasted into a ticket.

BEGIN;

CREATE FUNCTION preview_subject_erasure(p_user_id uuid)
RETURNS TABLE (
    already_erased        boolean,
    enrolments            integer,
    open_submissions      integer,
    free_text_responses   integer,
    has_efn               boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT
        u.erased_at IS NOT NULL,
        (SELECT count(*) FROM enrolments e WHERE e.user_id = u.id)::integer,
        (SELECT count(*)
           FROM eiv_submissions s
           JOIN enrolments e ON e.id = s.enrolment_id
          WHERE e.user_id = u.id
            AND s.status IN ('queued', 'held', 'failed_retryable'))::integer,
        (SELECT count(*)
           FROM evaluation_responses r
           JOIN enrolments e ON e.id = r.enrolment_id
           JOIN evaluations q ON q.id = r.evaluation_id
          WHERE e.user_id = u.id AND q.kind = 'text')::integer,
        EXISTS (SELECT 1 FROM efn_profiles p WHERE p.user_id = u.id)
    FROM users u
    WHERE u.id = p_user_id;
$$;

ALTER FUNCTION preview_subject_erasure(uuid) OWNER TO ds_erasure;

REVOKE ALL ON FUNCTION preview_subject_erasure(uuid) FROM PUBLIC;
-- The operator CLI only. `ds_app` is absent here for the same reason it is
-- absent from `erase_subject`: nothing reachable from an HTTP request should
-- be able to enumerate a subject's footprint across every tenant at once.
GRANT EXECUTE ON FUNCTION preview_subject_erasure(uuid) TO ds_migrator;

COMMENT ON FUNCTION preview_subject_erasure(uuid) IS
    'Counts for the erasure dry run, with the same visibility as '
    'erase_subject. Counts only — no name, e-mail or EFN.';

COMMIT;
