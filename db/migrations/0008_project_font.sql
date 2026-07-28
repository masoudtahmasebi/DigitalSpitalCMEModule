-- Self-hosted white-label fonts (P10-08).
--
-- WHY THE BYTES LIVE HERE AND NOT ON A CDN
--
-- The whole point of letting a customer upload a font is that nothing about it
-- leaves our infrastructure. A German healthcare site that loads a webfont from
-- Google transmits every visitor's IP address to a US service, which LG München
-- I (3 O 17493/20) found unlawful without consent. Pointing a customer at
-- "just host it yourself somewhere" moves the problem rather than solving it,
-- because the somewhere is usually a CDN.
--
-- So: the customer uploads a file, it is stored here, and it is served from the
-- same origin as the API. No third party is contacted, no consent banner is
-- needed for it, and there is nothing for a DPA to disclose.
--
-- Storage is a bytea column rather than object storage, for the same reason
-- migration 0006 stores the certificate stamp inline: a subsetted woff2 is tens
-- of kilobytes, it is read on nearly every widget render, and putting an
-- outbound HTTP call on that path would make a CDN blip into unstyled text.
--
-- WHY woff2 AND woff ONLY
--
-- Not because older formats are unsupported — because they are unnecessary and
-- each one is more parser surface. woff2 covers every browser that can run a
-- Shadow-DOM custom element at all; woff is the fallback for nothing in
-- particular and is kept only because some foundries still ship it.
--
-- **SVG fonts are deliberately impossible.** An SVG font is executable markup,
-- uploaded by a customer admin and served from our own origin — which is to
-- say, a stored XSS with extra steps. The CHECK constraint below is the second
-- line of defence; the first is that the API sniffs the magic bytes and
-- ignores the declared type.

BEGIN;

ALTER TABLE projects
    ADD COLUMN font_file        bytea,
    ADD COLUMN font_mime        text,
    -- The family name the CSS refers to. Stored separately from the file
    -- because `@font-face { font-family: X }` and `font-family: X` have to
    -- agree, and deriving a name from a filename would be a guess.
    ADD COLUMN font_family_name text,
    -- Cache-busting. A customer replacing their font must not wait on a
    -- year-long cache, and the URL is public so it cannot carry a token.
    ADD COLUMN font_updated_at  timestamptz;

ALTER TABLE projects
    -- 2 MB. A subsetted woff2 is 20–80 KB; a full unsubsetted family with CJK
    -- coverage can legitimately reach a megabyte. Beyond that somebody has
    -- uploaded the wrong thing, and an unbounded bytea reachable from an upload
    -- endpoint is a denial-of-service surface.
    ADD CONSTRAINT font_file_bounded
        CHECK (font_file IS NULL OR octet_length(font_file) <= 2097152),
    ADD CONSTRAINT font_mime_allowed
        CHECK (font_mime IS NULL OR font_mime IN ('font/woff2', 'font/woff')),
    -- A family name reaches a CSS declaration, so it is constrained here as
    -- well as in `@ds/domain`. Two enforcement points for a value that ends up
    -- in a stylesheet is not redundancy worth removing.
    ADD CONSTRAINT font_family_name_shape
        CHECK (font_family_name IS NULL OR font_family_name ~ '^[A-Za-z0-9 _-]{1,64}$'),
    -- All four together or none. A file with no family name cannot be
    -- referenced; a family name with no file resolves to nothing.
    ADD CONSTRAINT font_all_or_nothing
        CHECK (
            (font_file IS NULL AND font_mime IS NULL AND font_family_name IS NULL
                AND font_updated_at IS NULL)
            OR
            (font_file IS NOT NULL AND font_mime IS NOT NULL
                AND font_family_name IS NOT NULL AND font_updated_at IS NOT NULL)
        );

-- The public branding lookup needs to know a font exists and what it is called
-- — never the bytes, which are served by their own endpoint.
GRANT SELECT (font_family_name, font_updated_at) ON projects TO ds_binding_resolver;

-- The return type widens, and Postgres will not do that in place: `CREATE OR
-- REPLACE` refuses to change a function's return type. Dropping first is the
-- documented way, and it is safe here because nothing holds a reference to it
-- across the transaction — the API resolves it by name on every call.
DROP FUNCTION IF EXISTS resolve_project_branding(text);

CREATE FUNCTION resolve_project_branding(p_slug text)
RETURNS TABLE (
    branding         jsonb,
    font_family_name text,
    font_updated_at  timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT p.branding, p.font_family_name, p.font_updated_at
    FROM projects p
    WHERE p.slug = p_slug
    LIMIT 1;
$$;

ALTER FUNCTION resolve_project_branding(text) OWNER TO ds_binding_resolver;
REVOKE ALL ON FUNCTION resolve_project_branding(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_project_branding(text) TO ds_app;

-- Serving the font file itself is also pre-auth — the widget needs it before a
-- learner has a token — so it needs its own resolver. Separate from the one
-- above because that one is called on every render and must not drag a
-- megabyte of font bytes through it.
CREATE FUNCTION resolve_project_font(p_slug text)
RETURNS TABLE (font_file bytea, font_mime text, font_updated_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT p.font_file, p.font_mime, p.font_updated_at
    FROM projects p
    WHERE p.slug = p_slug AND p.font_file IS NOT NULL
    LIMIT 1;
$$;

ALTER FUNCTION resolve_project_font(text) OWNER TO ds_binding_resolver;
GRANT SELECT (font_file, font_mime) ON projects TO ds_binding_resolver;
REVOKE ALL ON FUNCTION resolve_project_font(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_project_font(text) TO ds_app;

COMMENT ON FUNCTION resolve_project_font(text) IS
    'The uploaded webfont for a project slug. Readable without a tenant '
    'context because the widget needs it before a learner has a token. '
    'Returns the font and nothing else.';

COMMIT;
