-- The customer's own media library (P81-01).
--
-- ## Why a table, when the objects already exist
--
-- Every upload since P23-01 has gone into the bucket under
-- `<customerId>/courses/<courseId>/…` and been *referenced* by exactly one
-- field — a content's poster, a source URL, a material's file. The object is
-- real and reachable; what has never existed is the answer to "what have we
-- uploaded?"
--
-- The consequence was reported directly: an operator who uploaded an
-- introduction video once had no way to use it in a second course. There is no
-- listing, so the only way to reuse a file is to remember its key or upload it
-- again — which is how a bucket accumulates six copies of the same recording,
-- each with its own key, none of them replaceable in one place.
--
-- A bucket can be listed, so the alternative was a `ListObjectsV2` per screen.
-- Rejected for three reasons, and the third is the one that decides it:
--
--   1. it is a network round trip to another service on every render;
--   2. it cannot be filtered or paged the way a screen needs without pulling
--      the whole prefix;
--   3. **a bucket holds bytes, not meaning.** Alt text, a human title, who
--      uploaded it and when, and whether anything still points at it are not
--      properties of an object — they are the properties this table exists for,
--      and accessibility is the one that makes it non-optional. An `<img>` with
--      no alt text is a WCAG 1.1.1 failure, and there was nowhere to put one.
--
-- ## Tenant isolation
--
-- `customer_id` with FORCE ROW LEVEL SECURITY, the same as every other
-- tenant-scoped table (ADR-0002). The object-storage half of the guarantee is
-- unchanged: keys stay under the customer prefix and the server still refuses
-- to sign one outside it. This table adds a second, independent place where a
-- cross-tenant read is refused by the database rather than by application code.
--
-- ## What it deliberately does not hold
--
-- No personal data beyond `uploaded_by`, which is a pseudonymous
-- `admin_users` id and nothing else. `file_name` is the **author's** original
-- filename and is shown back to them, so it is the one field here that could
-- carry something they did not intend — it is displayed only inside the
-- customer's own console, never to a learner, and never in a log. The storage
-- key remains the name *we* generated (`uploadObjectName`), never theirs.

BEGIN;

CREATE TABLE media_assets (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id   uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,

    -- The `s3://…` reference, exactly as it is stored on a content today. One
    -- row per object: the unique constraint is what makes "upload the same
    -- file twice" converge on one library entry rather than two.
    storage_key   text NOT NULL,

    -- What the author called it when they picked it. Shown in the library so a
    -- person recognises their own file; never used to build a key.
    file_name     text NOT NULL,

    -- Derived, never typed (P79-01). Null when the extension was not one we
    -- recognise — which is legitimate and means "not described".
    mime_type     text,

    byte_size     bigint CHECK (byte_size IS NULL OR byte_size >= 0),

    -- A human title, and the alternative text a screen reader announces.
    --
    -- `alt_text` is separate from `title` on purpose: a title names the file
    -- for the person managing it ("Intro Modul 1"), alt text describes the
    -- image for somebody who cannot see it, and using one for the other
    -- produces alt text that reads like a filing label. Null means "not set" —
    -- which the console reports rather than silently emitting `alt=""`, since
    -- an empty alt claims the image is decorative and that is a statement.
    title         text,
    alt_text      text,

    uploaded_by   uuid,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),

    -- One library row per object. Scoped to the customer because the key
    -- already carries the customer prefix; the pair is belt and braces.
    CONSTRAINT media_assets_key_unique UNIQUE (customer_id, storage_key)
);

COMMENT ON TABLE media_assets IS
    'Every file a customer has uploaded, so it can be found and reused (P81-01). '
    'The bucket holds the bytes; this holds what they are for.';

CREATE INDEX media_assets_customer_recent
    ON media_assets (customer_id, created_at DESC);

-- The library screen filters by kind ("show me the videos"), and kind is the
-- first token of the MIME type. Indexed as an expression so the filter does
-- not become a sequential scan once a customer has a few hundred files.
CREATE INDEX media_assets_customer_kind
    ON media_assets (customer_id, split_part(mime_type, '/', 1));

ALTER TABLE media_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_assets FORCE ROW LEVEL SECURITY;

CREATE POLICY media_assets_tenant_isolation ON media_assets
    USING (customer_id = nullif(current_setting('app.customer_id', true), '')::uuid)
    WITH CHECK (customer_id = nullif(current_setting('app.customer_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON media_assets TO ds_app;

COMMIT;
