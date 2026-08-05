-- Which identity provider authenticates a project's learners (P12-02),
-- implementing ADR-0012's second plane.
--
-- Keycloak is MEDICE's choice, not the platform's. The next customer may run
-- Azure AD, a different OIDC provider, or a SAML IdP, and learner
-- authentication has to be replaceable per project without touching the guard,
-- the schema or any endpoint.
--
-- So the column names the *implementation* and the existing `keycloak_*`
-- columns become that implementation's configuration. Adding a second provider
-- is then a new class and a row value.
--
-- ## Why the column is constrained rather than free text
--
-- An unrecognised value is a project whose learners cannot sign in, and the
-- symptom would be every request 401ing with nothing pointing at a typo in one
-- row. The CHECK makes that unrepresentable, and extending it is a one-line
-- migration in the same commit that adds the class — which is the right place
-- for the two to be reviewed together.
--
-- The columns keep their `keycloak_` prefix deliberately. Renaming them to
-- something neutral would be a wide, churny change to the schema, the Drizzle
-- mapping, the binding repository and the admin console, in exchange for
-- nothing a reader of this comment does not already know. The next provider
-- adds its own columns or its own table; it does not squat in these.

BEGIN;

ALTER TABLE projects
    ADD COLUMN identity_provider text NOT NULL DEFAULT 'keycloak'
        CHECK (identity_provider IN ('keycloak'));

COMMENT ON COLUMN projects.identity_provider IS
    'Which IdentityProvider implementation verifies this project''s learner tokens (ADR-0012). Extend the CHECK in the same migration that adds the class.';

-- ---------------------------------------------------------------------------
-- The binding resolver has to return it
-- ---------------------------------------------------------------------------
--
-- `resolve_project_binding` is a SECURITY DEFINER function owned by
-- `ds_binding_resolver` (migration 0002): `projects` has FORCE ROW LEVEL
-- SECURITY, and routing metadata has to be readable *before* a tenant context
-- exists, which is the chicken-and-egg that role solves.
--
-- `CREATE OR REPLACE` cannot change a function's return type, so the old one is
-- dropped first. Both statements are in this transaction, so no session can
-- observe the window in which it does not exist.
--
-- The column grant has to be widened too. Without it the function's own owner
-- cannot read the new column and every binding lookup fails with a permission
-- error — which reads as "the database is broken", not as "one GRANT is short".

DROP FUNCTION IF EXISTS resolve_project_binding(text);

CREATE FUNCTION resolve_project_binding(p_slug text)
RETURNS TABLE (
    project_id        uuid,
    customer_id       uuid,
    keycloak_issuer   text,
    keycloak_audience text,
    identity_provider text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
-- Pinned search_path: a SECURITY DEFINER function without one can be hijacked
-- by a caller-controlled search_path resolving `projects` to another relation.
SET search_path = public, pg_temp
AS $$
    SELECT p.id, p.customer_id, p.keycloak_issuer, p.keycloak_audience,
           p.identity_provider
    FROM projects p
    WHERE p.slug = p_slug
    LIMIT 1;
$$;

ALTER FUNCTION resolve_project_binding(text) OWNER TO ds_binding_resolver;
GRANT SELECT (id, customer_id, keycloak_issuer, keycloak_audience, slug,
              identity_provider)
    ON projects TO ds_binding_resolver;

REVOKE ALL ON FUNCTION resolve_project_binding(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_project_binding(text) TO ds_app;

COMMENT ON FUNCTION resolve_project_binding(text) IS
    'Routing metadata only. Owned by ds_binding_resolver (BYPASSRLS) because '
    'FORCE ROW LEVEL SECURITY on projects would otherwise block even the '
    'SECURITY DEFINER owner. The returned customer_id is trusted only after '
    'the caller''s token validates against the returned issuer and audience.';

COMMIT;
