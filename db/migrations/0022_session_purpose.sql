-- What an `admin_sessions` row is *for* (P12-03, completing ADR-0012).
--
-- ## The bug this closes
--
-- `issueChallenge` — the step between "your password was correct" and "you
-- passed the second factor" — created a row in `admin_sessions` and returned
-- its token to the caller. Its comment claimed the row was distinguishable
-- from a real session because the client never learns its CSRF token.
--
-- That is not what distinguishes a session. `resolveSession` looks a row up by
-- token hash and returns it, and CSRF is only checked on unsafe methods, so
-- the challenge token worked as a session cookie for every `GET` in the admin
-- API. The second factor could be skipped by taking the token the server hands
-- you for failing it and putting it in the cookie jar.
--
-- It bit exactly the accounts the second factor exists for: `super_admin` is
-- the only role that requires TOTP, and it is the role that can create
-- customers and grant staff access.
--
-- ## Why a column rather than a separate table
--
-- The original instinct — one table, because a challenge has a session's
-- lifetime and revocation rules — was right. What was missing was that
-- "lookups for authentication must not find it" is not implied by that
-- similarity and has to be said. `purpose` says it, and the partial unique
-- index below keeps the lookup on `session` rows as cheap as it was.
--
-- A separate table would have duplicated the expiry, revocation and
-- last-seen columns, and the next person to change the session timeout would
-- have had to remember to change it twice.

BEGIN;

ALTER TABLE admin_sessions
    ADD COLUMN purpose text NOT NULL DEFAULT 'session'
        CHECK (purpose IN ('session', 'totp_challenge'));

COMMENT ON COLUMN admin_sessions.purpose IS
    'session = authenticates requests. totp_challenge = carries a half-finished '
    'login between the password step and the TOTP step, and must never satisfy '
    'resolveSession. Enforced in the repository, which filters on this column.';

-- Every row that exists right now is a real session or a challenge that was
-- already usable as one; there is no way to tell them apart after the fact.
-- Revoking them all is the honest response to "some of these may be a
-- credential that should not have existed" — the cost is that every operator
-- signs in again, which is the correct price for closing an authentication
-- bypass.
UPDATE admin_sessions SET revoked_at = now() WHERE revoked_at IS NULL;

-- The existing partial index covers `WHERE revoked_at IS NULL`; this one keeps
-- the authentication lookup — which now always carries `purpose = 'session'` —
-- off a sequential scan as challenge rows accumulate.
CREATE INDEX admin_sessions_active_idx
    ON admin_sessions (token_hash)
    WHERE purpose = 'session' AND revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- Replay protection for the second factor
-- ---------------------------------------------------------------------------
--
-- A TOTP code is valid for its whole 30-second step, so without a record of
-- which step was last spent, a code read over somebody's shoulder — or captured
-- by a phishing page that relays it — can be used again for the rest of that
-- window. One integer closes it: anything at or below the last counter accepted
-- for this account is refused (`verifyTotp` in `@ds/domain`).
--
-- Nullable because an account that has never presented a code has no last
-- counter, and zero is a real counter value (1 January 1970).

ALTER TABLE admin_users ADD COLUMN totp_last_counter bigint;

COMMENT ON COLUMN admin_users.totp_last_counter IS
    'Highest TOTP counter this account has spent. Anything at or below it is '
    'refused as a replay. NULL means no code has ever been accepted.';

COMMIT;
