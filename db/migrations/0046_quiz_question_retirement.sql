-- A Lernerfolgskontrolle can be revised after a physician has sat it (P114-01).
--
-- ## The report
--
-- "the questions in here are taken one time, but now i want to change this
-- lernerfolgskontrolle and delete some questions, but i can not … this
-- lernerfolgskontrolle has 11 questions, I want to make it to only 2 questions
-- and i can not."
--
-- Correct, and by design: `authoring.service.ts` refuses to delete a question
-- with recorded answers, because `quiz_answers.question_id` is the evidence
-- behind a CME point that may already have been reported to an Ärztekammer.
-- Deleting the row would leave the point credited and the reason for it gone.
--
-- ## Why the refusal was still wrong
--
-- It conflated two different things:
--
--   * **the row must survive** — true, always, and non-negotiable;
--   * **the question must stay in the exam** — not true, and not something an
--     accreditation rule anywhere requires.
--
-- So an author revising a draft exam hit a permanent wall the moment one person
-- answered it once. The only escape was to build a new Lernerfolgskontrolle and
-- abandon the old, which loses the very continuity the refusal existed to
-- protect.
--
-- ## Why a tombstone here and not in the course tree
--
-- `canDelete` in `@ds/domain` rejects soft deletion in terms, and is right to:
-- *"A course tree with hidden tombstones in it is a tree where ordering, gating
-- and the rollup all have to know about tombstones, and every one of those is a
-- place to get a compliance answer wrong."*
--
-- A quiz question is not in that tree. It hangs off a single `contents` row and
-- participates in **none** of the three: the rollup counts contents, gating
-- reads videos, and ordering within an exam is local to that exam. So the
-- objection does not transfer, and this is the one place a tombstone is cheap.
--
-- The same comment ends: *"An author who genuinely needs the item gone after
-- learners have used it needs a conversation, not a button."* That conversation
-- happened on 25.08. This is its outcome.
--
-- ## What retirement means, exactly
--
--   * the row stays, with its options and its `quiz_answers` intact;
--   * every attempt already submitted keeps its stored `correct_count`,
--     `total_count`, `score_percent` and `passed` — those are denormalised onto
--     `quiz_attempts`, so no past result can be moved by editing the exam;
--   * no future attempt is served it, and no future attempt is scored against
--     it.
--
-- Nothing about an already-earned CME point changes. That is the property that
-- makes this safe, and `apps/api/test/integration` asserts it directly.

BEGIN;

ALTER TABLE quiz_questions
    ADD COLUMN retired_at timestamptz;

COMMENT ON COLUMN quiz_questions.retired_at IS
    'When this question was removed from the exam (P114-01). NULL = live. '
    'A retired question is never served and never scored, and is kept because '
    'quiz_answers rows reference it as the evidence behind a CME point.';

-- Retired questions must not hold an ordinal slot.
--
-- `UNIQUE (content_id, ordinal)` was table-wide, so retiring question 3 of 11
-- and renumbering the survivors 1..2 would collide with the tombstone still
-- sitting at 3. Made partial instead: the constraint means what it always
-- meant — *the exam* has no two questions in one position — and says nothing
-- about rows that are no longer in the exam.
--
-- The retired row keeps whatever ordinal it had. That is deliberate: it records
-- where the question stood when it was answered, which is the question an
-- auditor reconstructing an attempt would ask.
ALTER TABLE quiz_questions
    DROP CONSTRAINT quiz_questions_content_id_ordinal_key;

CREATE UNIQUE INDEX quiz_questions_live_ordinal
    ON quiz_questions (content_id, ordinal)
    WHERE retired_at IS NULL;

-- Every read on the learner's path filters on this, and so does the editor's.
CREATE INDEX quiz_questions_content_live
    ON quiz_questions (content_id)
    WHERE retired_at IS NULL;

COMMIT;
