-- The second factor becomes a policy instead of a constant (P22-02).
--
-- ## What it was
--
-- `requiresSecondFactor(role)` returned `role === 'super_admin'`, full stop.
-- Nobody could turn TOTP on for a customer that wanted it, off for one that did
-- not, or mandatory for everybody. The request was for all three.
--
-- ## The gap the request uncovered, which is the more urgent half
--
-- There was **no way to remove or reset an enrolled second factor at all**. An
-- operator who lost their phone was locked out permanently — no reset endpoint,
-- no admin action, nothing. For a super administrator, who is the one role that
-- was *forced* to enrol, that meant a lost device could end the platform's
-- only unrestricted account with no recovery whatsoever.
--
-- A lockout with no workaround is a worse failure than the credential theft
-- strict 2FA prevents, because the theft at least has a response.
--
-- ## The shape
--
--   admin_2fa_policy   one row per customer, plus exactly one row for the
--                      platform itself (customer_id IS NULL), which is the
--                      scope a super administrator belongs to.
--
-- Three values, and they are genuinely three rather than a boolean with a
-- maybe:
--
--   disabled   not offered, and an already-enrolled secret is not asked for
--   optional   enrol if you want to; if you have, you must use it
--   required   everybody enrols, and is sent to enrolment if they have not
--
-- `optional` is deliberately not "off". Relaxing a policy must never make a
-- stolen password sufficient for somebody who had already protected themselves.
-- Turning it off for such an account is `disabled` — a different, audited
-- choice, and the one that lets a lost device be recovered from.
--
-- ## Why this lives beside the staff tables and not on `customers`
--
-- It is read during sign-in, **before** any tenant context exists — the whole
-- point of ADR-0012's staff plane is that it does not depend on a customer's
-- configuration being reachable. `customers` is under FORCE ROW LEVEL SECURITY,
-- so reading a column there at that moment would return nothing and the policy
-- would silently fall back to its default for everyone. A table on the staff
-- plane's own side of the fence has no such failure mode.
--
-- The foreign key to `customers` is still safe: PostgreSQL runs referential
-- integrity checks outside RLS, which is why `admin_user_roles` already carries
-- one.
--
-- ## Why the platform row exists rather than a NULL-means-default rule
--
-- A missing row and a row saying `optional` would be indistinguishable to a
-- reader, and the difference matters here: the platform's default is
-- `required`, and "somebody deliberately relaxed it" is exactly the fact an
-- auditor needs to see. The row is seeded, so there is always something with an
-- `updated_at` and an `updated_by` to look at.

BEGIN;

CREATE TYPE second_factor_policy AS ENUM ('disabled', 'optional', 'required');

CREATE TABLE admin_2fa_policy (
    -- NULL means the platform itself — the scope a super administrator belongs
    -- to, since they belong to no customer.
    customer_id uuid REFERENCES customers(id) ON DELETE CASCADE,
    policy      second_factor_policy NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    -- Who last changed it. No FK: an account may be deleted and the record of
    -- who relaxed a security policy should outlive them.
    updated_by  uuid
);

-- One row per customer. A partial unique index rather than a primary key,
-- because the platform row's `customer_id` is NULL and NULL is not unique to
-- PostgreSQL's ordinary unique index.
CREATE UNIQUE INDEX admin_2fa_policy_customer_key
    ON admin_2fa_policy (customer_id) WHERE customer_id IS NOT NULL;

-- And exactly one platform row, ever. Without this, two rows could disagree
-- about the strictest policy in the system and the reader would pick whichever
-- the planner returned first.
CREATE UNIQUE INDEX admin_2fa_policy_platform_key
    ON admin_2fa_policy ((true)) WHERE customer_id IS NULL;

COMMENT ON TABLE admin_2fa_policy IS
    'Second-factor policy per customer, plus one row for the platform itself '
    '(customer_id IS NULL). Read during sign-in, before any tenant context '
    'exists, which is why it is not a column on customers (P22-02).';

-- The platform starts strict. ADR-0012's reasoning has not stopped being true:
-- a super administrator can act inside any customer, so their credential is the
-- one whose theft is worth the most, and there is nobody above them to notice.
-- What changed is that this is a default rather than a law — a policy nobody
-- can change is not a policy.
INSERT INTO admin_2fa_policy (customer_id, policy) VALUES (NULL, 'required');

-- Not RLS-scoped, like every other table on the staff plane (migration 0017).
-- The application mediates which policy an operator may read or write, and it
-- reads this before a tenant context could exist.
GRANT SELECT, INSERT, UPDATE, DELETE ON admin_2fa_policy TO ds_app;

-- ---------------------------------------------------------------------------
-- Recovering an account whose second factor is gone
-- ---------------------------------------------------------------------------
--
-- Clearing the secret is the whole reset: `totp_enrolled_at` going NULL is what
-- sends the next sign-in to enrolment rather than to a code prompt. So a reset
-- restores access **without** lowering the bar — under a `required` policy the
-- operator must enrol again before they get in.
--
-- `totp_last_counter` goes too. Leaving it would carry a replay-window high
-- mark from the old secret onto the new one, and a counter from a device that
-- no longer exists is not a fact about the device that replaces it.
COMMENT ON COLUMN admin_users.totp_enrolled_at IS
    'NULL means no second factor is set up. Clearing it together with '
    'totp_secret_enc is how an administrator recovers an operator whose device '
    'is gone — the next sign-in goes to enrolment, not straight in (P22-02).';

COMMIT;
