-- P94-04 — an embed origin may be a pattern.
--
-- ## Why the CHECK has to move too
--
-- `is_origin_list` (migration 0032) refuses anything with a `*` in it, on the
-- reasoning that a wildcard "silently never matches" — which was true while the
-- API compared origins with `Set.has`. It now matches with
-- `embedOriginAllowed` in `@ds/domain`, so a wildcard matches exactly what its
-- own grammar says.
--
-- The constraint is not decoration and stays: the console is not the only way
-- rows get written — a seed, a migration or an operator with psql can write
-- one — and a row the API cannot use is worse here than elsewhere, because a
-- CORS refusal is invisible from the server. The browser blocks the request and
-- nothing reaches a log (CLAUDE.md §9.13).
--
-- ## What it must refuse, and why that is the whole point
--
-- A bare `*`, `*://…`, `https://*`, `https://*.de`. This API answers with
-- `Access-Control-Allow-Credentials: true` and the fetch specification forbids
-- that together with a wildcard origin *precisely* because it would let any
-- page on the web make authenticated requests as a signed-in physician. A
-- wildcard must always be anchored to a name somebody has registered — which
-- means at least two labels after the star.
--
-- The grammar here is deliberately the same shape as `isEmbedOriginPattern`'s,
-- and `embed-origin.test.ts` is where it is exhaustively tested. This is the
-- backstop, not the definition.

BEGIN;

CREATE OR REPLACE FUNCTION is_origin_list(origins text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT coalesce(
        bool_and(
            -- scheme://host[:port] — host is either a plain name or `*.` and a
            -- name of at least two labels; port is digits or `*`.
            o ~ '^https?://([a-z0-9]([a-z0-9-]*[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:([0-9]{1,5}|\*))?$'
         OR o ~ '^https?://\*(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?){2,}(:([0-9]{1,5}|\*))?$'
        ),
        true  -- an empty array is a valid empty list, not a violation
    )
    FROM unnest(origins) AS o;
$$;

COMMENT ON FUNCTION is_origin_list(text[]) IS
    'Every element is scheme + host + optional port, where the host may begin '
    '"*." and the port may be "*". A bare wildcard is refused: the API sends '
    'Access-Control-Allow-Credentials and the fetch spec forbids the pair '
    '(P94-04, was P18-04).';

COMMENT ON COLUMN projects.embed_origins IS
    'Origins allowed to embed this project''s widget — a customer''s own sites. '
    'An exact origin, or "*." and a domain for any sub-domain, or ":*" for any '
    'port. No path and no trailing slash: that is what a browser puts in an '
    'Origin header (P94-04).';

COMMIT;
