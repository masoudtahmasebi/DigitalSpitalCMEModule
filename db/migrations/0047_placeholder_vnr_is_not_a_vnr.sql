-- Nineteen zeros is not a Veranstaltungsnummer (P117-01).
--
-- ## The report
--
-- "i just finished a course, and i was checking it, so i gave my efn as
-- 123456789012345 and as it seems the course was done, but the vnr is not
-- printed, and there is nothing in the https://punktemeldung.eiv-fobi.de/ and
-- there are also no errors anywhere."
--
-- The VNR *was* printed. It was `0000000000000000000` — the string
-- `packages/seed` writes into a course it has no accredited number for, so the
-- row is structurally complete and the platform is testable before the
-- Anerkennungsbescheid arrives.
--
-- ## Why every gate let it through
--
-- Because every gate asked whether the VNR was **missing**, and it is not:
--
--   * `publishBlockers`   — `isBlank(course.vnr)`
--   * `missingCertificateFields` — `isBlank(input.vnr)`
--   * `courses_published_cme_is_complete` (0042) — `vnr IS NOT NULL AND
--     btrim(vnr) <> ''`
--
-- Nineteen zeros is not NULL and not blank. It satisfies all three. So the
-- course published, a physician worked through it, and the platform issued a
-- Teilnahmebescheinigung naming a Veranstaltung no Ärztekammer register holds —
-- an invalid document, in a named physician's hands, with nothing anywhere
-- objecting. Nothing reached EIV-FOBI for the same reason: there is no such
-- event to report a participation against.
--
-- This is CLAUDE.md §9.1 in a check constraint. The gate could not have gone
-- red for the one value the platform itself writes most often.
--
-- ## Why this refuses one string and not a format
--
-- S23 is open: the VNR's check digit is documented in secondary sources and
-- unconfirmed by ÄKWL. A format rule derived from a sample of one would refuse
-- a legitimate number from another Kammer at the exact moment an operator is
-- configuring a course they cannot report without — the §9.2 failure, inverted.
--
-- What this knows is narrower and certain: **this exact string is ours.** No
-- Ärztekammer issued it, because we wrote it. The literal lives in
-- `@ds/domain` (`PLACEHOLDER_VNR`) and the seed imports it from there, so this
-- constraint, the two domain gates and the seed are four readings of one value
-- rather than four copies of a literal.
--
-- ## What this does not undo
--
-- Certificates already issued against a placeholder VNR. They are rows in
-- `certificates` and PDFs in the archive, and deleting them silently would
-- destroy the evidence that they were issued. `docs/backlog/P117.md` names the
-- operator step: re-issue after the real VNR is set, and treat any already in a
-- physician's hands as withdrawn.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Nothing published may carry it
-- ---------------------------------------------------------------------------
--
-- Same RLS dance as 0042, and for the same reason: `courses` is under FORCE ROW
-- LEVEL SECURITY, `ds_migrator` is not BYPASSRLS, and an UPDATE run without
-- this would match **zero rows** and report success (§9.6).
ALTER TABLE courses NO FORCE ROW LEVEL SECURITY;
ALTER TABLE courses DISABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    v_demoted integer;
BEGIN
    UPDATE courses
       SET status = 'draft', updated_at = now()
     WHERE status = 'published'
       AND cme_points IS NOT NULL AND cme_points > 0
       AND btrim(vnr) = '0000000000000000000';
    GET DIAGNOSTICS v_demoted = ROW_COUNT;

    RAISE NOTICE 'P117-01: demoted % published course(s) carrying the placeholder VNR', v_demoted;

    -- To the append-only log, not a NOTICE: `pg` surfaces notices to a listener
    -- the migrator does not attach, and a course leaving the catalogue must
    -- survive the deploy that caused it. `customer_id NULL` because this acts
    -- across every tenant, the shape 0042 and `erase_subject` use.
    --
    -- The detail names the field, never the value — it is not a secret, but
    -- §9.5 is a habit and an audit row is read by people who are not the
    -- tenant.
    IF v_demoted > 0 THEN
        INSERT INTO audit_log (customer_id, actor_id, actor_identity, action, subject, detail)
        VALUES (
            NULL, NULL, 'system', 'admin.course.demoted_by_migration', '0047',
            jsonb_build_object(
                'courses', v_demoted,
                'reason', 'published and awarding CME points with the seed''s '
                          'placeholder VNR, which no Ärztekammer issued'
            )
        );
    END IF;
END
$$;

ALTER TABLE courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE courses FORCE ROW LEVEL SECURITY;

-- 0038's lesson: re-enabling is one line, forgetting it is one line, and the
-- consequence is every tenant reading every other tenant's courses.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_class
         WHERE relname = 'courses' AND relrowsecurity AND relforcerowsecurity
    ) THEN
        RAISE EXCEPTION 'courses left without FORCE ROW LEVEL SECURITY — refusing to commit';
    END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. The invariant, extended
-- ---------------------------------------------------------------------------
--
-- Replacing 0042's constraint rather than adding a second, so there is one
-- place that answers "may this course be published?" — the §4 invariant 6
-- argument, at the schema level: two constraints on one question eventually
-- disagree about which fields are required.
ALTER TABLE courses
  DROP CONSTRAINT courses_published_cme_is_complete;

ALTER TABLE courses
  ADD CONSTRAINT courses_published_cme_is_complete
  CHECK (
    status <> 'published'
    OR cme_points IS NULL
    OR cme_points = 0
    OR (
           vnr IS NOT NULL AND btrim(vnr) <> ''
       AND btrim(vnr) <> '0000000000000000000'
       AND vnr_password_enc IS NOT NULL
       AND cme_category IS NOT NULL AND btrim(cme_category) <> ''
       AND accreditation_body IS NOT NULL AND btrim(accreditation_body) <> ''
       AND organizer IS NOT NULL AND btrim(organizer) <> ''
       AND event_location IS NOT NULL AND btrim(event_location) <> ''
       AND scientific_lead_name IS NOT NULL AND btrim(scientific_lead_name) <> ''
       AND certificate_issue_place IS NOT NULL AND btrim(certificate_issue_place) <> ''
       AND stamp_image IS NOT NULL
       AND signature_image IS NOT NULL
    )
  );

COMMENT ON CONSTRAINT courses_published_cme_is_complete ON courses IS
  'A published course awarding CME points holds every field the '
  'Teilnahmebescheinigung and the Punktemeldung read (P62-02), and its VNR is '
  'not the seed placeholder 0000000000000000000, which is present, is not '
  'blank, and is not a number any Ärztekammer issued (P117-01).';

COMMIT;
