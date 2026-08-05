-- The fields the 29.07 layout captures that the schema did not have (P13-03).
--
-- `docs/design/screens/` is the source of truth for the product, and a layout
-- that asks for four fields against a schema with one is a gap that shows up as
-- an invented UI. Three of these are ordinary content; the fourth is a legal
-- record and is the reason this migration exists at all.
--
-- ===========================================================================
-- 1. Consent, because page 13 asks for it explicitly
-- ===========================================================================
--
-- The Punktemeldung screen carries a checkbox:
--
--   "Ich stimme der Verarbeitung meiner personenbezogenen Daten zur
--    Übermittlung der CME-Punkte an die Ärztekammer gemäß der
--    Datenschutzerklärung zu."
--
-- That is an Art. 6(1)(a) consent, and Art. 7(1) puts the burden of *proving*
-- it on the controller: "the controller shall be able to demonstrate that the
-- data subject has consented". A checkbox the browser validates and nobody
-- records proves nothing — the box is ticked, the request succeeds, and six
-- months later there is no evidence any of it happened.
--
-- So two columns, and both are needed. `consent_given_at` is when, and
-- `consent_document` is *what was agreed to* — a privacy notice is revised, and
-- consent to the January wording is not consent to the June wording. Storing
-- only a boolean would record that somebody agreed to something.
--
-- Deliberately on `enrolments` rather than on `users`: the consent is to
-- transmitting *this* participation to the Kammer. A learner who takes a second
-- course consents again, which is what "specific" means in Art. 4(11).
--
-- ===========================================================================
-- 2. The name, in the three parts the layout asks for
-- ===========================================================================
--
-- Page 13 has `Titel*` as a select, then `Vorname*` and `Nachname*`. The schema
-- had `attested_name`, one free-text field, so the form would have had to
-- either invent a single input the layout does not draw or concatenate three
-- into one and lose the parts.
--
-- `attested_name` stays, and stays authoritative: it is what the certificate
-- prints and what the Punktemeldung reports, and there must be exactly one
-- answer to "what name was reported" (CLAUDE.md §4 invariant 6). The parts are
-- the *input*; `composeAttestedName` in `packages/domain` is the one place that
-- turns them into the reported string, and the constraint below stops a row
-- existing where the parts and the composed name disagree about whether they
-- are set.
--
-- Rows written before this migration keep their free-text name with all three
-- parts null, which the constraint permits — backfilling by splitting on
-- whitespace would guess, and a guessed given name ends up on a certificate.

BEGIN;

-- ---------------------------------------------------------------------------
-- Vorkenntnisse (layout page 02)
-- ---------------------------------------------------------------------------
--
-- The Zielgruppe section ends with a separately labelled paragraph:
-- "Vorkenntnisse: Grundkenntnisse in Psychiatrie und psychopharmakologischer
-- Behandlung sind von Vorteil, aber nicht zwingend erforderlich."
--
-- Its own column rather than the tail of `target_audience`, because the layout
-- labels it and an author who has to remember to type the label is an author
-- who will eventually not.
ALTER TABLE courses ADD COLUMN IF NOT EXISTS prerequisites text;

COMMENT ON COLUMN courses.prerequisites IS
    'The "Vorkenntnisse" paragraph under Zielgruppe (layout page 02). Plain '
    'text; the label is the widget''s.';

-- ---------------------------------------------------------------------------
-- The attested name, in parts
-- ---------------------------------------------------------------------------

ALTER TABLE enrolments
    ADD COLUMN IF NOT EXISTS attested_title text,
    ADD COLUMN IF NOT EXISTS attested_given_name text,
    ADD COLUMN IF NOT EXISTS attested_family_name text;

COMMENT ON COLUMN enrolments.attested_title IS
    'Optional academic title — "Dr. med.", "Prof. Dr." (layout page 13). '
    'Optional because the layout''s select offers no empty-but-valid choice '
    'yet somebody without a title still has to be able to finish.';
COMMENT ON COLUMN enrolments.attested_given_name IS
    'Vorname (layout page 13). Personal data — see docs/gdpr.md §2.';
