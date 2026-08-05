/**
 * Append-only audit logging (`CLAUDE.md` §4 invariant 8), infrastructure layer.
 *
 * Two write paths, chosen by whether the entry has a specific tenant:
 *
 * - `recordForCustomer` sets `app.customer_id` on its own short transaction
 *   before inserting, so the row satisfies `audit_log`'s RLS `WITH CHECK`
 *   (ADR-0002) the same way any tenant-scoped insert must. It runs
 *   independently of the caller's main request transaction — an audit entry
 *   for "this actor asserted this identity" should be durable even if the
 *   business operation that follows it fails or rolls back.
 * - `recordSystem` inserts with `customer_id = NULL`, which the policy always
 *   allows, for events with no tenant yet (a rejected token, an unresolved
 *   project slug).
 *
 * Never pass raw request/response bodies into `detail` — EFNs, VNR passwords
 * and free-text evaluation answers must never reach a log (`CLAUDE.md` §4
 * invariant 7, ADR-0004).
 *
 * ## Why the actor is one field and not two
 *
 * Since ADR-0012 there are two disjoint populations that can act: learners in
 * `users` and operators in `admin_users`. A bare uuid does not say which, and
 * the question an auditor asks about a Punktemeldung is exactly that — did the
 * physician trigger it, or did an operator submit it on their behalf?
 *
 * Modelling it as `actorId?: string` plus `actorIdentity?: string` would allow
 * an id with no population and a population with no id, and both of those are
 * rows nobody can interpret later. The union below makes those two states
 * unrepresentable, which is the same thing migration 0020's
 * `audit_log_actor_identity_agrees` check enforces at the other end. Two
 * guards, one rule, and the compiler catches it before the database has to.
 */

import type { Pool } from "pg";

export type AuditActor =
  /** A physician acting on their own record, authenticated by an IdP. */
  | { readonly identity: "learner"; readonly id: string }
  /** An operator acting in the admin console, authenticated locally. */
  | { readonly identity: "staff"; readonly id: string }
  /** No actor: a rejected token, an unresolved slug, a background worker. */
  | { readonly identity: "system" };

export const SYSTEM_ACTOR: AuditActor = { identity: "system" };

/**
 * Narrow a `Principal` to the actor it represents.
 *
 * Structurally typed rather than importing `Principal`, which would point an
 * infrastructure module at the auth layer for the sake of two fields.
 */
export function actorOf(principal: {
  readonly identity: "learner" | "staff";
  readonly userId: string;
}): AuditActor {
  return { identity: principal.identity, id: principal.userId };
}

export interface AuditEntry {
  /** Required, so "who did this" is a decision and never an omission. */
  readonly actor: AuditActor;
  readonly action: string;
  readonly subject?: string;
  readonly detail?: Record<string, unknown>;
}

export interface AuditServicePort {
  recordForCustomer(customerId: string, entry: AuditEntry): Promise<void>;
  recordSystem(entry: AuditEntry): Promise<void>;
}

export class AuditService implements AuditServicePort {
  constructor(private readonly pool: Pool) {}

  async recordForCustomer(customerId: string, entry: AuditEntry): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.customer_id', $1, true)", [customerId]);
      await this.insert(client, customerId, entry);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async recordSystem(entry: AuditEntry): Promise<void> {
    await this.insert(this.pool, null, entry);
  }

  private async insert(
    executor: Pick<Pool, "query">,
    customerId: string | null,
    entry: AuditEntry,
  ): Promise<void> {
    await executor.query(
      `INSERT INTO audit_log (customer_id, actor_id, actor_identity, action, subject, detail)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        customerId,
        entry.actor.identity === "system" ? null : entry.actor.id,
        entry.actor.identity,
        entry.action,
        entry.subject ?? null,
        JSON.stringify(entry.detail ?? {}),
      ],
    );
  }
}
