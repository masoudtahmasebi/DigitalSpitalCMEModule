-- The customer registry (P12-04): letting a super administrator see the list of
-- customers without letting anything else out.
--
-- ## The problem
--
-- `customers` has FORCE ROW LEVEL SECURITY and one policy:
--
--     id = current_setting('app.customer_id')::uuid
--
-- which is correct and is exactly what makes a customer administrator unable to
-- learn that another customer exists. It also means no tenant-scoped role can
-- enumerate the table — and the first screen a platform operator sees is that
-- enumeration. That is why `Customer`, the top of
-- `Customer → Department → Project → Course → Modul → Kapitel → Inhalt`, has had
-- no endpoint at all.
--
-- ## What is NOT in here, and why that is the point
--
-- Creating, renaming and deleting a customer are not in this migration and get
-- no privilege from it. Each of those names a single customer, so the API runs
-- them as `ds_app` inside that customer's own tenant context and they pay full
-- RLS like any other write:
--
--   * create — the API generates the uuid, opens a tenant context on it, and
--     inserts. The policy's `WITH CHECK` is satisfied because the row's `id`
--     *is* the tenant, so nothing is bypassed; the insert is checked exactly as
--     hard as every other insert in the schema.
--   * rename and delete — open a tenant context on the id and operate. A caller
--     naming an id that is not theirs updates zero rows, because the policy
--     already says so.
--
-- Only the enumeration is inherently cross-tenant, so only the enumeration is
-- exempt. This is the third and — on present evidence — final BYPASSRLS role in
-- the schema, and it exists to answer one question.
--
-- ## The blast radius
--
-- One function, no arguments, `STABLE`, owned by `ds_customer_registry`
-- (NOLOGIN, BYPASSRLS, owns nothing else). It returns a customer's id, slug,
-- name, creation time and the number of departments, projects and courses in
-- it. No course content, no learner, no enrolment, no certificate, no EFN, no
-- credential. Somebody who obtained the ability to call it would learn the
-- names of DigitalSpital's customers and roughly how much content each has —
-- which is a confidentiality matter and not a compliance one, and is bounded in
-- a way "SELECT anything" would not be.
--
-- The child counts are in here rather than in three follow-up queries because
-- the follow-ups would be tenant-scoped: counting another customer's courses
-- means opening a tenant context on that customer, which is precisely the thing
-- the caller has not yet been authorised to do. Returning them alongside the
-- name keeps the list screen to one call and one privilege.
--
-- ## Authorisation is still the application's job
--
-- `SECURITY DEFINER` makes this function a capability, not a permission. Being
-- able to execute it is not being allowed to: the API refuses the request
-- unless the staff session holds the `customer` capability, which only
-- `super_admin` has (`packages/domain/src/staff-identity.ts`). That is the same
-- division as `resolve_project_binding` — the function answers a question the
-- guard has already decided may be asked.

BEGIN;

-- ---------------------------------------------------------------------------
-- Grants for the function's owner
-- ---------------------------------------------------------------------------
--
-- BYPASSRLS exempts a role from row-level *policies*. It grants no table
-- privilege whatsoever, and the two are easy to conflate: without the grants
-- below the function raises `permission denied for table customers`, which
-- reads as "the role is wrong" rather than "the role is right and has no
-- SELECT".
--
-- Column-level, not table-level, and only the columns the function returns or
-- counts by. `customers` has no secrets in it today, but `GRANT SELECT ON
-- customers` would silently cover any column a future migration adds — and the
-- obvious future addition to a customer record is billing or contact detail.
GRANT SELECT (id, slug, name, created_at) ON customers   TO ds_customer_registry;
GRANT SELECT (customer_id)               ON departments  TO ds_customer_registry;
GRANT SELECT (customer_id)               ON projects     TO ds_customer_registry;
GRANT SELECT (customer_id)               ON courses      TO ds_customer_registry;

CREATE FUNCTION list_customer_registry()
RETURNS TABLE (
    id               uuid,
    slug             text,
    name             text,
    created_at       timestamptz,
    department_count integer,
    project_count    integer,
    course_count     integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
-- Pinned search_path: a SECURITY DEFINER function without one can be hijacked
-- by a caller-controlled search_path resolving `customers` to another relation.
SET search_path = public, pg_temp
AS $$
    SELECT c.id,
           c.slug,
           c.name,
           c.created_at,
           (SELECT count(*)::int FROM departments d WHERE d.customer_id = c.id),
           (SELECT count(*)::int FROM projects    p WHERE p.customer_id = c.id),
           (SELECT count(*)::int FROM courses     k WHERE k.customer_id = c.id)
    FROM customers c
    ORDER BY c.name;
$$;

ALTER FUNCTION list_customer_registry() OWNER TO ds_customer_registry;

-- Not PUBLIC. `REVOKE` first because `CREATE FUNCTION` grants EXECUTE to PUBLIC
-- by default, which would make the enumeration available to every role in the
-- database including any future read-only reporting login.
REVOKE ALL ON FUNCTION list_customer_registry() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_customer_registry() TO ds_app;

COMMENT ON FUNCTION list_customer_registry() IS
    'Cross-tenant customer list for the platform operator screen (P12-04). '
    'Owned by ds_customer_registry (BYPASSRLS) because customers is RLS-scoped '
    'to a single tenant and this list is inherently above any one of them. '
    'Registry metadata and child counts only — never tenant content. Executing '
    'it is a capability, not a permission: the API refuses callers whose staff '
    'session lacks the customer capability.';

-- ---------------------------------------------------------------------------
-- The registry role must not accumulate anything else
-- ---------------------------------------------------------------------------
--
-- A BYPASSRLS role is only as narrow as the objects it owns. This asserts, in
-- the migration's own transaction, that it owns exactly the one function — so a
-- later migration that carelessly reassigns something to it fails here rather
-- than quietly widening the exemption.

DO $$
DECLARE
    owned bigint;
BEGIN
    SELECT count(*) INTO owned
    FROM pg_proc p
    JOIN pg_roles r ON r.oid = p.proowner
    WHERE r.rolname = 'ds_customer_registry';

    IF owned <> 1 THEN
        RAISE EXCEPTION
            'ds_customer_registry owns % functions, expected exactly 1', owned;
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_roles r ON r.oid = c.relowner
        WHERE r.rolname = 'ds_customer_registry'
    ) THEN
        RAISE EXCEPTION 'ds_customer_registry owns a relation; it must own only a function';
    END IF;
END;
$$;

COMMIT;
