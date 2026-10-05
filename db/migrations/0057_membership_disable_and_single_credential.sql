-- A block belongs to a membership, and a merged person keeps one password
-- (P247-01, closes SEC-1 of docs/code-audit-api.md).
--
-- ## The defect
--
-- A merge (0033) moves every identity of one person onto another, and every
-- local identity has the realm `ds:local` — so a physician who learned with
-- customer A and customer B came out of a merge holding **two** passwords, and
-- either one signed in at both customers. Two things then reached across the
-- tenant boundary:
--
--   * A's administrator could reset "the" password and was handed one that
--     signed in at B as well. (The reset no longer returns a password at all;
--     that half is in the API.)
--   * A's administrator could disable the person, which wrote
--     `learner_credentials.disabled_at` — a column every customer's sign-in
--     read. A locked the physician out of B.
--
-- ## What this changes
--
-- 1. `user_customers.disabled_at` / `disabled_by`. A block is a statement by
--    one customer about its own relationship with a person, so it lives on
--    the row that *is* that relationship, which is tenant-scoped under RLS.
--    `learner_credentials.disabled_at` is no longer read by anything; it is
--    left in place rather than dropped so this migration is not also a data
--    deletion, and so a rollback of the code still finds what it read.
-- 2. `learner_credentials.last_used_at`, stamped on every successful sign-in,
--    so "the most recently used credential" is something the database knows
--    rather than something inferred from `updated_at` — which a *failed*
--    sign-in also moves, so an attacker could choose which one survives.
-- 3. `merge_participants` keeps exactly one local identity — the most recently
--    used — deletes the others (their password row and any open reset link go
--    with them by `ON DELETE CASCADE`), carries a membership block across, and
--    names what it dropped in the audit row. Ids only, never an address.
--
-- ## What it deliberately does not do
--
-- Deduplicate people merged *before* this migration. Deleting a credential
-- somebody may be using is a decision about a named physician's account, not a
-- schema change; the readers pick one deterministically instead, and the
-- operator can see such people (two local identities, one user) with one query.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The block, on the membership
-- ---------------------------------------------------------------------------

ALTER TABLE user_customers
    ADD COLUMN disabled_at timestamptz,
    -- Who did it. `admin_users`, as on `learner_credentials`: an act by a
    -- member of staff on the staff plane (ADR-0012). Null when a super admin
    -- acted through a learner token — a breadcrumb, not an authorisation.
    ADD COLUMN disabled_by uuid REFERENCES admin_users(id) ON DELETE SET NULL;

COMMENT ON COLUMN user_customers.disabled_at IS
    'Set by an administrator of this customer to stop this person signing in '
    'here. Applies to this membership only: the same person at another '
    'customer is unaffected (P247-01).';

-- Backfill: every membership of a person whose credential was disabled. That
-- is wider than the block meant — it was set by one customer — and it is the
-- only reading that does not silently *unblock* somebody an administrator
-- deliberately stopped. Each customer can lift its own copy.
--
-- `user_customers` is under FORCE ROW LEVEL SECURITY, which applies to the
-- owner (`ds_migrator`), who is running this with no `app.customer_id` — so the
-- UPDATE below would match zero rows and report success, exactly as 0025's
-- backfill would have. `NO FORCE` for the length of one statement exempts the
-- owner and nobody else; the ALTER holds ACCESS EXCLUSIVE until COMMIT, so no
-- other session can observe the window, and the check at the end refuses to
-- commit if FORCE did not come back.
ALTER TABLE user_customers NO FORCE ROW LEVEL SECURITY;

UPDATE user_customers m
   SET disabled_at = blocked.disabled_at,
       disabled_by = blocked.disabled_by
  FROM (
    SELECT DISTINCT ON (i.user_id) i.user_id, c.disabled_at, c.disabled_by
      FROM user_identities i
      JOIN learner_credentials c ON c.user_identity_id = i.id
     WHERE i.provider = 'local' AND c.disabled_at IS NOT NULL
     ORDER BY i.user_id, c.disabled_at
  ) AS blocked
 WHERE blocked.user_id = m.user_id
   AND m.disabled_at IS NULL;

ALTER TABLE user_customers FORCE ROW LEVEL SECURITY;

COMMENT ON COLUMN learner_credentials.disabled_at IS
    'No longer read (P247-01): a block is per customer, on '
    'user_customers.disabled_at. Kept so the migration deletes nothing.';

-- ---------------------------------------------------------------------------
-- 2. When a credential was last used
-- ---------------------------------------------------------------------------

ALTER TABLE learner_credentials ADD COLUMN last_used_at timestamptz;

COMMENT ON COLUMN learner_credentials.last_used_at IS
    'The last successful sign-in with this credential (P247-01). Decides which '
    'local credential a merge keeps. A failed attempt does not move it.';

