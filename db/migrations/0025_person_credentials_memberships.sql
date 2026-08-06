-- A person, their credentials, and the customers they belong to (P21-01).
--
-- ## The problem this fixes
--
-- `users` is keyed `UNIQUE (keycloak_realm, keycloak_sub)`, and the realm comes
-- from `projects.keycloak_issuer` per request. A physician who appears in two
-- customers' realms is therefore **two rows and two user ids**.
--
-- That is not a cosmetic duplicate. `efn_profiles` is `PRIMARY KEY (user_id)` —
-- one EFN per person, deliberately, because ADR-0004 records what divergent
-- EFNs across courses do: a Punktemeldung credits the wrong physician's
-- account, which looks exactly like success. Two user ids for one physician is
-- two EFNs on file and no way for the platform to know.
--
-- Asked directly, the client chose **one person, many customers** — one user
-- id, one EFN, one certificate history. This migration is what that costs.
--
-- ## The shape
--
--   users            the *person*.        Keyed on id. Global, not tenant-scoped.
--   user_identities  a *credential*.      Unique on (provider, realm, subject).
--   user_customers   a *membership*.      Unique on (user_id, customer_id).
--
-- Every existing `users.id` survives: `enrolments`, `efn_profiles` and
-- `certificates` all reference it and none of them may be rewritten. The
-- provider columns move rather than being re-derived, so the backfill cannot
-- lose or invent a credential.
--
-- ## Why `users` and `user_identities` stay global
--
-- A person is not a tenant's property. Their EFN, their certificates and their
-- name belong to them across every customer they learn with — that is the whole
-- point of the decision above, and it is why `users` has been outside RLS since
-- migration 0001. A credential is the same: it identifies the person, not the
-- tenant, and the auth guard resolves it *before* a tenant context exists, so a
-- tenant-scoped policy on it would fail closed on every request.
--
-- What *is* tenant-scoped is the membership, and `user_customers` carries the
-- `customer_id` and the RLS policy accordingly.
--
-- ## The rule this migration enforces by having no code for it
--
-- **Two credentials are linked to one person only by an explicit, verified
-- act.** Never automatically because two identity providers reported the same
-- email address: a provider that does not verify email can then assert its way
-- into an existing physician's CME history and EFN, and the platform cannot
-- tell which providers verify.
--
-- So a new `(provider, realm, subject)` creates a **new person**. The merge is
-- P21-05, deliberate, audited, and refused when both sides already have
-- different EFNs on file — that is not a merge, it is a question for a human.
--
-- There is no path in this migration that links two credentials, which is the
-- strongest form the rule can take.

BEGIN;

-- ---------------------------------------------------------------------------
-- Credentials
-- ---------------------------------------------------------------------------
CREATE TABLE user_identities (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Matches `projects.identity_provider`, whose only value today is
    -- 'keycloak'. 'local' arrives with P21-02.
    provider   text NOT NULL CHECK (provider IN ('keycloak', 'local')),

    -- The issuer for an OIDC provider. For 'local' it is the platform itself,
    -- spelled 'ds:local' rather than left empty — an empty string in a unique
    -- key is a value that looks like an accident.
    realm      text NOT NULL,

    -- `sub` for OIDC. For 'local', the participant account's own id.
    subject    text NOT NULL,

    created_at timestamptz NOT NULL DEFAULT now(),

    -- One credential authenticates one person. Without this, two rows could
    -- claim the same subject and the guard would have to choose.
    UNIQUE (provider, realm, subject)
);

CREATE INDEX user_identities_user_idx ON user_identities (user_id);

COMMENT ON TABLE user_identities IS
    'A way to sign in as a person. Deliberately global, like users: the auth '
    'guard resolves a credential before any tenant context exists (P21-01).';

-- Move, do not re-derive. Every existing user gets exactly one credential, and
-- its user_id is unchanged.
INSERT INTO user_identities (user_id, provider, realm, subject)
SELECT id, 'keycloak', keycloak_realm, keycloak_sub FROM users;

-- The old key goes, so a credential cannot live in two places and disagree.
-- Dropping the columns drops the composite UNIQUE with them; naming the
-- constraint explicitly would be one more generated identifier to be wrong
-- about.
ALTER TABLE users
    DROP COLUMN keycloak_realm,
    DROP COLUMN keycloak_sub;

