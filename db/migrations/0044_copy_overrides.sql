-- The customer's own words for the learner's screens (P83-01).
--
-- ## Why a column beside `branding`
--
-- `projects.branding` already carries the customer's colours, logo, font and
-- catalogue title. The wording is the same kind of fact about the same tenant,
-- wanted at the same moment — the widget's mount — and a table of its own would
-- buy a join for a single blob that is never queried on its own.
--
-- It is served by its own endpoint (`GET /copy`) rather than folded into
-- `GET /branding`, which is a different question: `Branding` is a typed object
-- whose fields become CSS variables, and merging an open map of arbitrary keys
-- into it would give one response two grammars and one parser two jobs.
--
-- Separate from `branding` rather than folded into it because the two have
-- different shapes and different validation. `branding` is a fixed set of named
-- fields with a grammar each — a URL must be `https://`, a colour must parse.
-- This is an open map whose keys are decided by the widget's own locale table,
-- and whose values are all "some text". One blob with two grammars would make
-- `parseBranding` responsible for a key space it knows nothing about.
--
-- ## What is in it
--
-- Dotted key to replacement string — `{"player.back": "Zurück zum Kurs"}`. The
-- keys are exactly `COPY_KEYS` in `@ds/copy`, derived from the defaults table,
-- so a key here that is not there is a setting for a screen that no longer
-- exists. The API refuses to store one rather than accumulating orphans nobody
-- can see or delete.
--
-- ## Why the default is an empty object and not NULL
--
-- Every read applies it. `{}` means "the platform's own words", which is a real
-- and common answer; NULL would mean the same thing and oblige every reader to
-- say so again, which is how one of them eventually forgets.
--
-- ## Not personal data
--
-- Interface wording chosen by the customer's staff. No learner, no physician,
-- no EFN — nothing here reaches `docs/gdpr.md` §2.

BEGIN;

ALTER TABLE projects
    ADD COLUMN copy_overrides jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN projects.copy_overrides IS
    'Dotted locale key to the customer''s replacement text (P83-01). '
    'Keys are COPY_KEYS from @ds/copy; the API refuses any other.';

-- ## Readable before a token exists, the same way branding is
--
-- The widget renders its loading, "session expired" and "not embedded" states
-- **pre-auth**, and those states have words in them. So the wording has to be
-- readable without a tenant context, for exactly the reason
-- `resolve_project_branding` gives in migration 0007 — and it follows that
-- function's rules rather than inventing looser ones: one argument, one
-- non-sensitive column, STABLE, a pinned search_path, owned by the NOLOGIN
-- BYPASSRLS role that exists to own these functions and nothing else, EXECUTE
-- granted only to ds_app.
--
-- ## Why this is not a hole in ADR-0002
--
-- Interface wording rendered on a public page to every visitor, signed in or
-- not. Guessing a project slug reveals the words that customer's own website
-- already shows anyone who loads it. No ids, no binding, no SMTP.
CREATE OR REPLACE FUNCTION resolve_project_copy(p_slug text)
RETURNS TABLE (copy_overrides jsonb)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT p.copy_overrides
    FROM projects p
    WHERE p.slug = p_slug
    LIMIT 1;
$$;

ALTER FUNCTION resolve_project_copy(text) OWNER TO ds_binding_resolver;

-- The column grant is where "returns display data only" is actually enforced.
-- `ds_binding_resolver` holds BYPASSRLS, so RLS does not constrain it — it can
-- only read the columns it has been granted. Widening what any of these
-- functions can see therefore requires adding a column name here, in a
-- migration, in a diff. That is the point (0007).
GRANT SELECT (copy_overrides) ON projects TO ds_binding_resolver;

-- The default grant on a new function is to PUBLIC, which on SECURITY DEFINER
-- means every role in the cluster.
REVOKE ALL ON FUNCTION resolve_project_copy(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_project_copy(text) TO ds_app;

COMMENT ON FUNCTION resolve_project_copy(text) IS
    'The customer''s wording overrides for a project slug, readable without a '
    'tenant context because the widget renders worded states before it has a '
    'token. Display data only — no ids, no Keycloak binding, no SMTP.';

COMMIT;
