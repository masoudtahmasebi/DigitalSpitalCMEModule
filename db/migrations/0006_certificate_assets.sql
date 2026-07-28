-- P8: the Teilnahmebescheinigung's signing assets, per the Anerkennungsbescheid.
--
--   "Die Teilnahmebescheinigungen sind mit dem Stempel der Wissenschaftlichen
--    Leitung zu versehen und von diesem zu unterzeichnen."
--
-- So a certificate needs three things beyond the participation data we already
-- hold: the name of the Wissenschaftliche Leitung, their stamp, and their
-- signature. All three belong to the **course**, not to the platform — a
-- different course has a different scientific lead — and are supplied by
-- whoever creates the course.
--
-- ## Bytes, not URLs
--
-- `hero_image_url` is a URL because a browser fetches it. These are different:
-- the server embeds them into a PDF it generates. A URL would put an outbound
-- HTTP call on the certificate path, so a CDN blip would become a learner
-- unable to download a certificate they have earned. The images are a few
-- kilobytes; storing them inline removes the failure mode entirely.
--
-- Bounded at 512 KB each. A stamp is small, and an unbounded bytea column
-- reachable from an upload endpoint is a denial-of-service surface.
--
-- ## Why nullable
--
-- A course without these cannot produce a valid certificate — but it can still
-- teach, and a learner can still complete it and have their points reported to
-- the EIV. Making them NOT NULL would mean no course could be created before
-- its stamp existed, which inverts the authoring order. The certificate
-- endpoint reports precisely which asset is missing instead.

BEGIN;

ALTER TABLE courses
    ADD COLUMN scientific_lead_name text,
    ADD COLUMN scientific_lead_title text,
    ADD COLUMN stamp_image bytea,
    ADD COLUMN stamp_image_mime text,
    ADD COLUMN signature_image bytea,
    ADD COLUMN signature_image_mime text,
    -- Where the certificate is signed ("Ort" on the signature line). Distinct
    -- from event_location, which for an on-demand course is "online".
    ADD COLUMN certificate_issue_place text;

ALTER TABLE courses
    ADD CONSTRAINT stamp_image_bounded
        CHECK (stamp_image IS NULL OR octet_length(stamp_image) <= 524288),
    ADD CONSTRAINT signature_image_bounded
        CHECK (signature_image IS NULL OR octet_length(signature_image) <= 524288),
    -- PNG and JPEG only: both are safe to embed in a PDF. SVG is deliberately
    -- excluded — it is executable markup, and this asset is uploaded by a
    -- customer admin and rendered by us.
    ADD CONSTRAINT stamp_image_mime_allowed
        CHECK (stamp_image_mime IS NULL OR stamp_image_mime IN ('image/png', 'image/jpeg')),
    ADD CONSTRAINT signature_image_mime_allowed
        CHECK (signature_image_mime IS NULL OR signature_image_mime IN ('image/png', 'image/jpeg'));

-- No index needed on certificates(enrolment_id): 0001 already declares it
-- UNIQUE, which is what the certificate endpoint looks up by and what makes
-- the issue-once upsert possible.

COMMIT;
