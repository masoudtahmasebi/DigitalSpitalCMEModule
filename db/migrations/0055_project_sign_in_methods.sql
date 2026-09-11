-- Which sign-in methods a project permits, and the catalogue preview that
-- follows from one of them (P213-01).
--
-- ## What the client asked for
--
-- > there is the possibility to login with doccheck in the website and see the
-- > hcp area […] when the user logs in with doccheck they are able to see the
-- > course list, and they can see course descriptions, but if they want to
-- > participate, they will get a popup […] there should be a settings also for
-- > this project if doccheck login is permitted or not, if keycloak is
-- > permitted or not.
--
-- ## Two columns, and why the DocCheck one is also the preview switch
--
-- A DocCheck login **cannot produce a platform token**. The WordPress plugin
-- has said so since P96: `class-ds-lms-token-source.php` — *"DocCheck does not
-- identify a physician to the accreditation chain"* — and the widget's
-- signed-out state exists for exactly that visitor.
--
-- So "DocCheck is permitted" and "a visitor holding no platform token may read
-- this project's catalogue" are **the same switch**. Two columns would be two
-- names for one fact, and the pair would eventually disagree (§9.10b).
-- `doccheck_login_allowed` is therefore the one that opens the preview, and
-- this comment is where that identity is written down rather than inferred.
--
-- What it does **not** open is anything a token is for: enrolling, watching,
-- sitting the Lernerfolgskontrolle, the Evaluationsbogen, an EFN, a
-- Punktemeldung or a certificate. Those stay exactly where they are, behind a
-- Keycloak bearer the API validates against JWKS (§4 invariant 2). A preview
-- reader has no enrolment because they have no user, which is a property of the
-- request rather than a filter somebody has to remember.
--
-- ## Defaults, chosen so an existing installation does not change behaviour
--
-- `doccheck_login_allowed` defaults to **false**: no project starts disclosing
-- its catalogue because a migration ran. `keycloak_login_allowed` defaults to
-- **true**, because every project today signs in through Keycloak and a default
-- of false would sign everybody out at the next deploy.
BEGIN;

ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS doccheck_login_allowed boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS keycloak_login_allowed boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN projects.doccheck_login_allowed IS
    'Whether this project offers the DocCheck entry point. Because DocCheck '
    'yields no platform token, this is also what permits a tokenless visitor '
    'to read the catalogue and course descriptions — never to participate.';

COMMENT ON COLUMN projects.keycloak_login_allowed IS
    'Whether this project offers the Keycloak entry point. A project with '
    'neither method permitted can be read by nobody, which the console '
    'refuses rather than storing.';

-- Neither method permitted is refused here as well as in the service.
--
-- The service's refusal is the one an operator reads — it names the pair in
-- German and arrives as a 422 on the form. This one exists because a console is
-- not the only way rows get written: a seed, a migration or a psql session can
-- reach this table, and a project nobody can sign in to is a project whose
-- widget renders a screen with no way forward (§9.2).
--
-- NOT VALID is deliberate and is *not* a weakening here: every existing row has
-- keycloak_login_allowed = true by the default above, so there is nothing to
-- fail. It is validated immediately below, which is what makes that a claim the
-- database checks rather than one this comment makes.
ALTER TABLE projects
    DROP CONSTRAINT IF EXISTS projects_sign_in_method_check;
ALTER TABLE projects
    ADD CONSTRAINT projects_sign_in_method_check
    CHECK (doccheck_login_allowed OR keycloak_login_allowed) NOT VALID;
ALTER TABLE projects VALIDATE CONSTRAINT projects_sign_in_method_check;

-- The preview's gate, in SQL.
--
-- A public request has no principal, so it has no tenant context, so it cannot
-- use `@TenantDb()` — which refuses to run without one, by design. This
-- function is the only thing that turns a project slug into a customer id for
-- an unauthenticated caller, and it yields one **only** when the project has
-- opted in.
--
-- The caller then runs the ordinary catalogue queries inside `runInTenant` with
-- that customer, so RLS applies exactly as it does for a signed-in learner and
-- there is no second implementation of "which courses are visible" (§9.10b).
-- The disclosure decision is this predicate and nothing else.
--
-- Same shape as `resolve_project_branding` (0007), `resolve_project_signin`
-- (0028) and `resolve_public_image` (0054): SECURITY DEFINER, owned by the
-- BYPASSRLS resolver role, with a column grant that bounds what it can read.
CREATE OR REPLACE FUNCTION resolve_catalogue_preview(p_slug text)
RETURNS TABLE (customer_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT p.customer_id
    FROM projects p
    WHERE p.slug = p_slug
      AND p.doccheck_login_allowed
    LIMIT 1;
$$;

ALTER FUNCTION resolve_catalogue_preview(text) OWNER TO ds_binding_resolver;

-- One new column for this role, beside the four 0002 granted and the sign-in
-- columns 0028 added. `customer_id` it already reads for the sign-in lookup.
GRANT SELECT (slug, customer_id, doccheck_login_allowed) ON projects TO ds_binding_resolver;

REVOKE ALL ON FUNCTION resolve_catalogue_preview(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_catalogue_preview(text) TO ds_app;

COMMENT ON FUNCTION resolve_catalogue_preview(text) IS
    'The customer a project belongs to, for an unauthenticated catalogue '
    'preview — and only when that project permits DocCheck, which is the '
    'login that yields no platform token. Returns no row otherwise, so an '
    'opted-out project is indistinguishable from one that does not exist.';

COMMIT;