-- Backfill from sessions, but only where a session can be attributed to one
-- credential: `learner_sessions` names the person, not the identity, so for a
-- person already holding two local identities the answer is unknowable and is
-- left null rather than guessed.
UPDATE learner_credentials c
   SET last_used_at = used.at
  FROM (
    SELECT i.id AS identity_id, max(s.created_at) AS at
      FROM user_identities i
      JOIN learner_sessions s ON s.user_id = i.user_id
     WHERE i.provider = 'local'
       AND (SELECT count(*) FROM user_identities o
             WHERE o.user_id = i.user_id AND o.provider = 'local') = 1
     GROUP BY i.id
  ) AS used
 WHERE used.identity_id = c.user_identity_id;

-- ---------------------------------------------------------------------------
-- 3. The merge keeps one local credential
-- ---------------------------------------------------------------------------
--
-- Listed verb by verb, as 0033 does, so the role's reach can still be read in
-- one screen. New: it reads credentials to choose, deletes the identities it
-- drops, and updates a membership to carry a block across.

GRANT SELECT  ON learner_credentials TO ds_merge;
GRANT DELETE  ON user_identities     TO ds_merge;
GRANT UPDATE  ON user_customers      TO ds_merge;

CREATE OR REPLACE FUNCTION merge_participants(
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
DECLARE
    v_keep    uuid;
    v_dropped uuid[];
BEGIN
    IF p_source = p_target THEN
        RAISE EXCEPTION 'merge_participants: source and target are the same person';
    END IF;

    -- The credentials. This is the merge: two ways in, one person.
    UPDATE user_identities SET user_id = p_target WHERE user_id = p_source;

    -- ...and then one *local* way in (P247-01). Two passwords for one person
    -- meant either signed in everywhere the person is a member, and a reset or
    -- a block aimed at one of them landed on whichever an unordered LIMIT 1
    -- happened to pick. The most recently used one stays: it is the password
    -- the physician is actually typing. Never `updated_at`, which a failed
    -- sign-in also moves.
    SELECT i.id INTO v_keep
      FROM user_identities i
      LEFT JOIN learner_credentials c ON c.user_identity_id = i.id
     WHERE i.user_id = p_target AND i.provider = 'local'
     ORDER BY c.last_used_at DESC NULLS LAST, i.created_at DESC, i.id
     LIMIT 1;

    SELECT coalesce(array_agg(i.id ORDER BY i.id), ARRAY[]::uuid[]) INTO v_dropped
      FROM user_identities i
     WHERE i.user_id = p_target AND i.provider = 'local' AND i.id <> v_keep;

    -- Cascades to `learner_credentials` and `learner_credential_tokens`: the
    -- dropped password stops working, and so does any reset link already in a
    -- mailbox for it.
    DELETE FROM user_identities WHERE id = ANY (v_dropped);

    -- A block is carried across rather than lost: it was a deliberate act by
    -- that customer, and a merge is not that customer changing its mind.
    INSERT INTO user_customers (user_id, customer_id, disabled_at, disabled_by)
    SELECT p_target, customer_id, disabled_at, disabled_by
      FROM user_customers WHERE user_id = p_source
    ON CONFLICT (user_id, customer_id) DO UPDATE
       SET disabled_at = coalesce(user_customers.disabled_at, EXCLUDED.disabled_at),
           disabled_by = CASE WHEN user_customers.disabled_at IS NULL
                              THEN EXCLUDED.disabled_by
                              ELSE user_customers.disabled_by END;
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
    VALUES (p_actor_id, p_actor_email, 'participant.merge', p_target,
            p_detail || jsonb_build_object('droppedLocalIdentityIds', to_jsonb(v_dropped)));
END;
$$;

-- CREATE OR REPLACE keeps the owner, the grants and the comment; restated so
-- the file says what it relies on rather than inheriting it silently.
ALTER FUNCTION merge_participants(uuid, uuid, uuid, text, jsonb) OWNER TO ds_merge;
REVOKE ALL ON FUNCTION merge_participants(uuid, uuid, uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION merge_participants(uuid, uuid, uuid, text, jsonb) TO ds_app;

-- ---------------------------------------------------------------------------
-- The assertions
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    owned bigint;
BEGIN
    -- Tenant isolation is back on the table this migration unforced.
    IF NOT EXISTS (
        SELECT 1 FROM pg_class
         WHERE relname = 'user_customers'
           AND relrowsecurity
           AND relforcerowsecurity
    ) THEN
        RAISE EXCEPTION
            'user_customers left without FORCE ROW LEVEL SECURITY — refusing to commit';
    END IF;

    -- 0033's invariant: ds_merge owns exactly its two functions, no relation.
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

    -- The API writes the block and stamps the credential as ds_app. A new
    -- column on a table with explicit grants is where a permission quietly
    -- does not extend (0031 said the same about its own column).
    IF NOT has_column_privilege('ds_app', 'user_customers', 'disabled_at', 'UPDATE') THEN
        RAISE EXCEPTION 'ds_app cannot disable a membership';
    END IF;
    IF NOT has_column_privilege('ds_app', 'learner_credentials', 'last_used_at', 'UPDATE') THEN
        RAISE EXCEPTION 'ds_app cannot stamp a credential as used';
    END IF;
END;
$$;

COMMIT;
