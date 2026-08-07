-- Participants who sign in here rather than at a customer's Keycloak (P25-02).
--
-- ## Why this exists
--
-- Every learner-facing route requires an authenticated participant, and until
-- now the only way to become one was a token from the customer's own Keycloak
-- realm. That is right for MEDICE, whose physicians already have accounts —
-- and it made `fortbildung.digitalspital.com/medice` impossible to look at:
-- the catalogue is behind the guard, so an empty page was the *only* possible
-- result, with nothing to say why.
--
-- It is also a real gap rather than a testing convenience. A customer without
-- an identity provider cannot use this platform at all today, and "you must
-- run a Keycloak realm" is not a sentence anybody wants in a sales
-- conversation. `user_identities.provider` has permitted `'local'` since
-- migration 0025; this is the rest of it.
--
-- ## The shape, and why it mirrors the staff plane
--
-- ADR-0012 says the two identity planes stay apart: staff are local to the
-- platform, learners are federated. This does not merge them — it gives the
-- *learner* plane its own local option, with its own tables, its own sessions
-- and its own cookie. A participant still cannot reach a single admin route,
-- because authorisation is `user_roles`, which this touches not at all.
--
-- What it does copy is the mechanics, deliberately: Argon2id for the password,
-- SHA-256 of the session token rather than the token, a revocation column. The
-- staff plane got those right and a second, subtly different implementation of
-- session handling in the same codebase is how one of them ends up weaker.
--
-- ## What is NOT here
--
-- **No self-service registration.** `CLAUDE.md` §3 lists self-service signup as
-- deferred, and it stays deferred: a participant record is created by an
-- administrator or by a seed. Anyone who can create an account on a CME
-- platform can create a CME record, and that is not a thing to open by default.

BEGIN;

-- ---------------------------------------------------------------------------
-- A project may now say its learners are local
-- ---------------------------------------------------------------------------
--
-- `identity_provider` is checked by `assertProvidersCoverSchema` at boot: the
-- API refuses to start if the schema permits a value no class implements. So
-- this constraint and `LocalIdentityProvider` have to land together, and the
-- boot check is what guarantees they did.

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_identity_provider_check;
ALTER TABLE projects
    ADD CONSTRAINT projects_identity_provider_check
    CHECK (identity_provider IN ('keycloak', 'local'));

COMMENT ON COLUMN projects.identity_provider IS
    'Which IdentityProvider verifies this project''s learner credentials. '
    '''keycloak'' validates a JWT against the project''s realm; ''local'' '
    'validates an opaque session token issued by this platform (P25-02).';

-- ---------------------------------------------------------------------------
-- The password
-- ---------------------------------------------------------------------------
--
-- Keyed on `user_identities`, not on `users`. A person may hold several
-- credentials — that is the whole point of the 0025 split — and only the one
-- with `provider = 'local'` has a password. Keying on the person would imply
-- there is one password per human, which stops being true the moment somebody
-- has both a MEDICE Keycloak account and a local one.
--
-- Not tenant-scoped, and no RLS, for the same reason `user_identities` is not:
-- the credential is resolved **before** any tenant context exists. The guard
-- cannot set `app.customer_id` until it knows who is calling.

CREATE TABLE learner_credentials (
    user_identity_id uuid PRIMARY KEY
        REFERENCES user_identities(id) ON DELETE CASCADE,

    -- Argon2id, as `admin_users.password_hash` — see `credentials.ts` for the
    -- parameters and why they are what they are.
    password_hash    text NOT NULL,

    -- Forces a change at next sign-in. Set for anything an administrator or a
    -- seed created, because a password somebody else chose is a password
    -- somebody else knows.
    must_change      boolean NOT NULL DEFAULT true,

    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),

    -- Lockout, so an online guessing attack costs something. Deliberately a
    -- counter and a timestamp rather than a rate limiter in Redis: this has to
    -- survive a restart, and a lockout that a container bounce clears is not a
    -- lockout.
    failed_attempts  integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
    locked_until     timestamptz
);

COMMENT ON TABLE learner_credentials IS
    'Password for a participant whose credential is local rather than '
    'federated. Keyed on the credential, not the person (P25-02).';

-- ---------------------------------------------------------------------------
-- The session
-- ---------------------------------------------------------------------------
--
-- An opaque token, not a JWT. The platform is the issuer *and* the verifier
-- here, so a signed self-describing token buys nothing and costs the one thing
-- that matters: revocation. A stolen JWT is valid until it expires; a stolen
-- row here is one `UPDATE … SET revoked_at` away from useless.

CREATE TABLE learner_sessions (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- The project the participant signed in *through*. A session is scoped to
    -- one tenant on purpose: a physician who learns with two customers signs in
    -- twice, and neither session can read the other's courses. Cheaper than
    -- reasoning about a session that spans tenants, and much easier to be sure
    -- about.
    project_id   uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    -- SHA-256 of the cookie value, never the value. A database dump — or a
    -- backup on a laptop — must not be a set of live sessions. The server can
    -- verify a presented token and cannot mint one.
    token_hash   bytea NOT NULL,

    created_at   timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    expires_at   timestamptz NOT NULL,
    revoked_at   timestamptz,

    -- For the security log. No IP in the clear: a salted hash answers "was this
    -- the same client?" without storing a personal identifier (docs/gdpr.md).
    ip_hash      bytea,
    user_agent   text
);

CREATE UNIQUE INDEX learner_sessions_token_key ON learner_sessions (token_hash);
CREATE INDEX learner_sessions_user_idx ON learner_sessions (user_id, created_at DESC);

-- The sweep the expiry job runs. Partial, because an expired or revoked row is
-- exactly what it is looking for and the live ones are the majority.
CREATE INDEX learner_sessions_expired_idx ON learner_sessions (expires_at)
    WHERE revoked_at IS NULL;

COMMENT ON TABLE learner_sessions IS
    'Opaque participant sessions, scoped to one project. Opaque rather than a '
    'JWT because the platform is issuer and verifier here, and revocation is '
    'worth more than statelessness (P25-02).';

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
--
-- No RLS on either table, and that is deliberate rather than an omission.
-- Both are read by the auth guard *before* a tenant context can exist — RLS
-- would return zero rows and every sign-in would fail with "wrong password"
-- for a correct one. `user_identities` (migration 0025) is not RLS-scoped for
-- exactly the same reason, and the tenant boundary is enforced where it can be:
-- `learner_sessions.project_id` scopes the session, and every route the session
-- then reaches runs under RLS.

GRANT SELECT, INSERT, UPDATE, DELETE ON learner_credentials TO ds_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON learner_sessions TO ds_app;

-- The assertion, because a grant that silently did not apply is a sign-in path
-- that fails with a permission error at the worst moment — and because
-- migration 0017 discovered exactly that about a REVOKE it had assumed worked.
DO $$
BEGIN
    IF NOT has_table_privilege('ds_app', 'learner_credentials', 'SELECT')
       OR NOT has_table_privilege('ds_app', 'learner_sessions', 'INSERT') THEN
        RAISE EXCEPTION 'ds_app cannot use the local participant tables';
    END IF;
END $$;

COMMIT;
