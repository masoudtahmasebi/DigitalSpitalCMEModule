-- Settings an operator changes at runtime, not at deploy time (P180-01).
--
-- ## The request
--
--   > i don't want to have eiv-worker enabled or disable in config.env i want
--   > to be able to sweitch that from the admin panel, and i want to be able to
--   > change the sending to domain […] having this eiv-worker when we have test
--   > env does not make sense.
--
-- It is the right complaint. `EIV_WORKER_ENABLED` and `EIV_BASE_URL` decide
-- **whether statutory Punktemeldungen leave this installation and who
-- receives them**, and both were readable only by editing a file on the host
-- and redeploying. Switching to EIV's test register to try something out meant
-- a deploy; switching back meant another. So in practice nobody switched, which
-- is CLAUDE.md §9.9's corollary — a setting that needs a human to apply it by
-- hand is a setting that stays as it was.
--
-- ## One row, and why it is not per tenant
--
-- There is one EIV worker per installation and one register it talks to. A
-- customer administrator must not be able to point the platform at the live
-- Ärztekammer endpoint: their authority is over their own courses and
-- participants, and a Punktemeldung filed in error is a statutory report
-- against a real physician that can only be withdrawn, never unsaid.
--
-- So: no `customer_id`, no RLS policy, and the routes that read and write it
-- are `super_admin` only. `singleton` is the constraint that keeps it one row —
-- a second row would be a second answer to "is the worker on".
--
-- ## A tier, never a URL
--
-- `eiv_endpoint` is one of three words and the platform owns the address each
-- resolves to (`eivEndpointTier` / `eivEndpointUrl` in `@ds/eiv-client`). A URL
-- field in the console would be a text box in which somebody can type the
-- production register — or an attacker's host, if the console is ever reached
-- by somebody it should not be. The dangerous choice is a closed enumeration,
-- for the same reason P157-01 made the diagnostic's environment one.
--
-- ## The consent that replaces EIV_ALLOW_LIVE
--
-- `live` additionally requires `eiv_live_confirmed_at`, and the application
-- refuses to arm the worker against the live register without it. That is
-- `EIV_ALLOW_LIVE`'s job, moved — and improved in one way: the old flag was a
-- string in a file with nobody's name on it, and this records **who** consented
-- and **when**. A statutory report nobody admits to authorising is the kind of
-- thing an audit asks about.
--
-- Any change of endpoint clears it. Consent is to one register, not to the idea
-- of registers.

BEGIN;

CREATE TABLE platform_settings (
    singleton                boolean     PRIMARY KEY DEFAULT true,
    -- Whether the worker files Punktemeldungen at all.
    --
    -- Defaults to **false**, and that is deliberate on a table created by a
    -- migration: an installation that gains this table must not start
    -- submitting because a column defaulted the friendly way.
    --
    -- The cost is stated rather than hidden: an existing host that had
    -- `EIV_WORKER_ENABLED=yes` **stops filing** until somebody arms it in the
    -- console. That is not carried forward automatically, and the reason is
    -- that a migration cannot read `config.env` — anything that appeared to
    -- carry it would be guessing. Instead `deploy.sh` refuses to start while
    -- the old variables are still in the file, with a message naming the
    -- switch to set, so the change is impossible to miss rather than silent.
    eiv_worker_enabled       boolean     NOT NULL DEFAULT false,
    -- `mock`, `test` or `live`. Never a URL — see the header.
    eiv_endpoint             text        NOT NULL DEFAULT 'mock',
    -- Explicit consent to file against the live register, with a name on it.
    --
    -- `admin_users`, not `users`, and the distinction is ADR-0012's: a console
    -- operator is a staff account on this platform, not a learner in a
    -- customer's Keycloak. `staffProfile.id` — the only id this route ever sees
    -- — is an `admin_users` id, and pointing these at `users` made every write
    -- fail the foreign key. `platform_smtp` avoided that by having no reference
    -- at all; naming the right table is the stronger answer.
    --
    -- `ON DELETE SET NULL` rather than RESTRICT: an operator who leaves the
    -- organisation must be removable, and losing the name on a consent is a
    -- smaller harm than a platform that cannot deprovision anybody. The audit
    -- row in `audit_log` keeps the fuller record either way.
    eiv_live_confirmed_at    timestamptz,
    eiv_live_confirmed_by    uuid        REFERENCES admin_users(id) ON DELETE SET NULL,
    updated_at               timestamptz NOT NULL DEFAULT now(),
    updated_by               uuid        REFERENCES admin_users(id) ON DELETE SET NULL,

    CONSTRAINT platform_settings_singleton CHECK (singleton),
    CONSTRAINT platform_settings_endpoint_known
        CHECK (eiv_endpoint IN ('mock', 'test', 'live')),
    -- Consent is a pair or it is nothing: a timestamp with nobody attached
    -- would answer "when" and not "who", and "who" is the half an audit wants.
    CONSTRAINT platform_settings_live_consent_is_complete
        CHECK (
            (eiv_live_confirmed_at IS NULL AND eiv_live_confirmed_by IS NULL)
            OR (eiv_live_confirmed_at IS NOT NULL AND eiv_live_confirmed_by IS NOT NULL)
        ),
    -- The guarantee, in the database rather than only in the service: the
    -- worker cannot be armed against the live register without consent on
    -- record. A migration, a psql session and a future code path all meet it.
    CONSTRAINT platform_settings_live_needs_consent
        CHECK (
            NOT (eiv_worker_enabled AND eiv_endpoint = 'live')
            OR eiv_live_confirmed_at IS NOT NULL
        )
);

COMMENT ON TABLE platform_settings IS
    'Installation-wide settings an operator changes at runtime (P180-01). One '
    'row, no tenant scope, super_admin only: these decide whether statutory '
    'Punktemeldungen leave this installation and which register receives them.';

-- The row exists from the start, so every reader is a plain SELECT rather than
-- a SELECT plus a "what if there is no row" branch. A missing row and a row
-- with the worker off are the same intent, and one of them is a code path
-- nobody tests.
INSERT INTO platform_settings (singleton) VALUES (true);

/*
 * `ds_app` may read and write it; it may not add rows.
 *
 * No INSERT and no DELETE grant. The row is created here and there is exactly
 * one for the life of the installation, so an application bug cannot produce a
 * second answer to "is the worker on" — which is the failure this table's
 * `singleton` constraint exists to make impossible and this grant makes
 * unreachable.
 */
GRANT SELECT, UPDATE ON platform_settings TO ds_app;

COMMIT;
