-- P8-03: durable certificate delivery.
--
-- `certificates` already had `status`, `delivered_at` and `delivery_error`, but
-- nothing to schedule a *retry* with — so a failed send was terminal and
-- invisible. This adds the same queue columns `eiv_submissions` carries, plus
-- the claim function that lets a background worker find work across tenants
-- without weakening row-level security.
--
-- ## What is deliberately not stored here
--
-- **The recipient's email address.** It stays in `users` and is read at send
-- time. Copying it onto the certificate row would create a second copy of
-- personal data that erasure would have to find (ADR-0008 nulls `users.email`),
-- and a stale copy is exactly how a Teilnahmebescheinigung ends up posted to a
-- physician who asked to be forgotten. Reading it live means erasure stops
-- delivery for free — see `planDeliveryAttempt`'s `no_recipient`.
--
-- **The PDF.** It is rendered on demand from data the database already holds.
-- Storing the bytes would mean a second answer to what the certificate says.
--
-- ## Why delivery has no `report_due_at` equivalent
--
-- A Punktemeldung has a statutory deadline and its queue is ordered by it. A
-- certificate has none: late is still delivered. The queue is therefore ordered
-- oldest-first, which is fair rather than urgent, and nothing in it can expire.

BEGIN;

ALTER TABLE certificates
    -- 0 until the first attempt. Bounded by MAX_DELIVERY_ATTEMPTS in
    -- `@ds/domain`, not by a constraint here: the number is a policy that may
    -- change, and a CHECK would turn a policy change into a migration.
    ADD COLUMN delivery_attempt_count integer NOT NULL DEFAULT 0,
    -- NULL means "eligible now". Also carries the worker's lease — see the
    -- claim function below.
    ADD COLUMN delivery_next_attempt_at timestamptz,
    ADD COLUMN delivery_first_attempt_at timestamptz,
    -- Why the queue stopped, when it did: one of `DeliveryAbandonReason`.
    -- Distinct from `delivery_error`, which holds the last transport message.
    ADD COLUMN delivery_abandoned_reason text;

-- Only rows that are actually waiting. A partial index because the vast
-- majority of certificates are `delivered` and never looked at again, and an
-- index over all of them would be mostly dead weight on the hot path.
CREATE INDEX certificates_delivery_due_idx
    ON certificates (delivery_next_attempt_at NULLS FIRST, created_at)
    WHERE status IN ('issued', 'pending');

-- ---------------------------------------------------------------------------
-- Finding work across tenants
--
-- Same chicken-and-egg as `claim_due_eiv_submissions` (0005), same answer, and
-- the same limits apply:
--
--   * Returns **routing metadata only** — which certificate, which customer.
--     No name, no address, no download token. Knowing customer X has a
--     certificate waiting discloses nothing about the physician.
--   * Everything after this call runs inside a normal per-tenant transaction
--     with `app.customer_id` set, so the row read and every write are scoped by
--     RLS exactly as a request would be. The bypass buys the list of tenants
--     and nothing else.
--   * It **leases** what it hands out by pushing `delivery_next_attempt_at`
--     forward, so two API instances sweeping in the same second take disjoint
--     sets. `FOR UPDATE SKIP LOCKED` handles the race inside one statement; the
--     lease handles the window between claiming and recording an outcome.
--     Without it a slow send could be picked up twice and the physician would
--     receive their certificate twice.
--
-- If the worker dies mid-flight the lease expires and the row is picked up
-- again — which is why the lease is short and the outcome write clears it.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION claim_due_certificate_deliveries(
    p_limit         integer,
    p_now           timestamptz,
    p_lease_seconds integer
)
RETURNS TABLE (certificate_id uuid, customer_id uuid)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    WITH due AS (
        SELECT c.id
          FROM certificates c
         WHERE c.status = 'issued'
           AND c.delivered_at IS NULL
           AND c.delivery_abandoned_reason IS NULL
           AND (c.delivery_next_attempt_at IS NULL
                OR c.delivery_next_attempt_at <= p_now)
         ORDER BY c.created_at ASC
         LIMIT p_limit
           FOR UPDATE SKIP LOCKED
    )
    UPDATE certificates c
       SET delivery_next_attempt_at = p_now + make_interval(secs => p_lease_seconds)
      FROM due
     WHERE c.id = due.id
    RETURNING c.id, c.customer_id;
$$;

-- Same owner as the other two cross-tenant functions: the one role that may see
-- across tenants, and only through functions returning routing metadata.
ALTER FUNCTION claim_due_certificate_deliveries(integer, timestamptz, integer)
    OWNER TO ds_binding_resolver;

-- Column-level, and only the columns the function names. BYPASSRLS grants no
-- privileges of its own — a lesson from migration 0009, where `erase_subject`
-- matched zero rows because the role could see past RLS but had no SELECT.
GRANT SELECT (id, customer_id, status, delivered_at, delivery_next_attempt_at,
              delivery_abandoned_reason, created_at)
    ON certificates TO ds_binding_resolver;
GRANT UPDATE (delivery_next_attempt_at) ON certificates TO ds_binding_resolver;

REVOKE ALL ON FUNCTION claim_due_certificate_deliveries(integer, timestamptz, integer)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_due_certificate_deliveries(integer, timestamptz, integer)
    TO ds_app;

COMMIT;
