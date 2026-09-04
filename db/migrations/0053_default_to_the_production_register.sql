-- A new installation points at the production register (P188-01).
--
-- ## The instruction
--
--   > by default for new customers everything should be set to prod, for
--   > testing now i will set it to test.
--
-- Migration 0051 defaulted `eiv_endpoint` to `mock`, on the reasoning that an
-- installation gaining the table must not start submitting because a column
-- defaulted the friendly way. That reasoning was about **submitting**, and it
-- is answered by a different column: nothing leaves this installation unless
-- `eiv_worker_enabled` is true, and the database refuses that combination with
-- `live` unless a named person has consented.
--
-- So the endpoint could be `mock` by default only by making every new
-- installation start out pointed at a fiction — which is the state somebody has
-- to notice and change, and CLAUDE.md §9.9's corollary is that a setting a
-- human has to apply by hand is a setting that stays as it was. A platform
-- whose default is "not the real register" ships that mistake to every customer
-- it ever has.
--
-- ## What this does and does not arm
--
-- Three things must be true before a Punktemeldung reaches the Ärztekammer:
--
--   1. `eiv_endpoint = 'live'`          — what this migration changes
--   2. `eiv_worker_enabled`             — still defaults to **false**
--   3. `eiv_live_confirmed_at`          — a named person, in the console
--
-- `platform_settings_live_needs_consent` makes (1) + (2) without (3)
-- unrepresentable, so `eiv_worker_enabled DEFAULT true` alongside this would
-- not have been a policy decision — it would not insert. The floor stays where
-- CLAUDE.md §3 puts it: a statutory report that cannot be unfiled needs a human
-- to say so.
--
-- A new installation is therefore **pointed at production and not yet armed**,
-- which is what "set to prod" can mean without deleting the consent gate.
--
-- ## Why the existing row moves, and only when nobody has chosen
--
-- A column default reaches new rows, and `platform_settings` has exactly one
-- row, inserted by 0051. On a fresh database 0051 runs first and inserts
-- `mock`, so changing the default alone would leave every installation —
-- including brand new ones — on the old value. The default would be a claim
-- with no effect, which is worse than not changing it.
--
-- So the row is updated too, guarded on `updated_by IS NULL`: nobody has ever
-- saved this screen. An installation where an operator *has* chosen keeps their
-- choice, because a migration overruling a decision somebody made in the
-- console is the seed-overwrite defect `check:seed-overwrites` exists to catch
-- (§9.10b), one layer down.
--
-- `eiv_live_confirmed_at IS NULL` is belt and braces: consent is cleared by any
-- change of endpoint, so a row carrying one has certainly been touched — but
-- the guard is cheap and the thing it protects is irreversible.

BEGIN;

ALTER TABLE platform_settings
    ALTER COLUMN eiv_endpoint SET DEFAULT 'live';

UPDATE platform_settings
   SET eiv_endpoint = 'live'
 WHERE singleton
   AND updated_by IS NULL
   AND eiv_live_confirmed_at IS NULL
   AND NOT eiv_worker_enabled;

COMMENT ON COLUMN platform_settings.eiv_endpoint IS
    'Which register receives Punktemeldungen: mock, test or live. Defaults to '
    'live (P188-01) — the real one, because a default of "a fiction" is a '
    'setting somebody has to notice. It arms nothing on its own: '
    'eiv_worker_enabled still defaults to false and live additionally requires '
    'eiv_live_confirmed_at, which the CHECK below enforces.';

COMMIT;
