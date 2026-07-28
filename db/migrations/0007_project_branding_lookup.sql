-- White-label branding lookup (P10-05), supporting ADR-0002 and ADR-0007.
--
-- WHY THIS EXISTS SEPARATELY FROM resolve_project_binding
--
-- The widget needs a logo, a colour and a typeface **before** it has a token:
-- its loading state, its "session expired" state and its "not embedded" state
-- all render pre-auth, and the admin console's login screen has no token by
-- definition. So branding must be readable without a tenant context, exactly
-- like the Keycloak binding.
--
-- The obvious move is to widen `resolve_project_binding` to return branding
-- too. That is not done here on purpose. That function's docstring promises
-- "routing metadata only, never tenant data", and its narrowness is what makes
-- it auditable in one screen. Adding display data to it would erode a
-- guarantee that is doing real work, to save one function.
--
-- WHY THIS IS NOT A HOLE IN ADR-0002
--
-- Branding is, by construction, the least secret data in the system. It is a
-- logo, two colours and a font name — rendered on a public WordPress page to
-- every visitor, signed in or not. Guessing a project slug reveals what that
-- customer's public website already shows anyone who visits it.
--
-- The narrowness still matters, so this function follows the same rules as its
-- sibling: one argument, one non-sensitive column, `STABLE`, a pinned
-- `search_path`, owned by `ds_binding_resolver` (the NOLOGIN BYPASSRLS role
-- that exists to own exactly these functions and nothing else), and EXECUTE
-- granted only to `ds_app`.
--
-- WHAT IT DELIBERATELY DOES NOT RETURN
--
-- Not the customer id, not the project id, not the Keycloak binding, not the
-- SMTP settings that live on the same row. A caller who guesses a slug learns
-- what colour the buttons are and nothing else — in particular, nothing that
-- would help them authenticate.

BEGIN;

CREATE OR REPLACE FUNCTION resolve_project_branding(p_slug text)
RETURNS TABLE (branding jsonb)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT p.branding
    FROM projects p
    WHERE p.slug = p_slug
    LIMIT 1;
$$;

ALTER FUNCTION resolve_project_branding(text) OWNER TO ds_binding_resolver;

-- The column-level grant is where "returns display data only" is actually
-- enforced. `ds_binding_resolver` holds BYPASSRLS, so RLS does not constrain
-- it — but it can still only read the columns it has been granted, and 0002
-- granted it exactly five. Without this line the function fails with
-- "permission denied for table projects" rather than quietly returning SMTP
-- settings, which is the right failure and is how this migration was caught
-- being wrong the first time it ran.
--
-- So: to widen what any of these functions can see, somebody has to add a
-- column name here, in a migration, in a diff. That is the point.
GRANT SELECT (branding) ON projects TO ds_binding_resolver;

-- PUBLIC must not hold EXECUTE: the default grant on a new function is to
-- PUBLIC, which on a SECURITY DEFINER function means every role in the
-- cluster.
REVOKE ALL ON FUNCTION resolve_project_branding(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_project_branding(text) TO ds_app;

COMMENT ON FUNCTION resolve_project_branding(text) IS
    'White-label branding for a project slug, readable without a tenant '
    'context because the widget renders branded states before it has a token. '
    'Returns display data only — no ids, no Keycloak binding, no SMTP.';

COMMIT;
