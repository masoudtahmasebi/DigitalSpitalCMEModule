-- A stable, public URL for an image in the Mediathek (P212-01, DEP call 11.09).
--
-- ## The problem this exists for
--
-- Media in this platform is addressed by `s3://<key>` and handed to a browser
-- as a presigned URL that expires after `S3_URL_TTL_SEC` (3600 s). That is the
-- right shape for a lecture video: the signature *is* the authorisation, which
-- is the only kind that can travel on an `<img>` or a `<video>` request, since
-- neither can carry an Authorization header.
--
-- It is the wrong shape for a course's Titelbild and a Referent's photograph.
-- Those are marketing images on a catalogue page, the client wants to paste
-- their URL into WordPress, and a URL that dies after an hour is a footgun.
-- The client, after building a course: *"why doesn't the images have a link to
-- our system that gets translated to a public s3 url?"*
--
-- So `GET /media/:id` is public and 302s to a freshly signed URL. The id is the
-- stable part; the signature is minted per request and never leaves our side.
--
-- ## Why the images-only rule is here and not in TypeScript
--
-- The endpoint has no token, so it has no tenant, so it cannot read
-- `media_assets` under RLS — exactly the situation `resolve_project_branding`
-- (0007) is in, and this follows it deliberately.
--
-- What matters is that "images only" cannot be weakened by editing a
-- controller. A lecture video is behind a watch gate for compliance reasons,
-- and an unguessable id is not that gate. Put the predicate in the function and
-- the only way to serve a video from this route is a migration, in a diff.
--
-- `mime_type LIKE 'image/%'` is the whole rule. A row with a NULL `mime_type`
-- is "not described" (P79-01) and is therefore **not** served: an undescribed
-- object is not evidence that it is an image.
BEGIN;

-- Owned by the same BYPASSRLS role the branding lookups use, for the same
-- reason: the function must see a row without a tenant context, and the column
-- grant below is what bounds what "without a tenant context" may see.
CREATE OR REPLACE FUNCTION resolve_public_image(p_id uuid)
RETURNS TABLE (storage_key text, mime_type text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT m.storage_key, m.mime_type
    FROM media_assets m
    WHERE m.id = p_id
      AND m.mime_type LIKE 'image/%'
    LIMIT 1;
$$;

ALTER FUNCTION resolve_public_image(uuid) OWNER TO ds_binding_resolver;

-- Two columns, and no more. `file_name` is the name a person chose and
-- `uploaded_by` is a user id; neither is needed to serve bytes, and a route
-- with no authentication should be able to disclose neither. Widening this is
-- a migration, in a diff — the point 0007 makes.
GRANT SELECT (id, storage_key, mime_type) ON media_assets TO ds_binding_resolver;

-- The default grant on a new function is to PUBLIC, which on a SECURITY
-- DEFINER function means every role in the cluster.
REVOKE ALL ON FUNCTION resolve_public_image(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_public_image(uuid) TO ds_app;

COMMENT ON FUNCTION resolve_public_image(uuid) IS
    'The storage key of an image asset, readable without a tenant context so '
    'that GET /media/:id can serve a stable URL for a course cover or a '
    'speaker photograph. Images only, by predicate — a video is gated content '
    'and an unguessable id is not a gate.';

COMMIT;
