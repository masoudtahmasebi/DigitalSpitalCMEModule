-- Merging two credentials onto one person (P21-05).
--
-- ## Why this needs a SECURITY DEFINER function at all
--
-- The merge was first written as ordinary application SQL on `ds_app`, and the
-- integration suite showed what that produces: **nothing, silently**. Every
-- table it has to read and every table it has to move is tenant-scoped under
-- `FORCE ROW LEVEL SECURITY` — `enrolments`, `efn_profiles`, `user_customers`,
-- `user_roles` — and the whole point of the operation is a physician who exists
-- in *two* places, which are frequently two customers.
--
-- So with the request's tenant context set to one of them:
--
--   * `SELECT` for the other side returned no EFN and no enrolments, so
--     `planCredentialMerge` saw two empty records and allowed every merge;
--   * `UPDATE enrolments SET user_id = …` matched zero rows and reported
--     success.
--
-- A merge that reports success and moves nothing is worse than one that fails:
-- an operator would confirm an irreversible operation, be told it worked, and
-- find the records exactly where they were.
--
-- ## Why a fourth BYPASSRLS role and not an existing one
--
-- `ds_binding_resolver` owns routing metadata, `ds_erasure` owns erasure and
-- `ds_customer_registry` owns the customer list — and each of those migrations
-- asserts, in its own transaction, that its role owns nothing else. That
-- assertion is the mechanism keeping a narrow exemption narrow; adding an
-- EFN-reading function to the routing role would quietly widen a blast radius
-- somebody documented in exactly those terms.
--
-- `ds_merge` therefore owns these two functions and nothing else, and the same
-- assertion is made at the bottom of this file.
--
-- ## What keeps it narrow
--
-- * `EXECUTE` is granted to `ds_app` only, and revoked from `PUBLIC` first —
--   `CREATE FUNCTION` grants it to PUBLIC by default, which would make the
--   merge available to every role in the database.
-- * Executing it is a **capability, not a permission**. The API refuses callers
--   who are not `super_admin` (`participant.controller.ts`), for the reason
--   stated there: a customer-scoped administrator cannot be shown the other
--   side, so they would be confirming against a record they cannot read.
-- * The **policy stays out of SQL.** `participant_merge_side` reports what is
--   there; `planCredentialMerge` in `packages/domain` decides; only then does
--   the application call `merge_participants`. A function that also decided
--   would be a second place the rule lives, and the two would disagree.
-- * `search_path` is pinned. A SECURITY DEFINER function without one can be
--   hijacked by a caller-controlled path resolving `users` to another relation.

BEGIN;

-- ---------------------------------------------------------------------------
-- What ds_merge may touch
-- ---------------------------------------------------------------------------
--
-- BYPASSRLS exempts a role from row-level *policies*. It grants no privilege on
-- any table — a distinction worth stating because the first version of this
-- migration omitted these and every merge failed with "permission denied for
-- table users", which reads like an application bug and is a missing GRANT.
--
-- Listed table by table and verb by verb rather than `ALL ON ALL TABLES`. The
-- role's whole justification is that its reach is small enough to read in one
-- screen, and a blanket grant would make that claim untrue while leaving the
-- comment above it still saying it.

GRANT SELECT                 ON users            TO ds_merge;
GRANT DELETE                 ON users            TO ds_merge;
GRANT SELECT, UPDATE         ON user_identities  TO ds_merge;
GRANT SELECT, INSERT, DELETE ON user_customers   TO ds_merge;
GRANT SELECT, INSERT, DELETE ON user_roles       TO ds_merge;
GRANT SELECT, UPDATE         ON enrolments       TO ds_merge;
GRANT SELECT, INSERT, DELETE ON efn_profiles     TO ds_merge;
GRANT SELECT, UPDATE, DELETE ON learner_sessions TO ds_merge;
GRANT SELECT                 ON courses          TO ds_merge;
GRANT INSERT                 ON admin_audit_log  TO ds_merge;
GRANT USAGE                  ON SEQUENCE admin_audit_log_id_seq TO ds_merge;

-- ---------------------------------------------------------------------------
-- What the domain needs to know about one side
-- ---------------------------------------------------------------------------
--
-- The EFN leaves as a **digest**, never as digits. `planCredentialMerge` only
-- asks whether two numbers differ, and carrying the number into the application
-- would put it in this process's heap and in any exception that quotes a
-- parameter — for no gain (ADR-0004).

