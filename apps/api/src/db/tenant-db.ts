/**
 * The bridge between a validated token and PostgreSQL row-level security
 * (P1-05), implementing ADR-0002.
 *
 * This is the failure mode the whole isolation design exists to prevent: a
 * pooled connection leaking one request's tenant into the next. It is prevented
 * by doing every request inside a transaction and setting `app.customer_id`
 * with `set_config(..., true)` — the `true` makes it LOCAL to the transaction,
 * so when the connection returns to the pool the setting is gone.
 *
 * The values come from the validated token and local role assignment, never
 * from a request parameter, header or body field. A request whose tenant cannot
 * be resolved does not reach a query: `runInTenant` refuses to run without a
 * customer id (super admin included — it acts as one customer at a time, ADR-0002).
 */

import type { AppRole } from "@ds/domain";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { schema } from "./schema.js";

export type Db = NodePgDatabase<typeof schema>;

declare module "express-serve-static-core" {
  interface Request {
    /**
     * Set by `TenantTransactionInterceptor` once the RLS transaction is open.
     * Undefined for public routes, which never touch tenant data.
     */
    db?: Db;
  }
}

export interface TenantContext {
  /** The customer this request acts within. Required — no ambient default. */
  readonly customerId: string;
  /**
   * `system` is not a user role: it is the background worker acting for one
   * customer at a time (P7-06). Named rather than borrowed from `super_admin`
   * so an audit trail can tell "a person with the highest privilege did this"
   * apart from "the submission queue did this" — which are very different
   * things to find in a compliance log.
   */
  readonly role: AppRole | "system";
  readonly userId?: string;
}

/** The minimal surface of a `pg.Pool` we depend on, so tests can fake it. */
export interface PoolLike {
  connect(): Promise<PoolClientLike>;
}

export interface PoolClientLike {
  query(text: string, values?: unknown[]): Promise<unknown>;
  release(): void;
}

export class TenantResolutionError extends Error {
  constructor() {
    super("no tenant context: refusing to run a query without a resolved customer");
    this.name = "TenantResolutionError";
  }
}

/**
 * Run `work` inside a transaction with the RLS session variables set.
 *
 * Commits on success, rolls back on any error. The connection is always
 * released. `work` receives a Drizzle instance bound to the same client, so
 * every statement it issues sees the tenant context.
 */
export async function runInTenant<T>(
  pool: PoolLike,
  context: TenantContext,
  work: (db: Db) => Promise<T>,
): Promise<T> {
  if (context.customerId === undefined || context.customerId === "") {
    // Fail closed before any statement runs.
    throw new TenantResolutionError();
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Transaction-scoped (is_local = true), so pooling cannot leak these into
    // the next request that borrows this connection. Parameterised, so a
    // customer id can never be a SQL-injection vector.
    await client.query("SELECT set_config('app.customer_id', $1, true)", [
      context.customerId,
    ]);
    await client.query("SELECT set_config('app.role', $1, true)", [context.role]);
    if (context.userId !== undefined) {
      await client.query("SELECT set_config('app.user_id', $1, true)", [context.userId]);
    }

    const db = drizzle(client as never, { schema });
    const result = await work(db);

    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // The original error is the one worth surfacing.
    }
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Helper for building the `set_config` calls in one place, exported so a test
 * can assert the exact sequence without a live database.
 */
export function tenantSetupStatements(
  context: TenantContext,
): ReadonlyArray<{ text: string; values: unknown[] }> {
  const statements: Array<{ text: string; values: unknown[] }> = [
    { text: "BEGIN", values: [] },
    {
      text: "SELECT set_config('app.customer_id', $1, true)",
      values: [context.customerId],
    },
    { text: "SELECT set_config('app.role', $1, true)", values: [context.role] },
  ];

  if (context.userId !== undefined) {
    statements.push({
      text: "SELECT set_config('app.user_id', $1, true)",
      values: [context.userId],
    });
  }

  return statements;
}