COMMENT ON COLUMN enrolments.attested_family_name IS
    'Nachname (layout page 13). Personal data — see docs/gdpr.md §2.';

-- Both names or neither, and never a title on its own: a row carrying only
-- "Dr. med." is not a name, and the composer would produce one.
ALTER TABLE enrolments
    ADD CONSTRAINT enrolments_attested_parts_together CHECK (
        (attested_given_name IS NULL) = (attested_family_name IS NULL)
        AND (attested_title IS NULL OR attested_given_name IS NOT NULL)
    );

-- Parts present ⇒ a composed name exists. The composition itself is the
-- domain's job — SQL cannot be trusted to agree with it about whitespace — but
-- the database can refuse the state where parts were written and the reported
-- name was not.
ALTER TABLE enrolments
    ADD CONSTRAINT enrolments_attested_name_present CHECK (
        attested_given_name IS NULL OR attested_name IS NOT NULL
    );

-- ---------------------------------------------------------------------------
-- Consent to the Punktemeldung
-- ---------------------------------------------------------------------------

ALTER TABLE enrolments
    ADD COLUMN IF NOT EXISTS consent_given_at timestamptz,
    ADD COLUMN IF NOT EXISTS consent_document text;

COMMENT ON COLUMN enrolments.consent_given_at IS
    'When the learner ticked the Punktemeldung consent box (layout page 13). '
    'GDPR Art. 7(1) — the controller must be able to demonstrate consent.';
COMMENT ON COLUMN enrolments.consent_document IS
    'Which privacy notice was agreed to, by version. Consent to one wording is '
    'not consent to a later one, so a boolean would record only that somebody '
    'agreed to something.';

-- All or nothing. A timestamp with no document names no agreement; a document
-- with no timestamp records no act.
ALTER TABLE enrolments
    ADD CONSTRAINT enrolments_consent_complete CHECK (
        (consent_given_at IS NULL) = (consent_document IS NULL)
    );

-- ---------------------------------------------------------------------------
-- Assert the constraints actually refuse what they claim to
-- ---------------------------------------------------------------------------
--
-- In-migration, on a real database, because a CHECK that was written wrong is
-- indistinguishable from one that works until the day it matters. The same
-- device caught the append-only REVOKE naming the wrong role in 0017.

DO $$
DECLARE
    refused boolean;
BEGIN
    -- A title with no given name must be refused.
    BEGIN
        refused := false;
        UPDATE enrolments SET attested_title = 'Dr. med.'
        WHERE attested_given_name IS NULL AND id = (SELECT id FROM enrolments LIMIT 1);
    EXCEPTION WHEN check_violation THEN
        refused := true;
    END;

    IF EXISTS (SELECT 1 FROM enrolments) AND NOT refused THEN
        RAISE EXCEPTION
            'enrolments_attested_parts_together does not refuse a bare title';
    END IF;

    -- A consent timestamp with no document must be refused.
    BEGIN
        refused := false;
        UPDATE enrolments SET consent_given_at = now()
        WHERE id = (SELECT id FROM enrolments LIMIT 1);
    EXCEPTION WHEN check_violation THEN
        refused := true;
    END;

    IF EXISTS (SELECT 1 FROM enrolments) AND NOT refused THEN
        RAISE EXCEPTION 'enrolments_consent_complete does not refuse a bare timestamp';
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Erasure has to reach the new columns
-- ---------------------------------------------------------------------------
--
-- `erase_subject` is the GDPR Art. 17 path and it clears the personal data on
-- an enrolment. Three new columns carry personal data, so three new columns
-- have to be cleared — a subject-erasure routine that misses a field added
-- later is the most predictable failure this schema has, and it fails silently.
--
-- The consent record is deliberately **kept**: Art. 17(3)(b) and (e) preserve
-- processing necessary for a legal obligation and for legal claims, and the
-- evidence that a transmission to the Kammer was authorised is exactly that.
-- It names nobody once the name and EFN are gone.

