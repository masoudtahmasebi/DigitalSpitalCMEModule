-- Staff accounts, local to the platform (P12-01), implementing ADR-0012.
--
-- The admin console authenticated against MEDICE's Keycloak. That made this
-- platform's operations tooling depend on one customer's identity provider:
-- their outage was our outage, their realm administrators could mint our super
-- administrators, and a super admin — who by definition spans customers — had
-- to live in a realm belonging to one of them.
--
-- So staff move to their own store. Learners do not: their identity stays with
-- the customer's IdP, which is what keeps this platform out of scope as an
-- identity provider for medical professionals (ADR-0004).
--
-- ## Why these tables have no customer_id, and therefore no RLS
--
-- `admin_users` is the *authentication* store. RLS keys on `app.customer_id`,
-- and `app.customer_id` is derived from a staff member's grants — which are
-- read from these tables. A policy here would be circular in exactly the way
-- `users`/`user_roles` already are (ADR-0002 §6), and for the same reason.
--
-- The scoping is by identity instead, and structurally: a session is looked up
-- by its own hash and yields exactly one account. There is no query in the API
-- that takes an account id from a caller.
--
-- `admin_user_roles` *does* carry `customer_id`, but as a foreign key that says
-- which tenant the grant reaches — not as an RLS discriminator. It is the input
-- to `resolveTenantContext`, not something filtered by its output.

BEGIN;

-- ---------------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------------

CREATE TABLE admin_users (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Case-insensitive, because nobody remembers how they capitalised their
    -- own address, and two accounts differing only in case is an
    -- account-takeover vector rather than a feature. `citext` is not enabled
    -- in this database, so the uniqueness is on `lower(email)` below.
    email              text NOT NULL,
    display_name       text NOT NULL,

    -- Argon2id, encoded in PHC string format ("$argon2id$v=19$m=...$...$..."),
    -- which carries its own parameters — so raising the cost later does not
    -- invalidate existing hashes, and a hash written by an older deployment
    -- still verifies.
    --
    -- NULL for an invited account that has not set a password yet. Such an
    -- account cannot sign in: there is nothing to verify against, and the API
    -- must never treat "no hash" as "any password".
    password_hash      text,

    -- Base32 TOTP secret, encrypted at rest with the application KMS key like
    -- every other stored secret (CLAUDE.md §4 invariant 7). NULL until the
    -- account enrols a second factor.
    totp_secret_enc    bytea,
    totp_enrolled_at   timestamptz,

    -- Lockout state. Read by `lockoutStatus` in @ds/domain, which owns the
    -- rule; these columns only hold the counters it is given.
    failed_attempts    integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
    last_failure_at    timestamptz,

    -- Disabling an account is not deletion: the audit trail has to keep saying
    -- who published a course. A disabled account's sessions are revoked by the
    -- same statement that disables it.
    disabled_at        timestamptz,

    last_login_at      timestamptz,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT admin_users_email_shape CHECK (position('@' in email) > 1)
);

CREATE UNIQUE INDEX admin_users_email_key ON admin_users (lower(email));

COMMENT ON COLUMN admin_users.password_hash IS
    'Argon2id PHC string. NULL means invited-but-not-yet-set; such an account cannot authenticate.';
COMMENT ON COLUMN admin_users.totp_secret_enc IS
    'Encrypted TOTP secret. Never returned by any endpoint — write-only, like every other stored secret.';

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

-- Deliberately a separate table from `user_roles` rather than a nullable
-- column added to it. The two are different populations with different
-- lifecycles — a learner grant is created by a first login against a customer's
-- IdP, a staff grant by an invitation from another administrator — and folding
-- them together would mean every query against either has to remember which
-- kind it is looking at.
CREATE TABLE admin_user_roles (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_user_id  uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
    role           text NOT NULL CHECK (role IN ('super_admin', 'customer_admin', 'department_admin')),

    -- NULL only for super_admin, whose grant is global. The check below is what
    -- stops a customer_admin row with no customer — which would otherwise
    -- compare equal to a super admin's global grant in a careless query.
    customer_id    uuid REFERENCES customers(id) ON DELETE CASCADE,
    department_id  uuid REFERENCES departments(id) ON DELETE CASCADE,

    created_at     timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT admin_user_roles_scope_matches_role CHECK (
        (role = 'super_admin'      AND customer_id IS NULL AND department_id IS NULL) OR
        (role = 'customer_admin'   AND customer_id IS NOT NULL AND department_id IS NULL) OR
        (role = 'department_admin' AND customer_id IS NOT NULL AND department_id IS NOT NULL)
    ),

    UNIQUE (admin_user_id, role, customer_id, department_id)
);

CREATE INDEX admin_user_roles_user_idx ON admin_user_roles (admin_user_id);

-- ---------------------------------------------------------------------------
-- Sessions
-- ---------------------------------------------------------------------------

-- Opaque server-side rows rather than JWTs, so revocation is immediate
-- (ADR-0012). A signed token cannot be withdrawn; a row can be deleted.
CREATE TABLE admin_sessions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_user_id   uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,

    -- The SHA-256 of the cookie value, never the value itself. A database dump
    -- — or a read-only replica, or a backup on a laptop — must not be a set of
    -- live session cookies. Same reasoning as a password hash, and the same
    -- consequence: the server can verify a presented value and cannot mint one.
    token_hash      bytea NOT NULL,

    -- The double-submit CSRF token for this session. Readable by the console
    -- (it is returned once at login), unlike the session id, which is httpOnly.
    csrf_token_hash bytea NOT NULL,

    created_at      timestamptz NOT NULL DEFAULT now(),
    last_seen_at    timestamptz NOT NULL DEFAULT now(),
    revoked_at      timestamptz,

    -- Kept for the security log: "sign out everywhere" is only meaningful if
    -- somebody can see where "everywhere" was. Truncated by the retention job
    -- with the rest of the audit data (docs/gdpr.md §4).
    user_agent      text,
    ip_hash         bytea
);

