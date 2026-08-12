-- A published CME course is never incomplete (P62-02).
--
-- ## The failure
--
-- Nothing refused a course that was `published`, awarded CME points, and had no
-- VNR, no VNR password, no accreditation body, no organiser, no stamp and no
-- signature. A physician could enrol, watch, pass, evaluate and supply their
-- EFN, and only at the end would anything discover that no certificate can be
-- rendered and no Punktemeldung can be sent.
--
-- Every one of those fields is read at the *end*, which is exactly why nothing
-- noticed at the beginning. On this database at head 5aabd3b, `ds-cme-demo`
-- was published, awarded three points, and its Meldung failed permanently with
-- `missing_vnr_password`.
--
-- ## Why a CHECK and not a publish-time guard
--
-- A publish-time guard was the obvious proposal and it is the wrong layer, for
-- two reasons that are both visible on this database:
--
-- 1. **The offending rows were never published by anyone.** The seed inserted
--    them with `status = 'published'` directly. A service-layer guard never saw
--    them — CLAUDE.md §9.9's corollary, one code path deep.
-- 2. **Publishing is not the only transition that can break it.** Clearing the
--    VNR on a live course is an UPDATE, not a publish, and a guard that ran at
--    the transition has nothing to say about it.
--
-- So the invariant is not "you may not publish an incomplete CME course". It is
-- **"a published CME course is never incomplete"** — a property of the row,
-- true at every instant, which is what a CHECK is.
--
-- The application still refuses first, in `publishBlockers`, because a
-- constraint violation is a 500 and a constraint name, and the person clicking
-- Veröffentlichen needs the list of fields. Same division as ADR-0002:
-- application code explains, the schema guarantees.
--
-- ## What is deliberately not required
--
-- `fortbildungsnummer` — nothing reads it. It renders one line on the
-- Zertifizierung tab and is absent from both the certificate and the Meldung,
-- which use the VNR. Requiring it would be inventing a rule; instead it is
-- docs/show-stoppers.md S24, owned by MEDICE/ÄKWL.
--
-- The media sources — they live on `contents`, which a row-level CHECK on
-- `courses` cannot see. That is P62-03.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Demote what already violates it
-- ---------------------------------------------------------------------------
--
-- Not "fail", which would make this migration unrunnable on every existing
-- installation; not "grandfather", which would leave exactly the rows this
-- exists to catch. A published course that cannot produce a certificate is a
-- course that should not be published, and demoting it is the truthful
-- outcome — an operator sees a draft, and `publishBlockers` tells them why the
-- moment they try to publish it again.
--
-- RLS off for the UPDATE, exactly as 0038 had to: `courses` is under FORCE ROW
-- LEVEL SECURITY and `ds_migrator` is not BYPASSRLS, so a migration that simply
-- ran the UPDATE would match **zero rows** and report success. That failure is
-- silent and was found the hard way in P53-01.
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
       AND (
            vnr IS NULL OR btrim(vnr) = ''
         OR vnr_password_enc IS NULL
         OR cme_category IS NULL OR btrim(cme_category) = ''
         OR accreditation_body IS NULL OR btrim(accreditation_body) = ''
         OR organizer IS NULL OR btrim(organizer) = ''
         OR event_location IS NULL OR btrim(event_location) = ''
         OR scientific_lead_name IS NULL OR btrim(scientific_lead_name) = ''
         OR certificate_issue_place IS NULL OR btrim(certificate_issue_place) = ''
         OR stamp_image IS NULL
         OR signature_image IS NULL
       );
    GET DIAGNOSTICS v_demoted = ROW_COUNT;

    -- A NOTICE would be the obvious thing and would be invisible: `pg` only
    -- surfaces notices to a listener the migrator does not attach, so the
    -- count would go to nobody. A course leaving the catalogue is exactly the
    -- kind of event that must survive the deploy that caused it, so it goes to
    -- the append-only log instead — `customer_id NULL` because this is a
    -- migration acting across every tenant, the same shape `erase_subject`
    -- uses.
    RAISE NOTICE 'P62-02: demoted % published CME course(s) to draft', v_demoted;

    IF v_demoted > 0 THEN
        INSERT INTO audit_log (customer_id, actor_id, actor_identity, action, subject, detail)
        VALUES (
            NULL, NULL, 'system', 'admin.course.demoted_by_migration', '0042',
            jsonb_build_object(
                'courses', v_demoted,
                'reason', 'published and awarding CME points with fields the '
                          'certificate or the Punktemeldung reads unset'
            )
        );
    END IF;
END
$$;

ALTER TABLE courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE courses FORCE ROW LEVEL SECURITY;

-- The assertion 0038 taught: re-enabling is one line and forgetting it is one
-- line, and the consequence is every tenant reading every other tenant's
-- courses. Refuse to commit rather than trust that the two statements above ran.
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
-- 2. The invariant
-- ---------------------------------------------------------------------------
--
-- Written as "not (published and awards points and something missing)" rather
-- than as an implication, because that is the form Postgres evaluates without
-- surprises around NULL: every disjunct below is a definite true or false.
ALTER TABLE courses
  ADD CONSTRAINT courses_published_cme_is_complete
  CHECK (
    status <> 'published'
    OR cme_points IS NULL
    OR cme_points = 0
    OR (
           vnr IS NOT NULL AND btrim(vnr) <> ''
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
  'Teilnahmebescheinigung and the Punktemeldung read (P62-02). Draft courses '
  'and point-free courses are exempt: a draft is half-authored by definition, '
  'and a course awarding nothing has no certificate to be incomplete for.';

COMMIT;
