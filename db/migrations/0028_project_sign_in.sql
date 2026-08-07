-- Where a customer's learners actually sign in (P21-03).
--
-- ## The bug this fixes
--
-- `fortbildung.digitalspital.com/` sent every visitor straight to
--
--     https://login.medice.de/realms/medice/protocol/openid-connect/auth?…
--
-- with no link back to anywhere. Two things wrong with that, and they are
-- different problems:
--
-- 1. **The portal was one customer's front door.** `PORTAL_PROJECT_SLUG` in the
--    deployment decided which, so a visitor who had nothing to do with MEDICE
--    was pushed at MEDICE's identity provider before being shown a single word
--    about where they were. P21-03 puts the tenant in the path instead; the
--    root becomes a welcome page that names no customer and starts no login.
--
-- 2. **That is not how MEDICE signs anybody in.** Their WordPress plugin uses
--    the resource-owner password grant against their Keycloak, from a form on
--    their own site, with a client secret the plugin holds server-side. The
--    portal was inventing a second, different authentication route into the
--    same realm — one MEDICE never asked for and whose branding is Keycloak's
--    rather than theirs.
--
-- ## What replaces it
--
-- A project says where its learners sign in, and the portal links there rather
-- than deciding for itself:
--
--   login_url IS NOT NULL   send them to that page — the customer's own login,
--                           on the customer's own site. This is MEDICE.
--   login_url IS NULL       the portal's own sign-in applies, which is the
--                           local participant account of P21-02.
--
-- It is a per-project setting because that is the level identity is configured
-- at already (`keycloak_issuer`, `identity_provider`, migration 0019) — and
-- because a customer with two projects may well run one inside their CMS and
-- one standalone.
--
-- ## Why a URL and not a boolean
--
-- "Does this customer log in elsewhere?" would need the elsewhere to live
-- somewhere else anyway, and the only somewhere else available is deploy
-- configuration — which is exactly what P21-03 is removing. A customer
-- administrator can set this from the console without a redeploy, which is the
-- property that matters: their login page moving is their business, not ours.
--
-- ## The check constraint is not decoration
--
-- This value is rendered as an `href` for a learner to click. A `javascript:`
-- URL there is stored cross-site scripting with a customer administrator as the
-- author, and `//evil.example` is an open redirect wearing a relative path. The
-- grammar below admits `https://` and nothing else — not even `http://`, since
-- a login page reached over plaintext is a credential handed to the network.

BEGIN;

ALTER TABLE projects
    ADD COLUMN login_url text
        CONSTRAINT projects_login_url_is_https
        CHECK (login_url IS NULL OR login_url ~ '^https://[a-zA-Z0-9]');

COMMENT ON COLUMN projects.login_url IS
    'Where this project''s learners sign in, when that is the customer''s own '
    'page rather than ours — MEDICE''s WordPress login, for instance. NULL '
    'means the portal''s own participant sign-in applies (P21-03).';

-- ---------------------------------------------------------------------------
-- The public lookup
-- ---------------------------------------------------------------------------
--
-- Runs for an **unauthenticated** visitor: the portal has to render `/medice`
-- and decide what its sign-in button does before anybody has signed in. Same
-- chicken-and-egg as `resolve_project_binding` (migration 0002) and the same
-- resolution — a SECURITY DEFINER owned by `ds_binding_resolver`, returning the
-- minimum and nothing tenant-scoped.
--
-- What it returns is deliberately less than the branding lookup: a display
-- name, which is on the customer's own website anyway, and where to sign in,
-- which is a link that customer publishes. Nothing here is a fact an outsider
-- could not obtain by visiting the customer.
--
-- It does **not** return `keycloak_issuer`. A visitor has no use for it, and
-- the moment it is in a public payload somebody will build a second login flow
-- out of it — which is the exact mistake this migration exists to undo.

CREATE OR REPLACE FUNCTION resolve_project_signin(p_slug text)
RETURNS TABLE (
    project_id    uuid,
    customer_name text,
    login_url     text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT p.id, c.name, p.login_url
    FROM projects p
    JOIN customers c ON c.id = p.customer_id
    WHERE p.slug = p_slug
    LIMIT 1;
$$;

ALTER FUNCTION resolve_project_signin(text) OWNER TO ds_binding_resolver;

-- `customers.name` is a new column for this role to read; the rest it already
-- holds from migrations 0002 and 0021.
GRANT SELECT (id, name) ON customers TO ds_binding_resolver;
GRANT SELECT (login_url) ON projects TO ds_binding_resolver;

REVOKE ALL ON FUNCTION resolve_project_signin(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_project_signin(text) TO ds_app;

COMMENT ON FUNCTION resolve_project_signin(text) IS
    'What an anonymous visitor to /{tenant} needs: the customer''s display name '
    'and where to sign in. Deliberately returns no issuer — a public payload '
    'carrying one invites a second login flow (P21-03).';

COMMIT;