CREATE UNIQUE INDEX admin_sessions_token_key ON admin_sessions (token_hash);
CREATE INDEX admin_sessions_user_idx ON admin_sessions (admin_user_id)
    WHERE revoked_at IS NULL;

COMMENT ON COLUMN admin_sessions.token_hash IS
    'SHA-256 of the session cookie. The cookie value itself is never stored.';
COMMENT ON COLUMN admin_sessions.ip_hash IS
    'Hashed, not stored plain: an IP address is personal data (docs/gdpr.md §2).';

-- ---------------------------------------------------------------------------
-- Invitations and password resets
-- ---------------------------------------------------------------------------

-- One table for both, because they are the same object: a single-use,
-- time-limited token that lets somebody set a password. Splitting them would
-- duplicate the expiry, the single-use rule and the constant-time lookup, and
-- the two would drift on exactly the security properties that matter.
--
-- The lifetimes differ and that difference lives in @ds/domain
-- (`INVITE_VALID_DAYS` vs `RESET_VALID_MINUTES`), keyed off `kind`.
CREATE TABLE admin_credential_tokens (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_user_id  uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
    kind           text NOT NULL CHECK (kind IN ('invite', 'reset')),

    token_hash     bytea NOT NULL,

    -- Who invited whom. Null for a self-service reset, which nobody issued.
    issued_by      uuid REFERENCES admin_users(id) ON DELETE SET NULL,

    created_at     timestamptz NOT NULL DEFAULT now(),
    accepted_at    timestamptz,
    revoked_at     timestamptz
);

CREATE UNIQUE INDEX admin_credential_tokens_token_key ON admin_credential_tokens (token_hash);
CREATE INDEX admin_credential_tokens_user_idx ON admin_credential_tokens (admin_user_id)
    WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- Audit
-- ---------------------------------------------------------------------------

-- Append-only, like the EIV log (CLAUDE.md §4 invariant 8) and for the same
-- reason: the interesting events are the ones somebody would want to erase.
-- A sign-in from an unexpected place, a role widened, an account disabled.
CREATE TABLE admin_audit_log (
    id             bigserial PRIMARY KEY,
    at             timestamptz NOT NULL DEFAULT now(),

    -- Nullable because a failed sign-in has no established actor, and that is
    -- precisely the event worth recording.
    actor_id       uuid REFERENCES admin_users(id) ON DELETE SET NULL,
    actor_email    text,

    action         text NOT NULL,
    subject_id     uuid,
    customer_id    uuid REFERENCES customers(id) ON DELETE SET NULL,

    -- Never a password, a token, a TOTP secret or an EFN. Enforced by review,
    -- not by the column — which is why it is named for what it is allowed to
    -- hold rather than being a free-form `data` blob.
    detail         jsonb NOT NULL DEFAULT '{}'::jsonb,

    ip_hash        bytea,
    user_agent     text
);

CREATE INDEX admin_audit_log_at_idx ON admin_audit_log (at DESC);
CREATE INDEX admin_audit_log_actor_idx ON admin_audit_log (actor_id, at DESC);

-- ---------------------------------------------------------------------------
-- Append-only, enforced — and by a different mechanism from `audit_log`
-- ---------------------------------------------------------------------------
--
-- `audit_log` (migration 0001) uses rewrite rules:
--
--     CREATE RULE audit_log_no_update AS ON UPDATE TO audit_log DO INSTEAD NOTHING;
--
-- That works, but it works *silently*: an UPDATE reports success and changes
-- nothing. For a table whose whole purpose is to be trustworthy after the
-- fact, a caller that believes it wrote something and did not is the worse
-- failure — and a `REVOKE` makes the same attempt an error the caller cannot
-- miss.
--
-- The `REVOKE` has to name `ds_app` explicitly. `ALTER DEFAULT PRIVILEGES FOR
-- ROLE ds_migrator` (infra/postgres/init-roles.sql) grants `ds_app` everything
-- on tables this role creates, and that is a grant *to ds_app*, not one via
-- PUBLIC — so revoking from PUBLIC leaves it untouched. The first version of
-- this migration did exactly that, and the assertion at the end of the file is
-- what caught it.

GRANT SELECT, INSERT ON admin_audit_log TO ds_app;
GRANT USAGE ON SEQUENCE admin_audit_log_id_seq TO ds_app;
REVOKE UPDATE, DELETE, TRUNCATE ON admin_audit_log FROM ds_app;

-- Refuse to commit a migration that left the audit log mutable by the
-- application. Cheap, and the failure it guards against is one nothing else
-- would report until somebody needed the log and found it edited.
DO $$
BEGIN
    IF has_table_privilege('ds_app', 'admin_audit_log', 'UPDATE')
       OR has_table_privilege('ds_app', 'admin_audit_log', 'DELETE') THEN
        RAISE EXCEPTION 'admin_audit_log is not append-only for ds_app — refusing to commit';
    END IF;
END $$;

COMMIT;
