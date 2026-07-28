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
 */

import type { Pool } from "pg";

export interface AuditEntry {
  readonly actorId?: string;
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
      `INSERT INTO audit_log (customer_id, actor_id, action, subject, detail)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        customerId,
        entry.actorId ?? null,
        entry.action,
        entry.subject ?? null,
        JSON.stringify(entry.detail ?? {}),
      ],
    );
  }
}
