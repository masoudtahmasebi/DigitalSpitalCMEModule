-- P7-06: let the submission worker find work without weakening tenant isolation.
--
-- The problem this solves. `eiv_submissions` is under RLS like every other
-- tenant table, so `ds_app` with no `app.customer_id` set sees zero rows —
-- correctly. But the worker is a background sweep across *all* customers: it
-- has no single tenant to scope itself to before it knows which tenants have
-- work. Chicken and egg, exactly as with `resolve_project_binding` (0002).
--
-- The shape of the answer is the same, and so are its limits:
--
--   * This function returns **routing metadata only** — a submission id and
--     the customer it belongs to. No EFN, no VNR, no payload. Knowing that
--     customer X has work pending discloses nothing about the physician.
--   * Everything after this call happens inside a normal per-tenant
--     transaction with `app.customer_id` set, so the actual row read and every
--     write are scoped by RLS in the ordinary way. The bypass buys exactly one
--     thing: the list of tenants to iterate.
--
-- It also **leases** what it hands out, by pushing `next_attempt_at` forward.
-- Two API instances sweeping in the same second take disjoint sets — the
-- `FOR UPDATE SKIP LOCKED` handles the race inside one statement, and the
-- lease handles the window between claiming and recording an outcome. Without
-- it, a slow submission could be picked up twice and reported to the
-- Ärztekammer twice, which reads as a duplicate participation.
--
-- If the worker dies mid-flight the lease simply expires and the row is picked
-- up again — which is why the lease is short and the outcome write is what
-- clears it.

BEGIN;

CREATE OR REPLACE FUNCTION claim_due_eiv_submissions(
    p_limit         integer,
    p_now           timestamptz,
    p_lease_seconds integer
)
RETURNS TABLE (submission_id uuid, customer_id uuid)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    WITH due AS (
        SELECT s.id
          FROM eiv_submissions s
         WHERE s.status IN ('queued', 'failed_retryable')
           AND (s.next_attempt_at IS NULL OR s.next_attempt_at <= p_now)
         ORDER BY s.report_due_at ASC
         LIMIT p_limit
           FOR UPDATE SKIP LOCKED
    )
    UPDATE eiv_submissions s
       SET next_attempt_at = p_now + make_interval(secs => p_lease_seconds)
      FROM due
     WHERE s.id = due.id
    RETURNING s.id, s.customer_id;
$$;

-- Same owner as resolve_project_binding: the one role that may see across
-- tenants, and only through functions that return routing metadata.
ALTER FUNCTION claim_due_eiv_submissions(integer, timestamptz, integer)
    OWNER TO ds_binding_resolver;

GRANT SELECT (id, customer_id, status, next_attempt_at, report_due_at)
    ON eiv_submissions TO ds_binding_resolver;
GRANT UPDATE (next_attempt_at) ON eiv_submissions TO ds_binding_resolver;

REVOKE ALL ON FUNCTION claim_due_eiv_submissions(integer, timestamptz, integer)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_due_eiv_submissions(integer, timestamptz, integer)
    TO ds_app;

COMMIT;
