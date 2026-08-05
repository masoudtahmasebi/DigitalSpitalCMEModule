-- Which population an audit actor belongs to (P12-02), completing ADR-0012.
--
-- `audit_log.actor_id` is a bare uuid, and since ADR-0012 there are two disjoint
-- populations that can fill it: learners in `users` and operators in
-- `admin_users`. Nothing in the row says which, and a uuid does not carry its
-- own table.
--
-- That is not a cosmetic gap. The question an auditor asks about a
-- Punktemeldung is "did the physician trigger this, or did an operator submit
-- it on their behalf?" — and answering it today would mean probing both tables
-- for the id and hoping it does not appear in either. It also silently assumes
-- the two id spaces never collide, which is true only by luck of uuid4.
--
-- ## Why a column and not a lookup
--
-- The whole point of an append-only log is that it is readable years later
-- without the surrounding system. `admin_users` rows can be erased under GDPR
-- and `users` rows are erased by `erase_subject` (migration 0009) — at which
-- point a lookup answers "neither", which is the one answer that is definitely
-- wrong. The column records the fact at the moment it was true.
--
-- ## Why no foreign key
--
-- For the same reason: erasure must not be blocked by, or cascade into, the
-- audit trail. `actor_id` has deliberately never been an FK and this column does
-- not change that.

-- ## Why the backfill is a column rewrite and not an UPDATE
--
-- `audit_log` carries `audit_log_no_update AS ON UPDATE … DO INSTEAD NOTHING`
-- (migration 0001). A rule is not a constraint: it does not raise, it silently
-- rewrites the statement into nothing. The first draft of this migration ran a
-- plain `UPDATE`, reported success, and changed zero rows — leaving four rows
-- naming an actor while claiming to have none. The append-only invariant did
-- exactly its job; the migration was the thing in the wrong.
--
-- The obvious repair is `DISABLE RULE` around the `UPDATE`, and by hand in psql
-- that works. It does *not* work through the migration runner, which sends the
-- whole file as one multi-statement query: the `UPDATE` is rewritten against a
-- rule state that the `DISABLE` in the same batch has not yet made visible, so
-- the rule fires anyway and the backfill vanishes a second time — silently
-- again, and this time with a plausible-looking `DISABLE RULE` in the diff to
-- reassure the reader.
--
-- So the backfill does not go through the rewriter at all. `ALTER COLUMN … TYPE
-- … USING` is a table rewrite: its `USING` expression may read the row's other
-- columns, and rules apply to `UPDATE` statements, not to rewrites. One
-- statement, no window in which the log is writable, and nothing to remember to
-- re-enable.
--
-- The `DO` block afterwards stays regardless, because the failure being guarded
-- against is a *silent* one. An assertion is the only thing that distinguishes
-- "the backfill ran" from "the backfill was discarded".

BEGIN;

ALTER TABLE audit_log
    ADD COLUMN actor_identity text NOT NULL DEFAULT 'system'
        CHECK (actor_identity IN ('learner', 'staff', 'system'));

-- Every pre-existing row with an actor came from the learner plane: the staff
-- plane did not exist before migration 0017, and nothing has written to this
-- table on its behalf yet. Rows without an actor are the system's own
-- (a rejected token, an unresolved slug).
ALTER TABLE audit_log
    ALTER COLUMN actor_identity TYPE text
    USING (CASE WHEN actor_id IS NULL THEN 'system' ELSE 'learner' END);

-- An actor id without a population, or a population without an actor id, is the
-- contradiction this whole migration exists to remove. Enforced from here on so
-- it cannot come back through an application insert that forgets the field.
ALTER TABLE audit_log
    ADD CONSTRAINT audit_log_actor_identity_agrees
        CHECK ((actor_id IS NULL) = (actor_identity = 'system'));

DO $$
DECLARE
    contradictions bigint;
BEGIN
    SELECT count(*) INTO contradictions
    FROM audit_log
    WHERE (actor_id IS NULL) <> (actor_identity = 'system');

    IF contradictions > 0 THEN
        RAISE EXCEPTION
            'backfill did not apply: % audit_log rows disagree with actor_identity',
            contradictions;
    END IF;
END;
$$;

COMMENT ON COLUMN audit_log.actor_identity IS
    'Which population actor_id names: learner (users), staff (admin_users), or '
    'system (no actor). Recorded rather than looked up, because both tables are '
    'erasable and the log outlives them (ADR-0012).';

-- The default exists so any INSERT written before this column did stays legal,
-- not as an invitation to omit it. Application inserts always pass a value, and
-- the constraint above rejects the ones that would get it wrong.

COMMIT;