CREATE FUNCTION participant_merge_side(p_user_id uuid)
RETURNS TABLE (
    person_id     uuid,
    email         text,
    efn_digest    text,
    course_slugs  text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT u.id,
           u.email,
           (SELECT encode(digest(e.efn, 'sha256'), 'hex')
              FROM efn_profiles e WHERE e.user_id = u.id),
           COALESCE(
             (SELECT array_agg(DISTINCT c.slug)
                FROM enrolments n JOIN courses c ON c.id = n.course_id
               WHERE n.user_id = u.id),
             ARRAY[]::text[])
      FROM users u
     WHERE u.id = p_user_id;
$$;

ALTER FUNCTION participant_merge_side(uuid) OWNER TO ds_merge;
REVOKE ALL ON FUNCTION participant_merge_side(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION participant_merge_side(uuid) TO ds_app;

COMMENT ON FUNCTION participant_merge_side(uuid) IS
    'One side of a credential merge (P21-05). Owned by ds_merge (BYPASSRLS) '
    'because a merge is inherently cross-tenant. Returns the EFN as a SHA-256 '
    'digest, never as digits (ADR-0004). Reads only; the verdict is '
    'planCredentialMerge in packages/domain.';

-- ---------------------------------------------------------------------------
-- The merge itself
-- ---------------------------------------------------------------------------
--
-- One statement block, so it is one transaction with the caller's — including
-- the `admin_audit_log` row. `AuditService` deliberately writes on its own
-- connection so an entry survives the failure of what followed; the opposite is
-- right here. An audit row for a merge that rolled back would send somebody
-- looking for records that never moved.
--
-- ## Why every table is named rather than cascaded
--
-- `learner_sessions` are **ended, not moved**: a session was minted for a
-- credential whose person has just changed, and the safe answer to "is it still
-- valid?" is no. Naming the tables is what made that a decision; an
-- `ON UPDATE CASCADE` on the person id would have carried them across without
-- anyone choosing it.
--
-- `certificates`, `eiv_submissions`, `content_progress`, `quiz_attempts` and
-- the evaluation responses hang off `enrolment_id`, so moving the enrolment
-- carries them. That was checked rather than assumed: a merge that moved the
-- enrolment and left the certificate would produce a PDF in one person's name
-- against another's record, and nothing would have failed.
--
-- ## What it refuses
--
-- Nothing. The caller has already applied `planCredentialMerge`, and a function
-- that re-decided would be the second place the rule lives. What it *does*
-- guarantee is atomicity: nothing here is half-moved.

CREATE FUNCTION merge_participants(
    p_source      uuid,
    p_target      uuid,
    p_actor_id    uuid,
    p_actor_email text,
    p_detail      jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF p_source = p_target THEN
        RAISE EXCEPTION 'merge_participants: source and target are the same person';
    END IF;

    -- The credentials. This is the merge: two ways in, one person.
    UPDATE user_identities SET user_id = p_target WHERE user_id = p_source;

    INSERT INTO user_customers (user_id, customer_id)
    SELECT p_target, customer_id FROM user_customers WHERE user_id = p_source
    ON CONFLICT (user_id, customer_id) DO NOTHING;
    DELETE FROM user_customers WHERE user_id = p_source;

    -- `NOT EXISTS` rather than `ON CONFLICT`: user_roles' unique key includes a
    -- nullable department_id, and in PostgreSQL two NULLs are distinct, so the
    -- constraint never fires on a customer-wide grant.
    INSERT INTO user_roles (user_id, role, customer_id, department_id)
    SELECT p_target, r.role, r.customer_id, r.department_id
      FROM user_roles r
     WHERE r.user_id = p_source
       AND NOT EXISTS (
         SELECT 1 FROM user_roles t
          WHERE t.user_id = p_target
            AND t.role = r.role
            AND t.customer_id IS NOT DISTINCT FROM r.customer_id
            AND t.department_id IS NOT DISTINCT FROM r.department_id);
    DELETE FROM user_roles WHERE user_id = p_source;

    -- The participation records. The caller has refused any course both sides
    -- are enrolled on, so this cannot collide.
    UPDATE enrolments SET user_id = p_target WHERE user_id = p_source;

    -- The EFN, only when the target has none. The caller has already refused
    -- two *different* numbers.
    INSERT INTO efn_profiles (user_id, efn)
    SELECT p_target, efn FROM efn_profiles WHERE user_id = p_source
    ON CONFLICT (user_id) DO NOTHING;
    DELETE FROM efn_profiles WHERE user_id = p_source;

    UPDATE learner_sessions SET revoked_at = now()
     WHERE user_id IN (p_source, p_target) AND revoked_at IS NULL;
    DELETE FROM learner_sessions WHERE user_id = p_source;

    -- The source person is now an empty shell. Leaving it would put a nameless
    -- row in every future participant list.
    DELETE FROM users WHERE id = p_source;

    INSERT INTO admin_audit_log (actor_id, actor_email, action, subject_id, detail)
    VALUES (p_actor_id, p_actor_email, 'participant.merge', p_target, p_detail);
END;
$$;

ALTER FUNCTION merge_participants(uuid, uuid, uuid, text, jsonb) OWNER TO ds_merge;
REVOKE ALL ON FUNCTION merge_participants(uuid, uuid, uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION merge_participants(uuid, uuid, uuid, text, jsonb) TO ds_app;

COMMENT ON FUNCTION merge_participants(uuid, uuid, uuid, text, jsonb) IS
    'Move every credential and record from one person to another (P21-05). '
    'Irreversible. Owned by ds_merge (BYPASSRLS) because a merge is inherently '
    'cross-tenant. Executing it is a capability, not a permission: the API '
    'refuses callers who are not super_admin. The refusal rules are '
    'planCredentialMerge in packages/domain, deliberately not here.';

-- ---------------------------------------------------------------------------
-- The role must not accumulate anything else
-- ---------------------------------------------------------------------------
--
-- A BYPASSRLS role is only as narrow as the objects it owns. This asserts, in
-- this migration's own transaction, that it owns exactly these two functions
-- and no relation — so a later migration that carelessly reassigns something to
-- it fails here rather than quietly widening the exemption. The same assertion
-- guards ds_erasure (0009) and ds_customer_registry (0021).

DO $$
DECLARE
    owned bigint;
BEGIN
    SELECT count(*) INTO owned
      FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
     WHERE r.rolname = 'ds_merge';

    IF owned <> 2 THEN
        RAISE EXCEPTION 'ds_merge owns % functions, expected exactly 2', owned;
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
         WHERE r.rolname = 'ds_merge'
    ) THEN
        RAISE EXCEPTION 'ds_merge owns a relation; it must own only functions';
    END IF;

    IF NOT has_function_privilege('ds_app', 'merge_participants(uuid, uuid, uuid, text, jsonb)', 'EXECUTE') THEN
        RAISE EXCEPTION 'ds_app cannot execute merge_participants';
    END IF;
END;
$$;

COMMIT;
