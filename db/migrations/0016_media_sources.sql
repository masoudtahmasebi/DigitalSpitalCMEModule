-- One video, several renditions (P5-12).
--
-- `contents.video_url` held exactly one file, which quietly assumed that one
-- encoding plays everywhere and plays well. Neither is true:
--
--   * An H.264 MP4 is the safe floor but is a **single bitrate**. A physician
--     on a hospital connection either buffers through a 25-minute lecture or
--     downloads a needlessly large file for a laptop screen. That is not only a
--     comfort problem here — the watch gate credits the union of intervals
--     actually played, so a learner who gives up on a stalling video has the
--     shortfall recorded against their CME points.
--   * HLS solves it and Safari plays it natively, while Chrome and Firefox do
--     not without a JavaScript library. The web platform's own answer is
--     several `<source>` children and the browser takes the first `type` it can
--     play. That needs a *list*, and a single column cannot hold one.
--
-- So `media_sources` replaces `video_url` rather than sitting beside it. A
-- primary URL plus a list of alternates would be the same fact in two places,
-- free to disagree about which file is authoritative, and every reader would
-- have to know the precedence rule. There is one list; its order is the
-- precedence, and `orderSources` in `@ds/domain` decides that order.
--
-- Shape, per entry: `{"url": …, "mimeType": …, "label": …}`.
--   url      — `https://…` on the customer's CDN, or `s3://<key>` in our
--              storage. Resolved per source through the same media resolver
--              that signed `video_url`, so the tenant check on an `s3://` key
--              applies to every rendition and not merely to the first.
--   mimeType — validated against a closed list in `@ds/domain`. A browser
--              silently skips a `<source>` whose type it does not recognise, so
--              a typo here is a video that refuses to play with nothing in the
--              console to explain it.
--   label    — free text for the quality menu ("720p"). NULL when unlabelled.
--
-- jsonb rather than a `content_media_sources` table. The list belongs to
-- exactly one content, is never queried independently, is read only as a whole,
-- and is bounded at a handful of entries. A table would bring its own RLS
-- policy, its own repository methods and its own ordering column for a
-- collection that is always loaded with its parent — machinery with no
-- corresponding query. The trade accepted is that the database cannot type-check
-- the contents, which is why `parseMediaSources` drops unrecognised entries
-- instead of trusting the column.
--
-- `poster_url` arrives with it. Without a poster a `<video preload="metadata">`
-- renders a black rectangle until the first frame decodes, and the layout's
-- player has a centred play button that then sits on nothing.

-- ---------------------------------------------------------------------------
-- WHY THIS MIGRATION TURNS RLS OFF FOR THE LENGTH OF ITS OWN TRANSACTION
--
-- `contents` has FORCE ROW LEVEL SECURITY, which applies to the **table owner
-- too** — and `ds_migrator`, which runs migrations, is the owner but is
-- deliberately not BYPASSRLS (ADR-0002). With no `app.customer_id` set, it
-- therefore sees zero rows.
--
-- The first draft of this file did not account for that. The backfill below
-- reported `UPDATE 0` against a database holding 146 videos, and the
-- `DROP COLUMN video_url` two statements later would have destroyed every one
-- of those URLs — silently, with the migration reporting success. Every video
-- in every course would have become unplayable on deploy.
--
-- Migration 0009 hit the identical trap and solved it with a dedicated
-- BYPASSRLS role, because it needed one at *runtime*. This is a one-shot
-- schema change, so it does not: the owner may disable RLS on its own table,
-- the statement is transactional, and `ADD COLUMN`/`DROP COLUMN` already hold
-- ACCESS EXCLUSIVE on the table for the whole transaction — so no session can
-- observe the window in which it is off.
--
-- The final DO block asserts both flags are back on. Leaving RLS disabled here
-- would silently remove tenant isolation from the table holding every course's
-- content, and nothing else in the system would notice.
-- ---------------------------------------------------------------------------

BEGIN;

ALTER TABLE contents NO FORCE ROW LEVEL SECURITY;
ALTER TABLE contents DISABLE ROW LEVEL SECURITY;

ALTER TABLE contents
    ADD COLUMN media_sources jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN poster_url    text;

COMMENT ON COLUMN contents.media_sources IS
    'Ordered playable renditions: [{"url","mimeType","label"}]. Adaptive first — the browser takes the first type it can play.';
COMMENT ON COLUMN contents.poster_url IS
    'Still frame shown before playback. NULL renders the media element''s own blank first frame.';

-- Carry every existing video across. `video/mp4` is asserted rather than
-- inferred: every row that has a `video_url` today was authored through a form
-- that accepted one progressive file, and the seed writes MP4. An extension
-- check would be guessing at a URL that need not carry one.
UPDATE contents
   SET media_sources = jsonb_build_array(
           jsonb_build_object('url', video_url, 'mimeType', 'video/mp4', 'label', NULL)
       )
 WHERE video_url IS NOT NULL
   AND video_url <> ''
   AND media_sources = '[]'::jsonb;

-- Forward-only, and the data is above it. Keeping the column "just in case"
-- would leave two answers to "where does this video play from" for however long
-- nobody got round to it, and the next reader would have to determine which one
-- the player actually uses.
ALTER TABLE contents
    DROP COLUMN video_url;

-- A video with no source is unplayable, and the watch gate would record the
-- learner as having watched none of it — a CME failure caused by an authoring
-- mistake. The API refuses this before it reaches here (`contentProblems`);
-- this is the backstop for a seed script or a hand-run UPDATE, which is exactly
-- how such a row would otherwise arrive.
--
-- NOT VALID, and that is the interesting part. A `video` row that had no
-- `video_url` before this migration has no source after it either — it was
-- already unplayable, and this migration did not make it so. There are only two
-- ways to satisfy the constraint retroactively and both are worse than leaving
-- it: inventing a URL fabricates content nobody authored, and deleting the row
-- removes a chapter that learners may be part-way through, taking their
-- progress with it.
--
-- So the rule binds every insert and every update from here on, and history is
-- left for an author to fix in the console — where the same rule is enforced
-- with a message that says which field. Once no such rows remain,
-- `ALTER TABLE contents VALIDATE CONSTRAINT contents_video_needs_a_source`
-- makes it total; that statement takes no exclusive lock and can run online.
ALTER TABLE contents
    ADD CONSTRAINT contents_video_needs_a_source
    CHECK (kind <> 'video' OR jsonb_array_length(media_sources) > 0)
    NOT VALID;

-- The column is a list, not an object. A bare object or a string would survive
-- `parseMediaSources` as "no sources at all", which reads as an unauthored
-- video rather than as a malformed row.
--
-- Validated normally: the column is NOT NULL with an array default, so every
-- existing row already satisfies it.
ALTER TABLE contents
    ADD CONSTRAINT contents_media_sources_is_an_array
    CHECK (jsonb_typeof(media_sources) = 'array');

ALTER TABLE contents ENABLE ROW LEVEL SECURITY;
ALTER TABLE contents FORCE ROW LEVEL SECURITY;

-- Refuse to commit a migration that left tenant isolation off. Cheap, and the
-- failure it guards against is one nothing else in the system would report.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_class
         WHERE relname = 'contents'
           AND relrowsecurity
           AND relforcerowsecurity
    ) THEN
        RAISE EXCEPTION
            'contents left without FORCE ROW LEVEL SECURITY — refusing to commit';
    END IF;
END $$;

COMMIT;
