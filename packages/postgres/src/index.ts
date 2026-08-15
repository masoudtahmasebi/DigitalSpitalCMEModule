/**
 * The one place that knows how to open a Postgres pool without arming a
 * process-level crash (P76-04).
 *
 * ## What goes wrong without this
 *
 * `pg.Pool` keeps connections open and idle between queries. When the server
 * closes one of them — a failover, a restart, an administrator running
 * `pg_terminate_backend`, an idle-session timeout, a network device dropping a
 * quiet socket — the pool emits `'error'`.
 *
 * In Node, an `'error'` event on an `EventEmitter` with **no listener** is not
 * an ignored event: it is re-thrown as an uncaught exception. So a pool with no
 * `.on("error")` turns a routine and expected database event into a dead
 * process, at a moment when nothing was even being asked of the database. There
 * is no request to fail, no stack pointing at application code, and nothing in
 * the API log except the process going away.
 *
 * Every pool in this repository was built that way — eight of them, including
 * the long-lived one behind every API request. It surfaced first where it does
 * least harm: the migrator's own integration suite drops each throwaway
 * database with `WITH (FORCE)`, which terminates any backend still attached, and
 * the resulting `57P01` arrived after the tests had passed. CI went red with
 * twelve green tests and an "Unhandled Error", on a commit that had gone green
 * on the same code minutes earlier. A test that fails on timing is not evidence
 * either way (CLAUDE.md §9.1), and the same defect on the API's pool is an
 * outage rather than a flake.
 *
 * ## Why a shared factory rather than eight listeners
 *
 * Because the knowledge is *which* events must be handled and *why they are not
 * fatal*, and that is exactly the sort of thing that gets applied to seven sites
 * out of eight — the eighth being the one that matters. A pool obtained here
 * cannot be missing its handler, and a new caller gets the behaviour by
 * construction rather than by remembering.
 *
 * ## What it deliberately does not do
 *
 * It does not swallow query errors. Only *idle-client* failures reach this
 * handler; anything raised by a statement still rejects that statement's promise
 * and travels to its caller as before. Nor does it reconnect: `pg.Pool` already
 * discards the broken client and opens a fresh one on the next checkout. The
 * only thing missing was somebody listening.
 */

import pg from "pg";

/**
 * Where an idle-connection failure is reported.
 *
 * An argument rather than a `console.error`, because the API has structured
 * logging with correlation ids and a bare write to stderr in the middle of it
 * is an event nobody will find. Defaults to silence for tests and one-shot
 * tools, where the failure is expected and the noise is not.
 */
export type PoolErrorReporter = (error: Error) => void;

/**
 * Every `pg.PoolConfig` option, plus where to report an idle failure.
 *
 * Deliberately the whole of `PoolConfig` rather than the two fields the first
 * caller needed. A factory that models a subset is one somebody has to abandon
 * the moment they need `max` — and the way it gets abandoned is `new pg.Pool`,
 * which is the thing this package exists to stop. Making the safe call a
 * superset of the unsafe one means there is never a reason to reach past it.
 */
export type PoolOptions = pg.PoolConfig & {
  /**
   * Called when a pooled connection dies while idle.
   *
   * This is a report, not a decision: by the time it runs, `pg` has already
   * discarded the client, and the next checkout opens a new one. Handling it
   * means the process survives; logging it means somebody can see that the
   * database restarted under them.
   */
  readonly onIdleError?: PoolErrorReporter;
};

/**
 * A pool that cannot crash the process on an idle-connection failure.
 *
 * Use this everywhere instead of `new pg.Pool(...)`. The listener is attached
 * before the pool is returned, so there is no window in which a connection
 * could fail unobserved.
 */
export function createPool(options: PoolOptions): pg.Pool {
  const { onIdleError, ...config } = options;
  // The one legal `new pg.Pool` in the repository: the lint rule that forbids
  // it everywhere else points here, and this line is what makes the rule's
  // advice possible to follow.
  // eslint-disable-next-line no-restricted-syntax -- the sanctioned construction site
  const pool = new pg.Pool(config);
  attachIdleErrorHandler(pool, onIdleError);
  return pool;
}

/**
 * Arm a pool somebody else constructed.
 *
 * `createPool` is the way in; this exists for a pool that arrives from outside
 * — a library that builds its own, a test that needs the raw constructor to
 * demonstrate the unguarded behaviour. It is the same one implementation of the
 * handler either way, which is the part that must not be duplicated.
 */
export function attachIdleErrorHandler(
  pool: pg.Pool,
  onIdleError?: PoolErrorReporter,
): void {
  pool.on("error", (error: Error) => {
    onIdleError?.(error);
  });
}

/**
 * The same protection for a standalone `pg.Client`.
 *
 * A `Client` has the identical hazard and it is easier to miss, because a client
 * is usually opened for one statement and the code reads as if nothing could
 * happen after it. The migrator's test helpers open clients precisely to drop
 * databases out from under other connections, which is the case that proves the
 * point.
 */
export function attachClientErrorHandler(
  client: pg.Client,
  onError?: PoolErrorReporter,
): void {
  client.on("error", (error: Error) => {
    onError?.(error);
  });
}
