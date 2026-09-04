-- Where this participant's Teilnahmebescheinigung is sent (P183-01).
--
-- ## The defect
--
-- The support panel P179 built told an operator:
--
--     No e-mail address is on file for this person. Resending cannot succeed —
--     download the certificate and send it another way.
--
-- True, and a dead end. `delivery.repository.ts` reads the recipient as
-- `users.email` at send time, `planDeliveryAttempt` abandons `no_recipient`
-- when it is null rather than posting a certificate to nobody, and **nothing on
-- the platform could supply one** — not the physician, not an operator. A
-- screen that names a cause and offers no remedy is CLAUDE.md §9.4.
--
-- ## Why a column here and not a change to `users.email`
--
-- For a `local` participant the address **is** the credential:
-- `user_identities.subject` holds it and `createPerson` writes both from one
-- input. Writing `users.email` alone would leave somebody signing in with the
-- old address while every screen showed the new one — §9.10b, two homes for one
-- value. Writing both is an account-email change, and an unverified one is an
-- account-takeover path; that is a ticket with a security argument to make, not
-- a field to add here.
--
-- These are also genuinely **different values**, which is what makes two
-- columns right rather than a duplication: `users.email` is who this person is
-- to their identity provider, and this is where one document goes. The client's
-- own case is exactly that — "it can be the case that they want to have the
-- certificate in another email".
--
-- ## Why on the enrolment
--
-- `enrolments` is tenant-scoped, so RLS bounds an operator to their own
-- customer's participants. `users` carries no RLS by design — it spans tenants
-- — so a per-person address would be a cross-tenant write reachable from a
-- customer administrator's screen.
--
-- And not on `certificates`: re-creating a certificate is one of the two
-- buttons beside the field that sets this, and it would lose the value.
--
-- ## Erasure
--
-- A second place a subject's address lives is a second place `erase_subject`
-- must find. The function is replaced whole below, carrying 0041's body with
-- one column added — replaced rather than patched because a function that
-- erases half a subject is worse than one that fails.

BEGIN;

ALTER TABLE enrolments
    ADD COLUMN delivery_email text;

-- The same shape `admin_users_email_shape` holds staff to, and deliberately not
-- a full address grammar: the authority on whether an address exists is the
-- mail server, and a regex that refuses a valid unusual address is a physician
-- who cannot receive their own certificate.
ALTER TABLE enrolments
    ADD CONSTRAINT enrolments_delivery_email_shape
    CHECK (delivery_email IS NULL OR position('@' in delivery_email) > 1);

COMMENT ON COLUMN enrolments.delivery_email IS
    'Where this enrolment''s Teilnahmebescheinigung is sent, when it differs '
    'from the account address in users.email (P183-01). Delivery resolves '
    'COALESCE(delivery_email, users.email), so null means "the account address" '
    'and nothing has to be set for the ordinary case. Personal data: nulled by '
    'erase_subject, recorded in docs/gdpr.md.';

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

    -- CHANGED IN 0041: the archived PDFs are queued for deletion *before* the
    -- rows that name them are cleared. The other order loses the keys.
    --
    -- One row per archived certificate. The object carries the name, the
    -- Anschrift and the EFN on its face, so it is not redactable in place the
    -- way a column is — it has to go.
    INSERT INTO object_erasures (customer_id, object_key, reason)
    SELECT c.customer_id, c.pdf_object_key, 'subject_erasure'
    FROM certificates c
    JOIN enrolments e ON e.id = c.enrolment_id
    WHERE e.user_id = p_user_id AND c.pdf_object_key IS NOT NULL;

    -- The three name parts the layout captures are cleared alongside the
    -- composed name (0024), and CHANGED IN 0041 the Anschrift with them. An
    -- erasure routine that misses a column added after it was written is this
    -- schema's most predictable failure, and it fails silently — the request
    -- succeeds and the data is still there.
    --
    -- The parts have to go in the same statement as the composed name, because
    -- `enrolments_attested_name_present` refuses a row with a given name and
    -- no composed name.
    UPDATE enrolments
    SET attested_name = NULL,
        attested_title = NULL,
        attested_given_name = NULL,
        attested_family_name = NULL,
        attested_address = NULL,
        -- CHANGED IN 0052: the delivery address. It is the subject's own
        -- e-mail address on a tenant-scoped row, and the sentence a few lines
        -- up is exactly why it is here rather than found in a year: "an
        -- erasure routine that misses a column added after it was written is
        -- this schema's most predictable failure, and it fails silently".
        delivery_email = NULL,
        updated_at = now()
    WHERE user_id = p_user_id
      AND (attested_name IS NOT NULL OR attested_given_name IS NOT NULL
           OR attested_address IS NOT NULL OR delivery_email IS NOT NULL);
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

    -- CHANGED IN 0041: the archive reference goes with the name. The row
    -- survives — it is the evidence a Fortbildung was completed — and the
    -- pointer to a document naming the physician does not.
    UPDATE certificates c
    SET participant_name = erasure_marker(),
        pdf_object_key = NULL,
        pdf_sha256 = NULL,
        pdf_archived_at = NULL,
        updated_at = now()
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
            'submissions', v_subs,
            -- A count, not the keys: an object key names a customer, a course
            -- and a certificate, which is exactly what this record must not
            -- carry.
            'objectsQueuedForDeletion', (
                SELECT count(*) FROM object_erasures
                WHERE reason = 'subject_erasure' AND deleted_at IS NULL
                  AND requested_at >= now() - interval '1 minute'
            )
        )
    );

    RETURN QUERY SELECT v_enrol, v_resp, v_subs;
END;
$fn$;

ALTER FUNCTION erase_subject(uuid, text) OWNER TO ds_erasure;

COMMIT;
