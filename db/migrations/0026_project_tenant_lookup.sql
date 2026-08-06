-- Which customer a project belongs to, without asking about Keycloak (P22-01).
--
-- ## The bug this fixes
--
-- The staff plane resolved a project through `resolve_project_binding`
-- (migration 0002), and that function returns the Keycloak issuer and audience
-- alongside the customer id. The repository above it treats a NULL issuer or
-- audience as "not found" — correctly, because a project with no binding cannot
-- authenticate a **learner**, and returning a half-filled binding would push a
-- null into token validation.
--
-- The staff plane needs exactly one field out of that lookup: `customer_id`.
-- It needs none of the Keycloak ones, because a staff session is local to the
-- platform and never touches an identity provider at all (ADR-0012).
--
-- Sharing the lookup therefore made an unrelated fact — "this project has no
-- Keycloak configured" — into a refusal of every tenant-scoped console screen:
--
--     GET /admin/customers  →  200
--     GET /admin/courses    →  401 Unauthenticated
--
-- for an operator whose session was perfectly valid. Reported from a live
-- deployment, where it read as "the login is broken".
--
-- Two ways to arrive there, and both are ordinary:
--
--   * A project created through the console. The Keycloak fields are optional
--     there — deliberately, since they configure the learner plane and may be
--     filled in later, or never, for a customer served only by the standalone
--     portal.
--   * A fresh installation. It has no project at all until an operator makes
--     one, and the screens needed to make one were among the screens refusing.
--
-- ## Why a second function rather than relaxing the first
--
-- `resolve_project_binding` could have been made to return rows with a NULL
-- issuer, leaving the caller to check. That moves a security-relevant decision
-- — "is this project able to authenticate a learner?" — out of one auditable
-- place and into every call site, and the failure mode of forgetting the check
-- is that a token is validated against a null issuer.
--
-- This function instead returns strictly **less**: two ids and nothing else. It
-- cannot be misused for token validation because it does not carry the fields
-- token validation needs. That is the property worth having, and it is why the
-- two are separate rather than one function with a flag.
--
-- Same owner, same reasoning as 0002: `projects` is under FORCE ROW LEVEL
-- SECURITY, so even a SECURITY DEFINER owned by `ds_migrator` would see
-- nothing; and this lookup runs *before* `app.customer_id` exists, which is
-- what it is for. `ds_binding_resolver` already holds the one narrow
-- `SELECT (id, customer_id, …) ON projects` grant this needs, so no new
-- privilege is created here — the blast radius stays exactly what 0002
-- documented.

BEGIN;

CREATE OR REPLACE FUNCTION resolve_project_tenant(p_slug text)
RETURNS TABLE (
    project_id  uuid,
    customer_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
-- Pinned search_path: a SECURITY DEFINER function without one can be hijacked
-- by a caller-controlled search_path resolving `projects` to another relation.
SET search_path = public, pg_temp
AS $$
    SELECT p.id, p.customer_id
    FROM projects p
    WHERE p.slug = p_slug
    LIMIT 1;
$$;

ALTER FUNCTION resolve_project_tenant(text) OWNER TO ds_binding_resolver;

REVOKE ALL ON FUNCTION resolve_project_tenant(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_project_tenant(text) TO ds_app;

COMMENT ON FUNCTION resolve_project_tenant(text) IS
    'Which customer a project slug belongs to, for callers that authenticate '
    'without an identity provider — the staff plane (ADR-0012). Deliberately '
    'returns no Keycloak fields, so it cannot be used to validate a token '
    '(P22-01).';

COMMIT;
