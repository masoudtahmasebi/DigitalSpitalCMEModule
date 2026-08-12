-- Courses are drafts until somebody publishes them (P53-01).
--
-- Found by QA: `POST /admin/courses` created a course and it appeared in the
-- learner catalogue **immediately** — listed, openable, and enrollable, with
-- no modules, no content and no accreditation. An operator building a course
-- in the console was building it in front of the physicians.
--
-- There was no editorial state at all. The only thing that could hide a course
-- was the validity window (P50-01), and that is a different question: `valid_
-- from`/`valid_to` say *when an accredited course runs*, not *whether it is
-- finished being written*. Nothing defaulted a new course to hidden, because
-- there was no hidden to default to.
--
-- ## Why the default is 'draft' and the backfill is 'published'
--
-- They point in opposite directions on purpose.
--
-- Every course that exists **right now** is live: seeded, seen by learners,
-- some with completions against them. Defaulting the column would make all of
-- them drafts and empty three tenants' catalogues on deploy, so the backfill
-- names them published explicitly.
--
-- Every course created **after** this migration is a draft, because that is
-- the safe direction for the one operation that was wrong: creation. An
-- author who forgets to publish shows nobody an unfinished course; an author
-- who forgets to unpublish shows everybody one.
--
-- ## Why an enum and not a boolean
--
-- `published boolean` reads fine until the third state arrives — retired,
-- scheduled, under review — and then it is a boolean plus a nullable date plus
-- a comment explaining which combinations are legal. The type names the states
-- and the database refuses the rest.
--
-- ## Why RLS is off for the length of this transaction
--
-- The backfill above only means anything if it can see the rows, and it
-- cannot: `courses` has FORCE ROW LEVEL SECURITY, which applies to the table
-- owner too, and `ds_migrator` — the owner — is deliberately not BYPASSRLS
-- (ADR-0002). With no `app.customer_id` set it matches zero rows.
--
-- The first draft of this file did not account for that, and it did not fail
-- quietly: the `SET NOT NULL` two statements later refused with *"column
-- status of relation courses contains null values"*, which names the
-- statement that could not succeed rather than the one that did nothing. It
-- was found by running the migration against the integration database, which
-- runs as `ds_migrator` — the QA database had had it applied by hand as
-- `postgres`, a superuser, which bypasses RLS and hid the bug completely
-- (CLAUDE.md §9.6, and §9.9's corollary: the same SQL is not the same
-- outcome under a different role).
--
-- Migration 0016 hit this identically and its reasoning holds here: this is a
-- one-shot schema change, the owner may disable RLS on its own table, the
-- statements are transactional, and `ADD COLUMN` already holds ACCESS
-- EXCLUSIVE for the whole transaction — so no session can observe the window
-- in which it is off. The DO block at the end refuses to commit if it was
-- left off.
BEGIN;

ALTER TABLE courses NO FORCE ROW LEVEL SECURITY;
ALTER TABLE courses DISABLE ROW LEVEL SECURITY;

CREATE TYPE course_status AS ENUM ('draft', 'published');

-- Added nullable, backfilled, then made NOT NULL: adding a NOT NULL column
-- with a default rewrites the table under an ACCESS EXCLUSIVE lock on older
-- servers, and this table is read by every catalogue request.
ALTER TABLE courses ADD COLUMN status course_status;

UPDATE courses SET status = 'published' WHERE status IS NULL;

ALTER TABLE courses
  ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN status SET DEFAULT 'draft';

COMMENT ON COLUMN courses.status IS
  'Editorial state (P53-01). A draft is invisible to learners: not listed, '
  '404 on the detail route, and refused by enrol. New courses default to '
  'draft; every course predating this migration was backfilled to published. '
  'Separate from valid_from/valid_to, which say when an accredited course '
  'runs rather than whether it is finished being written.';

-- The catalogue filters on it on every request, alongside the tenant and the
-- validity window.
CREATE INDEX courses_status_idx ON courses (customer_id, status);

ALTER TABLE courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE courses FORCE ROW LEVEL SECURITY;

-- Refuse to commit a migration that left tenant isolation off `courses`. One
-- customer's catalogue leaking into another's is the failure this whole
-- schema is arranged to prevent, and nothing else in the system would report
-- it — the queries would simply start returning more rows.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_class
         WHERE relname = 'courses'
           AND relrowsecurity
           AND relforcerowsecurity
    ) THEN
        RAISE EXCEPTION
            'courses left without FORCE ROW LEVEL SECURITY — refusing to commit';
    END IF;
END $$;

COMMIT;