CREATE OR REPLACE FUNCTION erase_subject(p_user_id uuid, p_reason text)
RETURNS TABLE (
    enrolments_pseudonymised integer,
    responses_redacted integer,
    submissions_redacted integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
    v_pending integer;
    v_erased  timestamptz;
    v_enrol   integer;
    v_resp    integer;
    v_subs    integer;
BEGIN
    SELECT erased_at INTO v_erased FROM users WHERE id = p_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'no such user: %', p_user_id
            USING ERRCODE = 'no_data_found';
    END IF;

    -- Idempotent: a repeated request is answered, not re-executed. Erasure
    -- requests get retried by people who did not see the first confirmation.
    IF v_erased IS NOT NULL THEN
        RETURN QUERY SELECT 0, 0, 0;
        RETURN;
    END IF;

    -- Across every tenant, before anything is written: a subject with
    -- enrolments at two customers must not be half-erased.
    SELECT count(*) INTO v_pending
    FROM eiv_submissions s
    JOIN enrolments e ON e.id = s.enrolment_id
    WHERE e.user_id = p_user_id
      AND s.status IN ('queued', 'held', 'failed_retryable');

    IF v_pending > 0 THEN
        RAISE EXCEPTION
            'refused: % Punktemeldung(en) still open for this subject; erasing the EFN now would leave a report that cannot be completed or corrected',
            v_pending
            USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;

    -- CHANGED IN 0024: the three name parts the layout captures are cleared
    -- alongside the composed name. An erasure routine that misses a column
    -- added after it was written is this schema's most predictable failure,
    -- and it fails silently — the request succeeds and the name is still there.
    --
    -- The parts have to go first in the same statement, because
    -- `enrolments_attested_name_present` refuses a row with a given name and
    -- no composed name; clearing `attested_name` alone would violate it.
    UPDATE enrolments
    SET attested_name = NULL,
        attested_title = NULL,
        attested_given_name = NULL,
        attested_family_name = NULL,
        updated_at = now()
    WHERE user_id = p_user_id
      AND (attested_name IS NOT NULL OR attested_given_name IS NOT NULL);
    GET DIAGNOSTICS v_enrol = ROW_COUNT;

    -- Free text only. A scale answer is a number in an aggregate once the
    -- enrolment is pseudonymised; free text is whatever was typed, which may
    -- name a patient.
    UPDATE evaluation_responses r
    SET answer = to_jsonb(erasure_marker())
    FROM enrolments e, evaluations q
    WHERE r.enrolment_id = e.id
      AND q.id = r.evaluation_id
      AND e.user_id = p_user_id
      AND q.kind = 'text';
    GET DIAGNOSTICS v_resp = ROW_COUNT;

    UPDATE certificates c
    SET participant_name = erasure_marker(), updated_at = now()
    FROM enrolments e
    WHERE c.enrolment_id = e.id AND e.user_id = p_user_id;

    -- The submission row survives — it is the evidence a report was made — but
    -- the identifier in it does not. Fifteen zeroes satisfies the CHECK while
    -- matching no real EFN.
    UPDATE eiv_submissions s
    SET efn = '000000000000000', updated_at = now()
    FROM enrolments e
    WHERE s.enrolment_id = e.id AND e.user_id = p_user_id;
    GET DIAGNOSTICS v_subs = ROW_COUNT;

    -- Not tenant-scoped: one physician, one EFN, across customers.
    DELETE FROM efn_profiles WHERE user_id = p_user_id;

    UPDATE users
    SET email = NULL, first_name = NULL, last_name = NULL,
        erased_at = now(), updated_at = now()
    WHERE id = p_user_id;

    -- Append-only, and deliberately without the identifiers it just removed:
    -- an erasure record that quoted the erased name would be the one place the
    -- name survived. The user id stays because Art. 19 requires being able to
    -- say the erasure happened. `customer_id NULL` because this event belongs
    -- to no single tenant.
    INSERT INTO audit_log (customer_id, actor_id, action, subject, detail)
    VALUES (
        NULL, NULL, 'gdpr.subject.erased', p_user_id::text,
        jsonb_build_object(
            'reason', left(coalesce(p_reason, ''), 200),
            'enrolments', v_enrol,
            'freeTextResponses', v_resp,
            'submissions', v_subs
        )
    );

    RETURN QUERY SELECT v_enrol, v_resp, v_subs;
END;
$fn$;

COMMIT;
