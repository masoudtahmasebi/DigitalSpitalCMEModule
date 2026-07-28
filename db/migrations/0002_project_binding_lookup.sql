-- Project binding lookup (P1-05), supporting ADR-0002 and ADR-0007.
--
-- THE CHICKEN AND EGG
--
-- Every tenant-scoped query needs `app.customer_id` set. But to know which
-- customer a request belongs to, we must first resolve the project the widget
-- was mounted for — and `projects` is itself tenant-scoped. The lookup cannot
-- run inside the tenant context it is trying to establish.
--
-- THE RESOLUTION
--
-- One SECURITY DEFINER function, returning the minimum needed to route and
-- authenticate a request: the project and customer ids, and the Keycloak
-- binding to validate the token against. No course data, no learner data, no
-- credentials — nothing that would be a leak if the caller guessed a slug.
--
-- WHY THIS IS NOT A HOLE IN ADR-0002
--
-- Knowing that a project slug exists and which realm it trusts is not tenant
-- data; it is routing metadata, equivalent to what a DNS lookup reveals. The
-- function is the only SECURITY DEFINER in the schema, it takes one argument,
-- it returns four non-sensitive columns, and it is auditable in one screen.
--
-- The security property that matters is downstream: the resolved customer_id is
-- only trusted once the caller's token has been validated against THAT
-- project's issuer and audience. A client naming a project it has no token for
-- gets a 401, so the client-supplied project name selects a candidate binding —
-- it never grants access.
--
-- WHY A SEPARATE ROLE OWNS THE FUNCTION
--
-- `SECURITY DEFINER` runs as the function's OWNER, not as the caller. Every
-- tenant table -- `projects` included -- has FORCE ROW LEVEL SECURITY, which
-- deliberately applies RLS even to the table owner (ds_migrator), so that an
-- owner can never become an accidental bypass. That means ds_migrator itself
-- cannot see rows outside whatever app.customer_id happens to be set -- and
-- this function's entire purpose is to run BEFORE app.customer_id exists.
--
-- So the function is owned by `ds_binding_resolver` (created in
-- infra/postgres/init-roles.sql, by the Postgres superuser -- CREATE ROLE
-- needs a privilege ds_migrator deliberately does not have): a role with no
-- purpose other than owning this one function, holding BYPASSRLS, holding no
-- other grant, and never used to log in. It is the one deliberate, narrow
-- exception to "no BYPASSRLS role" in this schema, and its entire blast
-- radius is the four non-sensitive columns this function returns.

BEGIN;

CREATE OR REPLACE FUNCTION resolve_project_binding(p_slug text)
RETURNS TABLE (
    project_id        uuid,
    customer_id       uuid,
    keycloak_issuer   text,
    keycloak_audience text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
-- Pinned search_path: a SECURITY DEFINER function without one can be hijacked
-- by a caller-controlled search_path resolving `projects` to another relation.
SET search_path = public, pg_temp
AS $$
    SELECT p.id, p.customer_id, p.keycloak_issuer, p.keycloak_audience
    FROM projects p
    WHERE p.slug = p_slug
    LIMIT 1;
$$;

ALTER FUNCTION resolve_project_binding(text) OWNER TO ds_binding_resolver;
GRANT SELECT (id, customer_id, keycloak_issuer, keycloak_audience, slug)
    ON projects TO ds_binding_resolver;

REVOKE ALL ON FUNCTION resolve_project_binding(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_project_binding(text) TO ds_app;

COMMENT ON FUNCTION resolve_project_binding(text) IS
    'Routing metadata only. Owned by ds_binding_resolver (BYPASSRLS) because '
    'FORCE ROW LEVEL SECURITY on projects would otherwise block even the '
    'SECURITY DEFINER owner. The returned customer_id is trusted only after '
    'the caller''s token validates against the returned issuer and audience.';

COMMIT;
