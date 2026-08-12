-- The certificate as an archived artefact, and the two fields on its face
-- that the platform did not hold (P60).
--
-- Three changes, one migration, because they are one decision: MEDICE asked
-- that the Teilnahmebescheinigung be **kept**, not only rendered — "for later
-- verification, per course and per customer" — and a kept document has to be
-- complete, which means the EFN and the Anschrift the Muster asks for.
--
-- ## Why an archive at all when the PDF is rendered on demand
--
-- The rendered document is a *view* of the record. The archive is what the
-- record looked like at the moment a physician was told they had earned it.
-- Those answer different questions, and only one of them can be answered by
-- re-rendering:
--
--   "show me my certificate"                     → the view, always current
--   "prove what was issued on 12.08.2026"        → the bytes, as they were
--
-- A re-render years later cannot supply the second: fonts change, the layout
-- changes, a course's stamp gets replaced, and the accreditation the document
-- refers to may have lapsed. The Kammer, an audit, or a dispute asks the
-- second question.
--
-- So the serving path is unchanged — the download and the e-mail both still
-- render from the record, which is what keeps them the same document — and the
-- archive sits beside it as evidence. `pdf_sha256` is what makes it evidence
-- rather than a copy: an archived object whose digest does not match the row
-- has been altered, and that is answerable without trusting the bucket.
--
-- ## And why an erasure queue comes with it
--
-- This is the first personal data the platform puts somewhere Postgres cannot
-- reach. `erase_subject` has always been able to redact every column that
-- names a physician; it cannot delete an object in a bucket. Adding the
-- archive without the queue would make erasure quietly incomplete — the
-- request would succeed, the audit row would say so, and a PDF carrying the
-- name, the address and the EFN would sit in object storage indefinitely.
--
-- 0024 already recorded this exact failure shape one table over: "an erasure
-- routine that misses a column added after it was written is this schema's
-- most predictable failure, and it fails silently". This is the same thing at
-- one remove.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The Anschrift (P60-03)
-- ---------------------------------------------------------------------------
--
-- On the enrolment beside the attested name, not on `users`, and for the same
-- reason: it is what the learner attested to for *this* Punktemeldung. A
-- physician who moves does not thereby change the address on a certificate
-- already issued, and a certificate is a document about a moment.
--
-- Nullable and never required. The Bescheid's minimum field list does not
-- include it (docs/show-stoppers.md S12 is still open with the ÄKWL), so a
-- learner who leaves it empty must still be able to finish — the renderer
-- draws the line either way, because the Muster has it.
ALTER TABLE enrolments
  ADD COLUMN attested_address text;

COMMENT ON COLUMN enrolments.attested_address IS
  'The postal address the learner gave for the Teilnahmebescheinigung '
  '(P60-03). Optional: the Muster has an "Anschrift:" line, the Bescheid does '
  'not require it. Cleared by erase_subject.';

-- Bounded, because it is free text that goes onto a printed document. Long
-- enough for a German address on three lines; short enough that it cannot be
-- used as storage.
ALTER TABLE enrolments
  ADD CONSTRAINT enrolments_attested_address_length
  CHECK (attested_address IS NULL OR char_length(attested_address) <= 200);

-- ---------------------------------------------------------------------------
-- 2. The archive record (P60-01)
-- ---------------------------------------------------------------------------
ALTER TABLE certificates
  ADD COLUMN pdf_object_key  text,
  ADD COLUMN pdf_sha256      text,
  ADD COLUMN pdf_archived_at timestamptz;

COMMENT ON COLUMN certificates.pdf_object_key IS
  'Key of the archived PDF in object storage (P60-01), always beginning '
  '<customer_id>/certificates/<course_id>/. NULL means not archived — either '
  'not yet, or erased. Never a URL: a stored URL is a capability anybody '
  'reading a backup could use.';

COMMENT ON COLUMN certificates.pdf_sha256 IS
  'Digest of the archived bytes, so a later verification can tell "this is the '
  'document we issued" from "this is a document in our bucket".';

-- All three together or none of them. A key with no digest is an object we
-- cannot vouch for, and a digest with no key names nothing.
ALTER TABLE certificates
  ADD CONSTRAINT certificates_archive_all_or_nothing
  CHECK (
    (pdf_object_key IS NULL AND pdf_sha256 IS NULL AND pdf_archived_at IS NULL)
    OR (pdf_object_key IS NOT NULL AND pdf_sha256 IS NOT NULL
        AND pdf_archived_at IS NOT NULL)
  );

-- The key must sit under the certificate's own customer prefix. This is
-- ADR-0002's guarantee carried into the bucket, where there is no RLS to fall
-- back on: a mis-written row cannot name another tenant's object.
ALTER TABLE certificates
  ADD CONSTRAINT certificates_archive_key_is_tenant_scoped
  CHECK (
    pdf_object_key IS NULL
    OR pdf_object_key LIKE customer_id::text || '/certificates/%'
  );

ALTER TABLE certificates
  ADD CONSTRAINT certificates_archive_digest_is_hex
  CHECK (pdf_sha256 IS NULL OR pdf_sha256 ~ '^[0-9a-f]{64}$');

-- "Which certificates for this course are archived, and which are not" — the
-- question an operator preparing for a Kammer query actually asks.
CREATE INDEX certificates_unarchived_idx
  ON certificates (customer_id, issued_at)
  WHERE status <> 'revoked' AND pdf_object_key IS NULL;

