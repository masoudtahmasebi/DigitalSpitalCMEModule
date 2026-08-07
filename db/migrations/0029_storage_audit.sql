-- Every object-storage operation, written down (P23-02).
--
-- ## Why object storage needs its own log
--
-- Postgres has RLS: a cross-tenant read is refused by the database itself, and
-- the attempt is a row nobody got. A bucket has none of that. The isolation
-- guarantee for object storage is entirely `<customerId>/…` as the first path
-- segment plus the server refusing to sign a key outside the caller's prefix
-- (`keyBelongsToCustomer`, ADR-0002's object-storage half). A guarantee that
-- lives in application code and not in the store is a guarantee you have to be
-- able to audit, because there is nothing underneath it to catch a mistake.
--
-- So: every signature minted, every upload accepted or refused, every read
-- resolved, every deletion. Including the refusals — those are the interesting
-- ones, exactly as with `eiv_submission_attempts` (CLAUDE.md §4 invariant 8).
-- A key refused for belonging to another customer is the single most important
-- event this table can hold, and it is the one an implementation that only
-- logged successes would throw away.
--
-- ## What it deliberately does not hold
--
-- No personal data. An object key is two UUIDs and a filename **we** generated
-- (`uploadObjectName` — never the uploader's, precisely so a working title or a
-- patient name cannot arrive here). `actor_id` is a pseudonymous identifier and
-- nothing else: no email, no name, no EFN. `detail` is a short technical reason
-- written by us from a closed set of phrasings, never a value echoed back from
-- a request.
--
-- Recorded in `docs/gdpr.md` §2 with a retention period, because a log of who
-- touched what is still processing even when every field is a UUID.
--
-- ## Why `actor_id` has no foreign key
--
-- It names a row in one of two tables. Uploads are performed by an
-- `admin_users` row on the staff plane; reads are resolved for a `users` row on
-- the learner plane (ADR-0012 — two identity planes, deliberately not one
-- table). `actor_kind` says which. A polymorphic reference is a real cost, and
-- the alternatives are worse: two nullable columns with a CHECK that exactly
-- one is set reads no better and adds an index, and merging the planes to get
-- one foreign key would undo the decision the whole auth design rests on.
--
-- It also has to outlive the account. An operator who is deleted must not take
-- the record of what they uploaded with them, and a cascading FK would do
-- exactly that.

BEGIN;

CREATE TYPE storage_actor_kind AS ENUM ('staff', 'learner', 'system');

CREATE TYPE storage_action AS ENUM (
    -- An upload signature was issued. Not yet an upload: this is the moment a
    -- capability came into existence, and it is worth having on its own because
    -- a mint with no matching store is an upload that was started and abandoned.
    'mint',
    -- The upload was verified against what was approved and accepted.
    'store',
    -- Refused. `detail` says why, from a closed set — wrong size, wrong type,
    -- never arrived, or the key did not belong to this customer.
    'refuse',
    -- A read signature was issued for an object.
    'read',
    -- The object was removed: a failed verification, or a course being deleted.
    'delete'
);

CREATE TABLE storage_audit_log (
    id          bigserial PRIMARY KEY,
    at          timestamptz NOT NULL DEFAULT now(),

    -- The tenant whose prefix the key sits under. NOT NULL: an operation with
    -- no customer is an operation this table cannot describe, and there is no
    -- such thing in the platform — every key starts with a customer id.
    customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,

    -- No FK. A course may be deleted; the record of what was uploaded to it is
    -- the thing an auditor asks for afterwards.
    course_id   uuid,

    actor_kind  storage_actor_kind NOT NULL,
    -- See the header: deliberately unreferenced, and pseudonymous.
    actor_id    uuid,

    action      storage_action NOT NULL,
    -- Relative to the bucket, always beginning `<customer_id>/`.
    object_key  text NOT NULL,

    -- What the operation concerned, where it is known. Null for a read, whose
    -- size is a property of the object rather than of the event.
    size_bytes  bigint CHECK (size_bytes IS NULL OR size_bytes >= 0),
    mime_type   text,

    succeeded   boolean NOT NULL,
    -- A short technical reason, written by us. Never a request value.
    detail      text
);

-- The two questions this table is actually asked: "what happened to this
-- customer's objects" and "what happened in this window".
CREATE INDEX storage_audit_log_customer_idx ON storage_audit_log (customer_id, at DESC);
CREATE INDEX storage_audit_log_at_idx ON storage_audit_log (at DESC);

-- And the one that matters during an incident: show me every refusal.
CREATE INDEX storage_audit_log_refusals_idx ON storage_audit_log (at DESC)
    WHERE NOT succeeded;

-- Not only for reading. The upload path looks a `mint` row up by key to find
-- out what size and type it approved, because taking those from the client's
-- own `complete` request would let it choose both sides of the comparison. So
-- this index is on the request path, not just the audit screen.
CREATE INDEX storage_audit_log_key_idx ON storage_audit_log (object_key, at DESC);

COMMENT ON TABLE storage_audit_log IS
    'Append-only record of every object-storage operation, including refusals. '
    'Object storage has no RLS, so the per-customer key prefix is the whole '
    'isolation guarantee and this is how it is audited (P23-02).';

-- ---------------------------------------------------------------------------
-- Tenant isolation
-- ---------------------------------------------------------------------------
--
-- The same shape every tenant-scoped table has used since migration 0014: the
-- `nullif` is not decoration. `current_setting('app.customer_id', true)`
-- returns the empty string when the setting has never been set in this session,
-- and `''::uuid` raises `invalid input syntax for type uuid` rather than
-- matching nothing — which turns "no tenant context" into a 500 instead of an
-- empty result. Migration 0014 predicted this in writing and migration 0025
-- reproduced it anyway; it is copied here from the corrected form.

ALTER TABLE storage_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage_audit_log FORCE ROW LEVEL SECURITY;

CREATE POLICY storage_audit_log_tenant_isolation ON storage_audit_log
    USING (customer_id = nullif(current_setting('app.customer_id', true), '')::uuid)
    WITH CHECK (customer_id = nullif(current_setting('app.customer_id', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- Append-only, and enforced the loud way
-- ---------------------------------------------------------------------------
--
-- The same choice migration 0017 made for `admin_audit_log`, for the same
-- reason: `audit_log`'s rewrite rules (migration 0001) make an UPDATE report
-- success and change nothing, and for a table whose only purpose is to be
-- trustworthy afterwards, a caller that believes it wrote something and did not
-- is the worse failure. A revoked privilege makes the attempt an error.
--
-- `ds_app` is named explicitly. `ALTER DEFAULT PRIVILEGES FOR ROLE ds_migrator`
-- (infra/postgres/init-roles.sql) grants ds_app everything on tables this role
-- creates, and that is a grant *to ds_app* rather than one via PUBLIC — so
-- revoking from PUBLIC would leave it untouched.

GRANT SELECT, INSERT ON storage_audit_log TO ds_app;
REVOKE UPDATE, DELETE, TRUNCATE ON storage_audit_log FROM ds_app;
GRANT USAGE, SELECT ON SEQUENCE storage_audit_log_id_seq TO ds_app;

-- The assertion, because a REVOKE that silently did nothing is exactly the
-- failure this migration is trying to prevent, and 0017 only discovered its own
-- version of that mistake because it checked.
DO $$
BEGIN
    IF has_table_privilege('ds_app', 'storage_audit_log', 'UPDATE')
       OR has_table_privilege('ds_app', 'storage_audit_log', 'DELETE') THEN
        RAISE EXCEPTION
            'storage_audit_log is still writable in place by ds_app — the '
            'append-only guarantee is not in effect';
    END IF;
    IF NOT has_table_privilege('ds_app', 'storage_audit_log', 'INSERT') THEN
        RAISE EXCEPTION 'ds_app cannot append to storage_audit_log';
    END IF;
END $$;

COMMIT;
