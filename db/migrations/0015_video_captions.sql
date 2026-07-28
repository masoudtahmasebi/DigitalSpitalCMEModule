-- Best-practices audit finding: video had no caption track.
--
-- WCAG 2.2 success criterion 1.2.2 (Captions, Prerecorded) is **Level A** — the
-- floor, not an enhancement — and EN 301 549 makes it the reference standard for
-- accessibility in Germany. A CME course is professional education a physician
-- is required to complete; a deaf or hard-of-hearing physician who cannot follow
-- the video cannot earn the points, and the watch gate will record that they
-- did not.
--
-- The lint rule flagged this from the beginning. Its `eslint-disable`-shaped
-- justification was that the schema had no caption field "in this budget",
-- which was true when the admin console could not author content at all and
-- every course was seeded by hand. With authoring built (P9-04) an author can
-- supply a WebVTT URL, so the reason has expired and the warning is now
-- actionable.
--
-- Nullable, and no CHECK forcing it: a course with no captions is worse than one
-- with them but is not *invalid*, and refusing to store a video until somebody
-- produced a VTT file would block content that is legitimately captionless
-- (a slide-only recording with no speech). The admin console says what is owed;
-- it does not pretend the database can decide it.

BEGIN;

ALTER TABLE contents
    -- A WebVTT file. Same origin rules as `video_url`: it is fetched by the
    -- learner's browser, and a cross-origin track needs CORS on the far end.
    ADD COLUMN captions_url text;

COMMENT ON COLUMN contents.captions_url IS
    'WebVTT captions for a video (WCAG 1.2.2 Level A). NULL means none authored.';

COMMIT;
