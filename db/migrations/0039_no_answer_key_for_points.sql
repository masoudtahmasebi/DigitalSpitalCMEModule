-- An accredited course may not reveal its answer key (P56-01).
--
-- `assessment.ts` has said since P4-02 that "no endpoint ever returns a
-- correctness marker for a CME-certified course". Nothing enforced it. The API
-- honoured `courses.reveal_correct_answers` on its own, and QA turned that
-- column on for a course awarding CME points and got one boolean per question
-- back — which, with unlimited retries, is the answer key in four rounds, on a
-- Lernerfolgskontrolle that is a condition of the Anerkennung.
--
-- The service now asks `mayRevealCorrectAnswers` in `@ds/domain`, which is
-- where the rule belongs. This constraint is the second answer to the same
-- question, and it is here because the two failure modes are different: the
-- service protects the *response*, and this protects the *row*. A support
-- script, a seed, or a future admin field that sets the flag on an accredited
-- course is refused by the database rather than quietly stored and ignored —
-- a stored `true` that never takes effect is a setting somebody will one day
-- "fix" by making it work.
--
-- ## Why NOT VALID is not used here
--
-- The constraint is validated immediately, because it can be: no course in any
-- tenant has the flag set (the column defaults to false and no route writes
-- it), so there is nothing historic to grandfather. If that were ever untrue
-- the migration would fail loudly here rather than leave the rule half-applied,
-- which is the outcome to want.
--
-- ## Why RLS comes off
--
-- `courses` is under FORCE ROW LEVEL SECURITY and `ds_migrator` is not
-- BYPASSRLS (ADR-0002). `ALTER TABLE … ADD CONSTRAINT` does not read rows
-- through the policies, so this one would have worked either way — but the
-- validation scan does, and a constraint "validated" against zero visible rows
-- is exactly the silent half-success that migration 0038 was written to avoid.
-- Off for the transaction, asserted back on before it commits.
BEGIN;

ALTER TABLE courses NO FORCE ROW LEVEL SECURITY;
ALTER TABLE courses DISABLE ROW LEVEL SECURITY;

ALTER TABLE courses
  ADD CONSTRAINT courses_no_answer_key_for_points
  CHECK (NOT reveal_correct_answers OR cme_points IS NULL OR cme_points = 0);

COMMENT ON COLUMN courses.reveal_correct_answers IS
  'Whether a quiz attempt may report which answers were right. Refused for a '
  'course awarding CME points by courses_no_answer_key_for_points and by '
  'mayRevealCorrectAnswers in @ds/domain (P56-01): with unlimited retries, '
  'per-question feedback is the answer key, and the Lernerfolgskontrolle is a '
  'condition of the Anerkennung.';

ALTER TABLE courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE courses FORCE ROW LEVEL SECURITY;

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
