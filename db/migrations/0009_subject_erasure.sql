-- Erasure of a data subject, GDPR Art. 17 (P10-06).
--
-- WHY ERASURE HERE MEANS PSEUDONYMISATION, NOT DELETION
--
-- Art. 17(3)(b) excepts processing necessary "for compliance with a legal
-- obligation". A CME participation record is exactly that: the Punktemeldung
-- has gone to the Ärztekammer, the physician's points are credited against it,
-- and the Teilnahmebescheinigung is a document a Kammer may ask to see. Deleting
-- the row would not honour a right, it would destroy the counterpart of a
-- report already filed under somebody's name.
--
-- So the fact of participation survives — which course, which VNR, how many
-- points, when it completed, that a report was made — and everything that
-- identifies the person is removed:
--
--   users              email, first_name, last_name → NULL, erased_at set
--   efn_profiles       row deleted (the EFN is the identifier)
--   enrolments         attested_name → NULL
--   evaluation_responses  free-text answers → a redaction marker
--   certificates       participant_name → a redaction marker
--   eiv_submissions    efn → all zeroes
--
-- What is left cannot be attributed to a person without the Keycloak account,
-- which the customer deletes on their own side. That is pseudonymisation in the
-- sense of Art. 4(5) becoming anonymisation once the realm entry is gone.
--
-- WHY THE FREE TEXT GOES AND THE SCALE ANSWERS STAY
--
-- A scale answer ("how relevant was this course, 1–5") is not personal data
-- once the enrolment is pseudonymised; it is a number in an aggregate MEDICE
-- has a legitimate interest in. A free-text answer is whatever the physician
-- chose to type, which may name a patient. It goes.
--
-- WHY A PENDING PUNKTEMELDUNG BLOCKS THIS
--
-- The EFN is the key the Ärztekammer credits points against. Erasing it while a
-- submission is queued, held or retrying would leave a report that cannot be
-- completed and cannot be corrected — and the correction window closes
-- permanently. The function refuses, loudly, and the operator waits for the
-- window. That is a delay measured in days against a right that has a month
-- (Art. 12(3)), and it is the only ordering that does not break the statutory
-- record.
--
-- WHY THIS IS AN OPERATOR ACTION AND NOT AN ADMIN ENDPOINT
--
-- The data spans tenants. One physician has one EFN and may hold enrolments at
-- several customers; a customer_admin erasing "their" learner would delete an
-- identifier another customer's pending submission depends on. Erasure is
-- therefore performed by DigitalSpital as processor, on the controller's
-- documented instruction, through `apps/api/src/subject-erasure.ts`. The
-- reasoning is in docs/gdpr.md.

BEGIN;

ALTER TABLE users
    -- Set once, never cleared. Also the flag that stops a later token
    -- provisioning the profile back in — see the trigger below.
    ADD COLUMN erased_at timestamptz;

-- What a redacted value looks like, so a reader knows the difference between
-- "never given" (NULL) and "removed on request".
CREATE OR REPLACE FUNCTION erasure_marker() RETURNS text
LANGUAGE sql IMMUTABLE AS $$ SELECT 'geloescht'::text $$;

-- ---------------------------------------------------------------------------
-- The erasure itself
-- ---------------------------------------------------------------------------

-- WHY THIS ONE FUNCTION BYPASSES RLS
--
-- `enrolments`, `eiv_submissions`, `certificates` and `evaluation_responses`
-- are under FORCE ROW LEVEL SECURITY, which applies to the table owner too, so
-- a SECURITY DEFINER function owned by ds_migrator sees **nothing** without a
-- tenant context. The first draft of this migration did exactly that: every
-- UPDATE reported zero rows and the function returned success having erased
-- only the columns that are not tenant-scoped. An erasure that silently
-- half-runs is worse than one that fails.
--
-- Setting `app.customer_id` per tenant inside the function does not fix it
-- either, because discovering *which* tenants the subject belongs to is itself
-- a tenant-scoped read.
--
-- So the function is owned by `ds_erasure` — NOLOGIN, BYPASSRLS, owning this
-- one function and nothing else — exactly as `ds_binding_resolver` owns the
-- pre-authentication lookups. That is honest about what is happening: erasure
-- is not a tenant acting within its own data, it is the processor acting on the
-- whole database on the controller's written instruction. One physician has one
-- EFN and may hold enrolments at several customers; there is no tenant context
-- in which this operation is expressible.
--
-- Its blast radius is this file. The body is fixed, it takes a user id, it
-- cannot be reached by `ds_app` (see the REVOKE below), and nothing can connect
-- as the role that owns it.

CREATE FUNCTION erase_subject(p_user_id uuid, p_reason text)
RETURNS TABLE (
    enrolments_pseudonymised integer,
    responses_redacted       integer,
    submissions_redacted     integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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

    UPDATE enrolments SET attested_name = NULL, updated_at = now()
    WHERE user_id = p_user_id AND attested_name IS NOT NULL;
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
$$;

ALTER FUNCTION erase_subject(uuid, text) OWNER TO ds_erasure;

-- BYPASSRLS lets the owner past the policies; it grants no privilege on its
-- own. These are the tables the body above touches, and only the verbs it
-- uses — no DELETE on enrolments, no anything on courses, quiz_answers or
-- projects. The role owns one function and can reach nothing this list does
-- not name.
GRANT SELECT, UPDATE                 ON users                TO ds_erasure;
GRANT SELECT, DELETE                 ON efn_profiles         TO ds_erasure;
GRANT SELECT, UPDATE                 ON enrolments           TO ds_erasure;
GRANT SELECT, UPDATE                 ON evaluation_responses TO ds_erasure;
GRANT SELECT                         ON evaluations          TO ds_erasure;
GRANT SELECT, UPDATE                 ON certificates         TO ds_erasure;
GRANT SELECT, UPDATE                 ON eiv_submissions      TO ds_erasure;
GRANT INSERT                         ON audit_log            TO ds_erasure;
GRANT USAGE                          ON SEQUENCE audit_log_id_seq TO ds_erasure;

REVOKE ALL ON FUNCTION erase_subject(uuid, text) FROM PUBLIC;
-- The operator CLI's role, and nothing else. `ds_app` — the role every HTTP
-- request runs as — is deliberately absent: a bug in any controller must not
-- be an erasure primitive.
GRANT EXECUTE ON FUNCTION erase_subject(uuid, text) TO ds_migrator;

COMMENT ON FUNCTION erase_subject(uuid, text) IS
    'GDPR Art. 17 erasure as pseudonymisation. Refuses while a Punktemeldung '
    'is still open. Operator action — not executable by ds_app.';

-- ---------------------------------------------------------------------------
-- Erasure has to stick
-- ---------------------------------------------------------------------------
--
-- `provisionOrUpdate` writes the profile from the token on every request. An
-- erased subject who signs in again — because the Keycloak account has not been
-- deleted yet, or was recreated — would have their name and email written
-- straight back, and nobody would notice, because the write is a normal part of
-- every request.
--
-- A trigger rather than a rule in application code: this must hold against
-- every writer, including one a later ticket generates.

CREATE FUNCTION users_keep_erased() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.erased_at IS NOT NULL THEN
        NEW.email      := NULL;
        NEW.first_name := NULL;
        NEW.last_name  := NULL;
        NEW.erased_at  := OLD.erased_at;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER users_keep_erased
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION users_keep_erased();

COMMENT ON TRIGGER users_keep_erased ON users IS
    'An erased profile stays erased even if the subject signs in again.';

COMMIT;
