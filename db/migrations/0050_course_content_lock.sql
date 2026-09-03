-- A course whose content is closed to further edits (P178-01).
--
-- ## The defect this exists for
--
-- The client built "DS Test Course" — two modules, a video, a text section, an
-- exam of two questions, six CME points — worked through it as a physician,
-- passed the exam, and stopped before entering their EFN. Then they opened the
-- course in Verwaltung and added a second video to module 1.
--
--     Earlier the video percentage was 100%, now it shows 75% completion only.
--
-- Nothing was broken. `courseWatchCoverage` weights by duration across every
-- video the course *currently* holds, so a course that grows re-denominates
-- everybody in it — including a physician who had finished. They were one form
-- away from claiming a CME point and are now short of the watch gate, with no
-- notification and nothing on any screen to say why.
--
-- This is the same shape as P174-01 (a threshold raised under an unfinished
-- learner) with the protection missing: `alreadyCompleted` holds a **completed**
-- enrolment complete, and this physician had not finished the paperwork, so
-- there was nothing to hold.
--
-- ## Why a lock rather than a rule about coverage
--
-- The client's own reading, and it is the right one:
--
--   > we should lock the course contents with the modules which are created,
--   > when one of the user has completed the course and lock mode does this.
--   > with lock mode we cannot have the feasibility to add more content and
--   > this doesn't make sense.
--
-- The alternative — freeze each enrolment's denominator to the tree as it stood
-- when they enrolled — is a second snapshot of exactly the kind P171 and P174
-- spent a day removing, and it would leave two physicians on one course being
-- graded against different material with nothing on screen saying so.
--
-- A lock says the honest thing instead: **a Fortbildung somebody has completed
-- is a fixed body of material.** Change it and you are running a different
-- event, which is what the clone in P178-02 is for.
--
-- ## What the column is, and what it is not
--
-- `content_locked` governs the **structure**: modules, chapters, contents and a
-- Lernerfolgskontrolle's questions. It deliberately does not govern the course's
-- own fields — a VNR arriving from the Bescheid, a corrected title, the
-- accreditation window — because those are P171-01's "the event's identity" and
-- correcting them must reach every certificate.
--
-- Not a `course_status` value, and not derived from `enrolments`. Two reasons:
-- an operator may lock a course before anybody enrols (the client asked for it
-- to be settable at creation), and they may unlock one deliberately, which a
-- derived flag cannot express. `status` answers "is this on the catalogue";
-- this answers "may its material still change". A course can be draft and
-- locked, or published and open.

BEGIN;

ALTER TABLE courses
    ADD COLUMN content_locked boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN courses.content_locked IS
    'When true, the course''s modules, chapters, contents and quiz questions '
    'may not be created, changed, reordered or deleted (P178-01). Set by an '
    'operator, and set automatically the first time an enrolment on the course '
    'completes. Course-level fields stay editable — see the migration header.';

COMMIT;