-- ---------------------------------------------------------------------------
-- Provisioning, atomically, across two tables
-- ---------------------------------------------------------------------------
--
-- `provisionOrUpdate` used to be one `INSERT … ON CONFLICT (keycloak_realm,
-- keycloak_sub) DO UPDATE`, which is exactly why it was race-free: concurrent
-- first requests for the same subject resolved to one row because the database
-- resolved them.
--
-- Splitting the credential out of the person costs that property. "Insert a
-- person, then insert their credential" has a window in which two requests both
-- create a person and one then loses the credential insert — leaving a **person
-- row with no credential**, which is a physician nobody can ever sign in as and
-- which no later request will clean up.
--
-- Holding it together in application code needs a transaction, a SAVEPOINT and a
-- retry on the hot path of every authenticated request. Holding it together
-- here needs a sub-block, which in PL/pgSQL *is* a savepoint: the `EXCEPTION`
-- clause rolls back the person insert along with the credential insert, so the
-- loser of the race leaves nothing behind and simply re-reads.
--
-- SECURITY INVOKER (the default): this runs with the caller's rights, and both
-- tables are outside RLS, so there is nothing here that needs elevating.

CREATE FUNCTION provision_learner(
    p_provider   text,
    p_realm      text,
    p_subject    text,
    p_email      text,
    p_first_name text,
    p_last_name  text
) RETURNS TABLE (
    id         uuid,
    email      text,
    first_name text,
    last_name  text,
    erased_at  timestamptz
)
LANGUAGE plpgsql AS $fn$
DECLARE
    v_user_id uuid;
BEGIN
    LOOP
        SELECT ui.user_id INTO v_user_id
          FROM user_identities ui
         WHERE ui.provider = p_provider
           AND ui.realm    = p_realm
           AND ui.subject  = p_subject;

        IF FOUND THEN
            -- An absent claim never erases a stored value. Whether a token
            -- carries `given_name` depends on the client's scopes, so a token
            -- minted without the profile scope would otherwise null out a name
            -- we already knew — and that name is what prints on the
            -- Teilnahmebescheinigung. Clearing a name needs an explicit empty
            -- string, which passes through unchanged.
            --
            -- The `users_keep_erased` trigger (migration 0009) still fires on
            -- this UPDATE, so an erased subject signing in again stays erased.
            -- Their credential row deliberately survives erasure: it is what
            -- makes them resolve to the same, still-erased person rather than
            -- to a fresh one with their name written back.
            RETURN QUERY
            UPDATE users u
               SET email      = coalesce(p_email,      u.email),
                   first_name = coalesce(p_first_name, u.first_name),
                   last_name  = coalesce(p_last_name,  u.last_name),
                   updated_at = now()
             WHERE u.id = v_user_id
            RETURNING u.id, u.email, u.first_name, u.last_name, u.erased_at;
            RETURN;
        END IF;

        BEGIN
            INSERT INTO users (email, first_name, last_name)
            VALUES (p_email, p_first_name, p_last_name)
            RETURNING users.id INTO v_user_id;

            INSERT INTO user_identities (user_id, provider, realm, subject)
            VALUES (v_user_id, p_provider, p_realm, p_subject);

            RETURN QUERY
            SELECT u.id, u.email, u.first_name, u.last_name, u.erased_at
              FROM users u WHERE u.id = v_user_id;
            RETURN;
        EXCEPTION WHEN unique_violation THEN
            -- Another request created the same credential between the SELECT
            -- and the INSERT. This sub-block is a savepoint, so the person row
            -- rolls back with the credential and no orphan survives; the loop
            -- re-reads and takes the UPDATE branch.
            NULL;
        END;
    END LOOP;
END;
$fn$;

COMMENT ON FUNCTION provision_learner(text, text, text, text, text, text) IS
    'Resolve the person behind a credential, creating both on first sight. '
    'Atomic across users and user_identities so a lost race cannot leave a '
    'person nobody can sign in as (P21-01).';

-- ---------------------------------------------------------------------------
-- Memberships
-- ---------------------------------------------------------------------------
CREATE TABLE user_customers (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, customer_id)
);

