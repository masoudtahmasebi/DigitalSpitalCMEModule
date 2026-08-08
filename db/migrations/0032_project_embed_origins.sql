-- Which origins may embed a project's widget, on the project (P18-04).
--
-- ## Why this was in an env file, and why that was wrong
--
-- `EXTRA_CORS_ORIGINS` in `config.env` was the union of every customer's
-- embedding origins across the whole installation. So MEDICE's WordPress origin
-- was permitted to call the API on behalf of *any* project, and adding a second
-- customer widened the list for the first. That is not a tenant boundary; it is
-- a shared allow-list with a tenant-shaped comment above it.
--
-- Which origins may embed a project's widget is a fact about that project, and
-- belongs beside its Keycloak binding.
--
-- ## The obstacle the old comment named, and how it is actually solved
--
-- A CORS **preflight carries no `X-DS-Project` header** — browsers do not send
-- custom headers on an `OPTIONS` — so the API cannot know which project is
-- being asked about at the moment it has to answer.
--
-- It does not need to. The question CORS asks is "may this *origin* talk to
-- this API at all", and that is answerable by looking the origin up across
-- every project. The per-project part is enforced later and elsewhere, where it
-- belongs: the request carries `X-DS-Project`, the guard resolves the binding,
-- and RLS scopes every row. CORS was never the tenant boundary and treating it
-- as one is what made the env file look acceptable.
--
-- So this table answers "is this origin known", and `resolve_embed_origins`
-- below is how the API asks without a tenant context — the same
-- `SECURITY DEFINER` pattern `resolve_project_binding` uses, and for the same
-- chicken-and-egg reason.

BEGIN;

-- ---------------------------------------------------------------------------
-- The column
-- ---------------------------------------------------------------------------
--
-- `text[]` rather than a child table. An origin has no attributes of its own,
-- is never referenced by anything, and the whole set is read at once — a table
-- would buy a join and a migration and nothing else.
--
-- The CHECK is not decoration. An entry with a path, a trailing slash or a
-- wildcard silently never matches, because `Origin` is scheme + host + port and
-- nothing else; an operator who pasted `https://www.medice.de/` would get a
-- CORS failure with no clue why. Refusing at write time turns that into an
-- error message next to the field.

-- The shape test lives in a function because a CHECK constraint may not
-- contain a subquery, and "every element matches" is naturally one. IMMUTABLE
-- and strict-ish: it depends on nothing but its argument, which is what lets a
-- CHECK use it at all.
CREATE FUNCTION is_origin_list(origins text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT coalesce(
        bool_and(o ~ '^https?://[A-Za-z0-9.-]+(:[0-9]{1,5})?$'),
        true  -- an empty array is a valid empty list, not a violation
    )
    FROM unnest(origins) AS o;
$$;

COMMENT ON FUNCTION is_origin_list(text[]) IS
    'Every element is scheme + host + optional port — exactly what a browser '
    'puts in an Origin header. A path, a trailing slash or a wildcard would '
    'silently never match (P18-04).';

ALTER TABLE projects
    ADD COLUMN embed_origins text[] NOT NULL DEFAULT '{}',
    ADD CONSTRAINT projects_embed_origins_shape CHECK (is_origin_list(embed_origins));

COMMENT ON COLUMN projects.embed_origins IS
    'Origins allowed to embed this project''s widget — a customer''s own site. '
    'Scheme + host + optional port, no path and no trailing slash, because '
    'that is exactly what a browser puts in an Origin header (P18-04).';

-- ---------------------------------------------------------------------------
-- Reading them without a tenant context
-- ---------------------------------------------------------------------------
--
-- `projects` has FORCE ROW LEVEL SECURITY and CORS runs before anything has
-- established a customer — before the guard, before the interceptor, and on an
-- `OPTIONS` that carries no credential at all. A direct read returns zero rows
-- and every embedded widget breaks.
--
-- Owned by `ds_binding_resolver`, which exists for precisely this and holds a
-- column-level grant rather than the table.

CREATE FUNCTION resolve_embed_origins()
RETURNS SETOF text
LANGUAGE sql
STABLE
SECURITY DEFINER
-- Pinned: a SECURITY DEFINER function without one can be hijacked by a
-- caller-controlled search_path resolving `projects` to another relation.
SET search_path = public, pg_temp
AS $$
    SELECT DISTINCT unnest(p.embed_origins) FROM projects p;
$$;

ALTER FUNCTION resolve_embed_origins() OWNER TO ds_binding_resolver;
GRANT SELECT (embed_origins) ON projects TO ds_binding_resolver;

REVOKE ALL ON FUNCTION resolve_embed_origins() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_embed_origins() TO ds_app;

-- ---------------------------------------------------------------------------
-- The assertion
-- ---------------------------------------------------------------------------
--
-- Migration 0017 discovered a REVOKE that had silently not applied. A grant
-- that quietly did not take here is every embedded widget failing CORS on the
-- next deploy, with a browser-side error message and nothing in our logs.

DO $$
BEGIN
    IF NOT has_function_privilege('ds_app', 'resolve_embed_origins()', 'EXECUTE') THEN
        RAISE EXCEPTION 'ds_app cannot resolve embed origins';
    END IF;
END $$;

COMMIT;
