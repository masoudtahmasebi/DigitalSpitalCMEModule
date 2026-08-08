-- Administering participants, rather than only seeding them (P21-04).
--
-- ## Why this exists
--
-- P25-02 gave the learner plane a local credential, and left exactly one way to
-- create one: run a seed from a shell on the production host. That is a
-- development fixture standing in for a product feature. A customer cannot
-- onboard a physician, cannot reset a password somebody forgot, and cannot stop
-- an account belonging to somebody who has left — and "ask DigitalSpital to SSH
-- in" is not an answer for any of the three.
--
-- The schema needs two things the credential table did not have.

BEGIN;

-- ---------------------------------------------------------------------------
-- Disabling an account
-- ---------------------------------------------------------------------------
--
-- Distinct from `locked_until`, and the distinction matters.
--
-- `locked_until` is the **automatic** lockout an online guessing attack earns,
-- and it expires by itself — that is the whole point of it. `disabled_at` is a
-- **deliberate administrative act**: somebody left the practice, or an account
-- is suspected compromised. It does not expire, and nothing but another
-- deliberate act clears it.
--
-- Overloading one column for both would mean an administrator disabling an
-- account for good by writing a timestamp far in the future, and a lockout
-- sweep one day clearing it.
--
-- Deleting the row instead would be worse: `user_identities` is what resolves a
-- person, so dropping the credential detaches a physician from their own CME
-- record. Their enrolments, their certificates and their EIV submissions all
-- hang off `users.id`, and none of them may lose their owner because somebody
-- left a job.

ALTER TABLE learner_credentials
    ADD COLUMN disabled_at timestamptz,
    -- Who did it, for the audit trail. `admin_users`, not `users`: this is an
    -- act by a member of staff on the staff plane (ADR-0012).
    ADD COLUMN disabled_by uuid REFERENCES admin_users(id) ON DELETE SET NULL;

COMMENT ON COLUMN learner_credentials.disabled_at IS
    'Set by an administrator to stop this credential signing in. Distinct from '
    'locked_until, which is the automatic lockout and expires on its own '
    '(P21-04).';

-- ---------------------------------------------------------------------------
-- Finding a participant by e-mail, quickly and case-insensitively
-- ---------------------------------------------------------------------------
--
-- The sign-in resolves `lower(u.email)` on every attempt, and the console's
-- list filters on it. Without this the query is a sequential scan over every
-- person on the platform — global, because `users` deliberately is — which is
-- fine at two customers and is not fine later.
--
-- Not unique. Two people may legitimately share an address across customers in
-- this schema (a shared practice mailbox is real), and P21-05's merge is the
-- deliberate act that resolves it. A unique index here would refuse the second
-- one at sign-up with a constraint violation nobody could act on.

CREATE INDEX IF NOT EXISTS users_email_lower_idx ON users (lower(email));

-- ---------------------------------------------------------------------------
-- The assertion
-- ---------------------------------------------------------------------------
--
-- `ds_app` already holds SELECT/INSERT/UPDATE/DELETE on the table from
-- migration 0030, and column-level grants are not in play — but a new column on
-- a table with an explicit grant is exactly the place a permission quietly does
-- not extend, and migration 0017 found that the hard way about a REVOKE.

DO $$
BEGIN
    IF NOT has_column_privilege('ds_app', 'learner_credentials', 'disabled_at', 'UPDATE') THEN
        RAISE EXCEPTION 'ds_app cannot disable a participant credential';
    END IF;
END $$;

COMMIT;
