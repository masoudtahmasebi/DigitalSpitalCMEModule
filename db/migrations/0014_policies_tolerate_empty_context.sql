-- Security audit finding: the tenant policies threw instead of returning nothing.
--
-- ## What was wrong
--
-- Migration 0001 says, in a comment above the policy loop:
--
--   > `current_setting(..., true)` returns NULL when unset, so an unset tenant
--   > context matches nothing: the system fails closed.
--
-- That is true exactly once per connection. `set_config('app.customer_id', …,
-- true)` is transaction-local, and when the transaction ends the setting does
-- not disappear — it reverts to the empty string. So on **every connection a
-- pool has ever used for a tenant request**, which after a minute of traffic is
-- every connection, `current_setting('app.customer_id', true)` returns `''`,
-- and `''::uuid` raises:
--
--     ERROR:  invalid input syntax for type uuid: ""
--
-- Reproduced by hand: one transaction with a tenant set, commit, then a query
-- with no context on the same connection.
--
-- ## Why this was still fail-closed, and why it needed fixing anyway
--
-- Nothing leaked. An exception is a perfectly safe way to refuse. But:
--
--   * The documented guarantee — "an unset tenant context matches nothing" —
--     was only true on a fresh connection, and the integration test asserting
--     it passed for that reason rather than because the property held.
--   * A code path that queried without context got a 500 rather than an empty
--     result, so a bug that should have shown up as "no rows" showed up as an
--     internal error with a Postgres message attached.
--   * A future policy written by copying this shape inherits the same defect.
--
-- ## The fix
--
-- `nullif(current_setting(…, true), '')::uuid` — NULL for both "never set" and
-- "reverted after a transaction", and `column = NULL` is NULL, which is not
-- true, which is no rows. Applied to every tenant table, to `audit_log`, and it
-- is the shape migration 0013 already used for `efn_profiles`.
--
-- Policies are recreated rather than altered: `ALTER POLICY` cannot change the
-- expression's dependencies safely across versions, and dropping and recreating
-- inside one transaction is atomic anyway — no window exists in which a table
-- is unprotected.

BEGIN;

DO $$
DECLARE
    t text;
    tenant_tables text[] := ARRAY[
        'customers', 'departments', 'projects', 'courses', 'modules', 'chapters',
        'contents', 'course_experts', 'enrolments', 'content_progress',
        'quiz_questions', 'quiz_options', 'quiz_attempts', 'quiz_answers',
        'evaluations', 'evaluation_responses', 'eiv_submissions', 'certificates'
    ];
    tenant_column text;
BEGIN
    FOREACH t IN ARRAY tenant_tables LOOP
        tenant_column := CASE WHEN t = 'customers' THEN 'id' ELSE 'customer_id' END;

        EXECUTE format('DROP POLICY %1$I_tenant_isolation ON %1$I', t);

        EXECUTE format($f$
            CREATE POLICY %1$I_tenant_isolation ON %1$I
              USING (
                %2$I = nullif(current_setting('app.customer_id', true), '')::uuid
              )
              WITH CHECK (
                %2$I = nullif(current_setting('app.customer_id', true), '')::uuid
              )
        $f$, t, tenant_column);
    END LOOP;
END
$$;

DROP POLICY audit_log_tenant_isolation ON audit_log;

CREATE POLICY audit_log_tenant_isolation ON audit_log
  USING (
    customer_id IS NULL
    OR customer_id = nullif(current_setting('app.customer_id', true), '')::uuid
  )
  WITH CHECK (
    customer_id IS NULL
    OR customer_id = nullif(current_setting('app.customer_id', true), '')::uuid
  );

COMMIT;
