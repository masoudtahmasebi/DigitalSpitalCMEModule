-- ---------------------------------------------------------------------------
-- Passwort vergessen, on both planes (P40)
-- ---------------------------------------------------------------------------
--
-- > forget password is not there at all
--
-- It was not. An operator or a physician who forgot their password had exactly
-- one route back: ask somebody with an account to issue them a link. That is
-- fine for a five-person console and wrong for several thousand physicians,
-- and it is the kind of gap that gets discovered on the launch weekend.
--
-- Two things are needed and this migration adds both.
--
-- ## 1 · Somewhere for the platform's own mail to come from
--
-- A project already carries SMTP settings, and certificate delivery uses them
-- (P8-02): each customer's mail leaves from their own server with their own
-- sender. That covers a physician, whose reset belongs to a project.
--
-- It does not cover a console operator. A `super_admin` belongs to no customer,
-- so there is no project whose SMTP is theirs to borrow, and picking one
-- arbitrarily would put a customer's address on mail about a platform account.
--
-- The alternative was `PLATFORM_SMTP_*` in `config.env`. Rejected on the
-- client's instruction — *"both, self-configuring"* — and it is the better
-- answer anyway: the same reasoning that moved `EXTRA_CORS_ORIGINS` and the
-- Keycloak binding out of the deployment's env file and onto the entity they
-- belong to. Changing where platform mail comes from should not need SSH.
--
-- ## 2 · A reset token for a participant
--
-- The staff plane has had one since migration 0017 —
-- `admin_credential_tokens`, with `kind IN ('invite','reset')` and `issued_by`
-- nullable *"for a self-service reset, which nobody issued"*. The participant
-- plane has nothing equivalent, so it gets one here, shaped the same way and
-- for the same reasons.
--
-- Why a second table rather than one shared: the two reference different
-- things (`admin_users` vs `user_identities`), live on different sides of the
-- RLS fence, and have different lifecycles. One table would need both foreign
-- keys nullable and a CHECK to keep exactly one of them set — which is a
-- discriminated union pretending to be a table, and the discriminant would be
-- read on the authentication path.

BEGIN;

-- ---------------------------------------------------------------------------
-- The platform's sender
-- ---------------------------------------------------------------------------
--
-- A singleton, enforced by the primary key rather than by a convention
-- somebody has to remember: `id` may only ever be `true`, so there is exactly
-- one row and `INSERT … ON CONFLICT (id) DO UPDATE` is the whole write path.
--
-- Beside the staff tables, not on `customers`, for `admin_2fa_policy`'s
-- reason: it is read on the sign-in path before any tenant context exists, and
-- `customers` is under FORCE ROW LEVEL SECURITY.

CREATE TABLE platform_smtp (
    id             boolean PRIMARY KEY DEFAULT true CHECK (id),

    host           text,
    port           integer CHECK (port IS NULL OR (port > 0 AND port <= 65535)),
    username       text,

    -- Encrypted with the application KMS key, exactly as `projects.smtp_password_enc`
    -- is (CLAUDE.md §4 invariant 7). Write-only: no endpoint returns it, no log
    -- line contains it, and the console shows whether one is stored rather than
    -- what it is.
    password_enc   bytea,

    -- Implicit TLS on connect (port 465). Anything else is STARTTLS, which is
    -- what `SmtpDeliveryChannel` assumes when this is false.
    secure         boolean NOT NULL DEFAULT false,

    from_address   text,
    from_name      text,

    updated_at     timestamptz NOT NULL DEFAULT now(),
    -- Who last changed it. No FK, as on `admin_2fa_policy`: an account may be
    -- deleted and the record of who redirected the platform's mail should
    -- outlive them.
    updated_by     uuid
);

COMMENT ON TABLE platform_smtp IS
    'The sender for mail about platform accounts — operator password resets '
    'and invitations. One row (P40-01). A project''s own SMTP settings are on '
    'projects and are used for anything belonging to a customer.';

-- The row exists from the start, empty. A `GET` that has to cope with "no row
-- yet" and a `PUT` that has to decide between insert and update are two places
-- to get the same thing wrong; seeding it here leaves one.
INSERT INTO platform_smtp (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- A participant's reset token
-- ---------------------------------------------------------------------------
--
-- Keyed on `user_identities`, like `learner_credentials`, and **not** tenant
-- scoped — for the same reason that table is not. The token is presented by
-- somebody with no session, so it is resolved before any tenant context
-- exists; a policy on `app.customer_id` would match nothing at exactly the
-- moment the row has to be found.
--
-- The tenant is still not lost: `user_identities` carries the customer, and
-- every write that follows redemption runs inside the ordinary tenant
-- transaction.

CREATE TABLE learner_credential_tokens (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_identity_id uuid NOT NULL REFERENCES user_identities(id) ON DELETE CASCADE,

    -- SHA-256 of the token, never the token. A database dump must not be a set
    -- of live password-reset links.
    token_hash       bytea NOT NULL,

    -- The project the request came through, so the mail goes out via that
    -- project's SMTP and the link points back at the right tenant path.
    project_id       uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    created_at       timestamptz NOT NULL DEFAULT now(),
    accepted_at      timestamptz,
    revoked_at       timestamptz
);

CREATE UNIQUE INDEX learner_credential_tokens_token_key
    ON learner_credential_tokens (token_hash);

-- The lookup `issueResetToken` does before writing a new one: revoke whatever
-- is outstanding, so a link already in a mailbox stops working.
CREATE INDEX learner_credential_tokens_open_idx
    ON learner_credential_tokens (user_identity_id)
    WHERE accepted_at IS NULL AND revoked_at IS NULL;

COMMENT ON TABLE learner_credential_tokens IS
    'Single-use, time-limited password-reset tokens for local participants '
    '(P40-03). RESET_VALID_MINUTES in @ds/domain owns the lifetime; the '
    'redemption path checks it — see P39-01 for what happens when it does not.';

COMMIT;