CREATE INDEX user_customers_customer_idx ON user_customers (customer_id);

COMMENT ON TABLE user_customers IS
    'Which customers a person learns with. Tenant-scoped, unlike the person '
    'themselves — this is the row a customer admin may see (P21-01).';

-- Backfill the memberships that already exist implicitly: anybody enrolled in a
-- customer's course is a member of that customer. Derived rather than assumed,
-- so the first deploy does not lock existing learners out of their own courses.
--
-- ## Why `enrolments` is unforced for the length of one statement
--
-- `enrolments` is under FORCE ROW LEVEL SECURITY, and FORCE applies to the
-- table owner — which is `ds_migrator`, which is who runs this. Without the
-- line below, `SELECT DISTINCT user_id, customer_id FROM enrolments` returns
-- **zero rows**, the INSERT succeeds having inserted nothing, and the migration
-- reports success. Every existing learner then finds themselves a member of no
-- customer. A backfill that silently does nothing is the worst outcome
-- available here, because there is no error to notice.
--
-- `NO FORCE` rather than `DISABLE`: it exempts the owner and nobody else, so
-- there is no instant at which a `ds_app` session could see across tenants.
-- `ALTER TABLE` also takes ACCESS EXCLUSIVE for the rest of this transaction,
-- so no other session reads `enrolments` at all while it is off. And it is DDL
-- inside a transaction, so a failure anywhere below restores FORCE with
-- everything else.
--
-- A fourth BYPASSRLS role would be a permanent privilege bought to solve a
-- one-statement problem, which is why there isn't one.
ALTER TABLE enrolments NO FORCE ROW LEVEL SECURITY;

INSERT INTO user_customers (user_id, customer_id)
SELECT DISTINCT user_id, customer_id FROM enrolments
ON CONFLICT (user_id, customer_id) DO NOTHING;

ALTER TABLE enrolments FORCE ROW LEVEL SECURITY;

-- Tenant-scoped like every other table carrying a customer_id, and FORCE so
-- that ds_migrator is held to it too (ADR-0002).
--
-- Enabled *after* the backfill, so the backfill does not have to fight the
-- policy it is about to install.
--
-- ## `nullif(…, '')`, and why the obvious spelling is wrong
--
-- Migration 0001 wrote `current_setting('app.customer_id', true)::uuid` and
-- migration 0014 replaced every instance of it, because
-- `set_config(…, true)` is transaction-*local*: when the transaction ends the
-- setting reverts to the empty string rather than disappearing. On any
-- connection a pool has ever used for a tenant request — after a minute of
-- traffic, every connection — a context-free query then meets
--
--     ERROR:  invalid input syntax for type uuid: ""
--
-- instead of returning no rows. Fail-closed either way, but a 500 with a
-- Postgres message attached rather than the empty result the caller's bug
-- deserved.
--
-- 0014 predicted this exact regression: *"a future policy written by copying
-- this shape inherits the same defect."* This policy was written by copying
-- that shape, and the integration suite caught it. `nullif` is the shape to
-- copy — NULL for both "never set" and "reverted after a transaction", and
-- `column = NULL` is not true, which is no rows.
ALTER TABLE user_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_customers FORCE ROW LEVEL SECURITY;

CREATE POLICY user_customers_tenant_isolation ON user_customers
  USING (customer_id = nullif(current_setting('app.customer_id', true), '')::uuid)
  WITH CHECK (customer_id = nullif(current_setting('app.customer_id', true), '')::uuid);

-- `ALTER DEFAULT PRIVILEGES FOR ROLE ds_migrator` (infra/postgres/init-roles.sql)
-- already grants these, so the two lines below are a restatement rather than a
-- requirement. They are here because the default privileges are a fact about
-- the *cluster* and these are a fact about the *migration*: a database restored
-- without that ALTER having run would otherwise leave ds_app with no access to
-- the two tables the auth path now depends on, and present as every learner
-- being rejected.
GRANT SELECT, INSERT, UPDATE, DELETE ON user_identities TO ds_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_customers  TO ds_app;
GRANT EXECUTE ON FUNCTION provision_learner(text, text, text, text, text, text) TO ds_app;

COMMIT;