-- ---------------------------------------------------------------------------
-- 3. The erasure queue
-- ---------------------------------------------------------------------------
--
-- Deliberately its own table rather than a nullable column on `certificates`:
-- the row survives erasure (it is the evidence a Fortbildung was completed)
-- and the object must not, so the two have different lifetimes. A queue also
-- means a deletion that fails is still owed, which a cleared column would not
-- record.
CREATE TABLE object_erasures (
    id           bigserial PRIMARY KEY,
    customer_id  uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    -- No FK to certificates: the object outlives our reference to it, and that
    -- is the whole reason this row exists.
    object_key   text NOT NULL,
    requested_at timestamptz NOT NULL DEFAULT now(),
    deleted_at   timestamptz,
    attempts     integer NOT NULL DEFAULT 0,
    last_error   text,
    -- Why the object is owed a deletion. Free text written by us, never by a
    -- request, and deliberately not the erasure's stated reason — that names a
    -- person's request and belongs in the erasure audit record, not here.
    reason       text NOT NULL
);

COMMENT ON TABLE object_erasures IS
  'Objects that must be deleted from storage and cannot be deleted by SQL '
  '(P60-01). Written by erase_subject; drained by the API. A row with '
  'deleted_at NULL is an outstanding obligation, not a log entry.';

CREATE INDEX object_erasures_outstanding_idx
  ON object_erasures (requested_at)
  WHERE deleted_at IS NULL;

ALTER TABLE object_erasures ENABLE ROW LEVEL SECURITY;
ALTER TABLE object_erasures FORCE ROW LEVEL SECURITY;

CREATE POLICY object_erasures_tenant_isolation ON object_erasures
    USING (customer_id = NULLIF(current_setting('app.customer_id', true), '')::uuid)
    WITH CHECK (customer_id = NULLIF(current_setting('app.customer_id', true), '')::uuid);

-- `ds_app` reads its own tenant's rows through RLS, for an operator query
-- ("what is still owed"). It writes nothing: the queue is filled by
-- `erase_subject` and drained through the two definer functions below, both
-- owned by `ds_erasure`, so the application role never has to be trusted with
-- either end of an erasure obligation.
GRANT SELECT ON object_erasures TO ds_app;

-- `ds_erasure` is BYPASSRLS (0009) and owns the queue's whole lifecycle:
-- INSERT from `erase_subject`, UPDATE from `claim_object_erasures` and
-- `mark_object_erased`. UPDATE is easy to forget here and fails loudly rather
-- than quietly — "permission denied for table object_erasures" is what the
-- first run of the integration suite said.
GRANT SELECT, INSERT, UPDATE ON object_erasures TO ds_erasure;
GRANT USAGE, SELECT ON SEQUENCE object_erasures_id_seq TO ds_erasure;

-- The same shape as `claim_due_certificate_deliveries`: the sweep is global —
-- an erasure spans customers, so the work queue does too — and the application
-- role cannot select across tenants on its own. A SECURITY DEFINER function is
-- how every other cross-tenant worker in this schema is fed, and doing it the
-- same way here means the isolation argument is the one already made.
CREATE FUNCTION claim_object_erasures(p_limit integer)
RETURNS TABLE (
    id          bigint,
    customer_id uuid,
    object_key  text,
    attempts    integer
)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    UPDATE object_erasures
       SET attempts = attempts + 1
     WHERE object_erasures.id IN (
         SELECT o.id FROM object_erasures o
          WHERE o.deleted_at IS NULL
          ORDER BY o.requested_at
          -- Two workers must not both delete the same object: the second gets
          -- a 404 from the bucket and would record a success it did not
          -- perform.
          FOR UPDATE SKIP LOCKED
          LIMIT p_limit
     )
 RETURNING object_erasures.id, object_erasures.customer_id,
           object_erasures.object_key, object_erasures.attempts;
$$;

ALTER FUNCTION claim_object_erasures(integer) OWNER TO ds_erasure;
REVOKE ALL ON FUNCTION claim_object_erasures(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_object_erasures(integer) TO ds_app;

-- Stamped only after the bucket has confirmed the object is gone. A failure
-- leaves `deleted_at` NULL and the row is claimed again — an obligation that
-- cannot be discharged by being forgotten.
CREATE FUNCTION mark_object_erased(p_id bigint, p_error text)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    UPDATE object_erasures
       SET deleted_at = CASE WHEN p_error IS NULL THEN now() ELSE NULL END,
           last_error = p_error
     WHERE id = p_id;
$$;

ALTER FUNCTION mark_object_erased(bigint, text) OWNER TO ds_erasure;
REVOKE ALL ON FUNCTION mark_object_erased(bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mark_object_erased(bigint, text) TO ds_app;

-- ---------------------------------------------------------------------------
-- 5. erase_subject reaches the bucket
-- ---------------------------------------------------------------------------
--
-- Replaced wholesale rather than patched, because a partially-updated erasure
-- routine is the failure this comment block exists to prevent. Everything
-- below is 0024's body with two additions, each marked CHANGED IN 0041.
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
        updated_at = now()
    WHERE user_id = p_user_id
      AND (attested_name IS NOT NULL OR attested_given_name IS NOT NULL
           OR attested_address IS NOT NULL);
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
