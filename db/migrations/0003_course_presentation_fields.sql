-- P2-01 follow-up: three course fields the final layout requires that schema v1
-- missed, caught by auditing the Zeplin screens against the DTOs before the
-- API contract freezes (adding them later would rev the contract and SDK).
--
--   hero_image_url       the course artwork, shown on the list card and the
--                        detail hero. One field, not two: the layout uses the
--                        same asset in both places.
--   learning_objectives  the "Lernziele" checklist on the detail Übersicht,
--                        one entry per bullet.
--   target_audience      the "Zielgruppe" section. Plain text with newlines —
--                        rich WYSIWYG authoring is explicitly deferred
--                        (docs/roadmap.md §4), so the widget renders line
--                        breaks and nothing more.
--
-- All three are presentation content, no compliance semantics: nullable/empty
-- defaults, no backfill needed.

BEGIN;

ALTER TABLE courses
    ADD COLUMN hero_image_url text,
    ADD COLUMN learning_objectives text[] NOT NULL DEFAULT '{}',
    ADD COLUMN target_audience text;

COMMIT;
