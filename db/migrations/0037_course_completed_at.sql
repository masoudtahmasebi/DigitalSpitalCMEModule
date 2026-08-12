-- Course completion, separately from certification (P51-01).
--
-- `completed_at` has always meant "certified": watched, passed, evaluated, EFN
-- on file, Punktemeldung queued. That is the moment a CME point is claimed and
-- it must keep meaning exactly that — every downstream reader of it (the
-- certificate, the EIV worker, the admin participant list) depends on it.
--
-- What was missing is the earlier moment: the physician has watched the videos
-- and passed the Lernerfolgskontrolle, and the Fortbildung is *done*. They may
-- supply the Evaluationsbogen and their EFN days later, and until P51-01 the
-- platform called them incomplete for that whole period.
--
-- Two columns rather than one reused, because the gap between them is the
-- entire point and a single timestamp cannot record both ends of it. "When did
-- this person finish the course?" and "when did they earn the point?" are
-- different questions that an auditor may well ask separately.
--
-- Nullable and unbackfilled. A row already carrying `completed_at` was
-- certified under the old rule, which implies the course was complete — but we
-- do not know *when* the course became complete, only when everything did.
-- Writing `completed_at` into this column would assert a completion date the
-- system never observed, and an invented date on a compliance record is worse
-- than an absent one. `course_completed_at` is therefore only ever set going
-- forward; readers treat NULL-with-completed_at-set as "complete, date not
-- recorded" rather than "incomplete".
BEGIN;

ALTER TABLE enrolments
  ADD COLUMN course_completed_at timestamptz;

COMMENT ON COLUMN enrolments.course_completed_at IS
  'When the videos and the Lernerfolgskontrolle were finished (P51-01). '
  'Earlier than or equal to completed_at, which additionally requires the '
  'evaluation and the EFN. NULL on rows completed before this column existed.';

-- The invariant the application maintains, enforced here so that a future
-- writer cannot invert it: a certified enrolment whose course-completion date
-- IS recorded must have finished the course no later than it was certified.
-- Rows predating the column (course_completed_at IS NULL) are exempt, which is
-- what lets this be added without a backfill.
ALTER TABLE enrolments
  ADD CONSTRAINT enrolments_course_completed_before_completed
  CHECK (
    course_completed_at IS NULL
    OR completed_at IS NULL
    OR course_completed_at <= completed_at
  );

COMMIT;
