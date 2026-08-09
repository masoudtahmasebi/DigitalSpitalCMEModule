-- P31-02 · Which credit a completion claims, per course.
--
-- EIV's push_teilnahme carries `punkte_basis_flag` and `punkte_lernerfolg_flag`
-- separately, and `GET /fobi/veranstalter/veranstaltung` declares a point value
-- for each. Which of them an accredited course may claim is a question only the
-- Ärztekammer can answer (S25), and it can differ per course — so it is a
-- course setting rather than a constant in the reporter.
--
-- Both default TRUE, and the reasoning is in `reporter.ts`: claiming credit the
-- event does not carry is refused loudly, inside the 8-day window, in front of
-- an operator. Not claiming credit that was earned is accepted silently and the
-- physician is short of points with nothing anywhere saying so. A wrong answer
-- that fails is recoverable; a wrong answer that succeeds is not.
--
-- NOT NULL with a default rather than nullable: "nobody has decided yet" and
-- "the Kammer says no" would otherwise be the same value, and the worker would
-- have to invent a reading of NULL at the moment it submits.

BEGIN;

ALTER TABLE courses
  ADD COLUMN eiv_punkte_basis boolean NOT NULL DEFAULT true,
  ADD COLUMN eiv_punkte_lernerfolg boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN courses.eiv_punkte_basis IS
  'Claim punkte_basis_flag on the Punktemeldung. See S25.';
COMMENT ON COLUMN courses.eiv_punkte_lernerfolg IS
  'Claim punkte_lernerfolg_flag on the Punktemeldung. See S25.';

-- A Punktemeldung an operator withdrew at the Ärztekammer.
--
-- Distinct from every existing state, and distinct from deleting the row:
-- "reported, then taken back" is a different history from "never reported",
-- and on a CME record the difference is the whole point. EIV agrees — its
-- withdrawal zeroes the points and keeps the Vorgang traceable rather than
-- deleting anything.
--
-- ADD VALUE is safe inside this transaction because nothing here *uses* the
-- new label; Postgres only refuses a value added and used in the same one.
ALTER TYPE eiv_status ADD VALUE IF NOT EXISTS 'withdrawn';

COMMIT;
