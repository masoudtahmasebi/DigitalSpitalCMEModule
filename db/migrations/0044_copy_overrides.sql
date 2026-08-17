-- The customer's own words for the learner's screens (P83-01).
--
-- ## Why a column beside `branding`
--
-- `projects.branding` already carries the customer's colours, logo, font and
-- catalogue title. The wording is the same kind of fact about the same tenant,
-- wanted at the same moment — the widget's mount — and a table of its own would
-- buy a join for a single blob that is never queried on its own.
--
-- It is served by its own endpoint (`GET /copy`) rather than folded into
-- `GET /branding`, which is a different question: `Branding` is a typed object
-- whose fields become CSS variables, and merging an open map of arbitrary keys
-- into it would give one response two grammars and one parser two jobs.
--
-- Separate from `branding` rather than folded into it because the two have
-- different shapes and different validation. `branding` is a fixed set of named
-- fields with a grammar each — a URL must be `https://`, a colour must parse.
-- This is an open map whose keys are decided by the widget's own locale table,
-- and whose values are all "some text". One blob with two grammars would make
-- `parseBranding` responsible for a key space it knows nothing about.
--
-- ## What is in it
--
-- Dotted key to replacement string — `{"player.back": "Zurück zum Kurs"}`. The
-- keys are exactly `COPY_KEYS` in `@ds/copy`, derived from the defaults table,
-- so a key here that is not there is a setting for a screen that no longer
-- exists. The API refuses to store one rather than accumulating orphans nobody
-- can see or delete.
--
-- ## Why the default is an empty object and not NULL
--
-- Every read applies it. `{}` means "the platform's own words", which is a real
-- and common answer; NULL would mean the same thing and oblige every reader to
-- say so again, which is how one of them eventually forgets.
--
-- ## Not personal data
--
-- Interface wording chosen by the customer's staff. No learner, no physician,
-- no EFN — nothing here reaches `docs/gdpr.md` §2.

BEGIN;

ALTER TABLE projects
    ADD COLUMN copy_overrides jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN projects.copy_overrides IS
    'Dotted locale key to the customer''s replacement text (P83-01). '
    'Keys are COPY_KEYS from @ds/copy; the API refuses any other.';

COMMIT;
