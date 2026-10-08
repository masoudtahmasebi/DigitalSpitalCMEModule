-- A second description, because a card and a page are not the same text
-- (P252-01, DEP-47).
--
-- ## The defect
--
-- `courseDetailSchema` extends `courseSummarySchema` (catalog.dto.ts:127), so
-- both inherit the one `description`. `CourseList` renders it on the catalogue
-- card; `OverviewTab` renders the same string under "Beschreibung der
-- Fortbildung" on the detail page. The client, having written one text that had
-- to do both jobs:
--
--     There are two description texts for a Fortbildung. … Currently, the same
--     text is displayed on both URLs.
--
-- ## Why this is not §9.10b
--
-- One value read by two places is the defect §9.10b names, and the fix there is
-- to delete the second reader. This is the opposite: two *different* values
-- that were never given two homes. A catalogue card wants the sentence that
-- makes somebody click; a detail page wants the paragraph saying what the
-- Fortbildung covers. Collapsing them into one column did not remove a
-- duplicate, it removed a distinction — the same argument migration 0052 makes
-- for `enrolments.delivery_email` beside `users.email`.
--
-- ## Why nullable, with no backfill
--
-- A course with this unset must render exactly what it renders today. MEDICE's
-- live course has a paragraph on its detail page, and a migration that moved or
-- blanked it would be a content loss nobody asked for. So every existing row
-- arrives null and the widget falls back to `description` — today's behaviour,
-- byte for byte, until an author types something.
--
-- That fallback lives in the widget rather than in a view or a COALESCE here,
-- because the API has to be able to tell the two apart: the admin form must
-- show this field **empty** when it is unset, or an author would be editing a
-- copy of the other text without being told (§9.4).
--
-- Not personal data: `erase_subject` is untouched, and docs/gdpr.md gains
-- nothing. This is course copy, written by an operator about an event.

BEGIN;

ALTER TABLE courses
    ADD COLUMN description_detail text;

COMMENT ON COLUMN courses.description_detail IS
    'The Fortbildung''s description on its own detail page, under '
    '"Beschreibung der Fortbildung" (P252-01, DEP-47). Null means "use '
    'courses.description", which is what every row created before this '
    'migration says and what the widget renders as the fallback. Deliberately '
    'absent from courseSummarySchema: the catalogue card renders '
    'courses.description and never this.';

COMMIT;
