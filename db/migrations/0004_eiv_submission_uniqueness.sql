-- P7-02 follow-up: one Punktemeldung per enrolment, enforced by the database.
--
-- Schema v1 left `eiv_submissions.enrolment_id` unconstrained. That is wrong on
-- two counts:
--
-- 1. **Correctness.** One enrolment is one participation, which the
--    Ärztekammer credits once. Two rows for the same enrolment would mean two
--    submissions for the same physician on the same course — at best rejected
--    downstream, at worst double-credited.
-- 2. **Idempotency.** The completion endpoint queues the submission with
--    `ON CONFLICT (enrolment_id) DO NOTHING`, which Postgres rejects outright
--    without a matching unique constraint. Its statutory deadlines are computed
--    from the *first* completion; a second call must not silently restart the
--    8-day reporting clock.
--
-- `evaluation_responses` already carries UNIQUE (enrolment_id, evaluation_id),
-- so the evaluation path had this property from the start; this brings the EIV
-- path in line.

BEGIN;

ALTER TABLE eiv_submissions
    ADD CONSTRAINT eiv_submissions_one_per_enrolment UNIQUE (enrolment_id);

COMMIT;
