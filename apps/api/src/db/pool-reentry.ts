/**
 * Refuses the second connection that caused the outage of 01.09.2026 (P142-01).
 *
 * ## What happened
 *
 * `TenantTransactionInterceptor` opens the RLS transaction around the **whole**
 * request, so every handler runs holding one pooled connection. Several
 * handlers then ask the *same* pool for a **second** one — the audit log writes
 * on its own transaction on purpose, so that a refusal is still recorded when
 * the request it refused rolls back (`CLAUDE.md` §4 invariant 8).
 *
 * With `max: 10`, ten concurrent requests each hold one connection and each
 * wait for a second that only another of the ten can release. Nothing times
 * out, because `pg`'s default checkout wait is for ever. The pool is deadlocked
 * until the process restarts.
 *
 * It presented as "the API is not responding": every `/admin/*` call
 * `(pending)` with 0 bytes while its `OPTIONS` preflight answered 204 in 30 ms,
 * because preflight short-circuits in CORS middleware and never reaches the
 * database. `pg_stat_activity` showed it exactly — ten sessions
 * `idle in transaction`, `wait_event = ClientRead`, every one of them stuck at
 * the same instant on the statement immediately before an audit write.
 *
 * ## Why a guard and not just a review
 *
 * `StorageAuditRecorder`'s own header had reasoned about this and written down
 * the wrong bound: *"a pool of one would deadlock"*. The real bound is a pool of
 * **N** with N concurrent requests, which on this installation is ten people
 * opening the Mediathek — the screen asks for one signed URL per tile, so a
 * library with ten files deadlocks the platform on its own. That is `CLAUDE.md`
 * §9.10a: a comment that names one consequence of two is worse than none,
 * because it stops the next person looking.
 *
 * A rule nobody calls is not a rule (§9.3). So this is enforced at the moment
 * of acquisition, in the one place every acquisition passes through, and it
 * **throws** rather than warns: the call it refuses is a call that would have
 * hung, and a 500 naming the site is strictly better than a silent wedge.
 *
 * The legitimate second connection has not gone away — an audit row must
 * outlive the rollback of what it audits. It comes from `PG_SIDE_POOL`, a
 * separate pool the request pool cannot starve.
 */

import { AsyncLocalStorage } from "node:async_hooks";

/**
 * The pools whose connections the current async context is already holding.
 *
 * Keyed by the pool **object**, not by a name: two pools against the same
 * database are exactly the arrangement that makes the second acquisition safe,
 * so identity is the property that matters.
 */
const held = new AsyncLocalStorage<ReadonlySet<object>>();

export class PoolReentryError extends Error {
  constructor(site: string) {
    super(
      `${site}: this request already holds a connection from this pool. ` +
        `A second checkout from the same pool deadlocks it under concurrency ` +
        `(P142-01). Use PG_SIDE_POOL for work that must run outside the ` +
        `request transaction.`,
    );
    this.name = "PoolReentryError";
  }
}

/**
 * Throw if `pool` is already held by an enclosing `holdingPool` on this
 * request. Call it **before** `connect()`, so the refusal costs nothing.
 */
export function assertPoolNotHeld(pool: object, site: string): void {
  if (held.getStore()?.has(pool) === true) throw new PoolReentryError(site);
}

/** Run `work` with `pool` marked as held for everything it awaits. */
export function holdingPool<T>(pool: object, work: () => Promise<T>): Promise<T> {
  const next = new Set(held.getStore() ?? []);
  next.add(pool);
  return held.run(next, work);
}

/**
 * Whether this context holds `pool` — for tests and for a diagnostic, never as
 * a way to branch around the guard. A caller that needs to know whether it is
 * nested needs the side pool instead.
 */
export function poolIsHeld(pool: object): boolean {
  return held.getStore()?.has(pool) === true;
}

/**
 * Make a pool refuse a checkout from a context that already holds one of its
 * connections.
 *
 * Wrapping the **pool** rather than adding a check to four call sites is
 * `CLAUDE.md` §9.11: the hazard is "any second checkout", and `connect()` is
 * only half of it — `pool.query()` checks a connection out, runs one statement
 * and releases it, which deadlocks in exactly the same way and does not look
 * like it does at the call site. Enumerating the callers would have missed the
 * `pool.query` ones, and would go stale the first time somebody adds a fifth.
 *
 * Applied to `PG_POOL` alone. `PG_SIDE_POOL` is the sanctioned second
 * connection and must not refuse itself — though it is guarded against
 * re-entering *itself*, so a third level cannot appear unnoticed.
 */
export function guardReentry<T extends object>(pool: T, site: string): T {
  const target = pool as T & {
    connect: (...args: never[]) => unknown;
    query: (...args: never[]) => unknown;
  };

  for (const method of ["connect", "query"] as const) {
    const original = target[method].bind(target) as (...args: never[]) => unknown;
    target[method] = ((...args: never[]) => {
      assertPoolNotHeld(pool, `${site}.${method}`);
      return original(...args);
    }) as (typeof target)[typeof method];
  }

  return pool;
}
