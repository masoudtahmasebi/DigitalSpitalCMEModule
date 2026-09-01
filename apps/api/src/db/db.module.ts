/**
 * Infrastructure singletons: the PostgreSQL pool and the Redis client.
 *
 * `@Global()` because every feature module needs the pool (directly, or
 * indirectly via a request-scoped repository) — repeating the import on every
 * module would be pure ceremony. This is the one deliberate exception to
 * "explicit imports everywhere"; nothing else in the app is global.
 *
 * The pool connects as `ds_app` (`DATABASE_URL`), never `ds_migrator`
 * (ADR-0002) — migrations run separately, out of band of the running API.
 */

import { Global, Inject, Logger, Module, type OnModuleDestroy } from "@nestjs/common";
import type { Pool } from "pg";
import { createPool } from "@ds/postgres";
import Redis from "ioredis";
import { loadConfig, type AppConfig } from "../config/config.js";
import { APP_CONFIG, PG_POOL, PG_SIDE_POOL, REDIS_CLIENT } from "./tokens.js";
import { RateLimiter, RedisRateLimitStore } from "../shared/rate-limit.js";
import { guardReentry } from "./pool-reentry.js";

/**
 * One set of pool settings, shared by both pools (P142-01).
 *
 * Only `max` and the log name differ. A second pool that quietly lacked the
 * idle-error handler or the deadlines would be exactly the
 * most-armed-and-one-not drift `createPool` exists to prevent — one pool
 * surviving a failover while the other ends the process is a worse bug than the
 * one this separation fixes.
 */
function pgPool(config: AppConfig, options: { max: number; name: string }) {
  return guardReentry(
    createPool({
      connectionString: config.DATABASE_URL,
      // Bounded so a leak (a missing client.release()) degrades instead of
      // exhausting Postgres connections outright.
      max: options.max,

      /*
       * Deadlines, because a request that cannot be served must **fail**
       * rather than hang (P141-01).
       *
       * `max: 10` bounded the pool and its comment said that made a leak
       * "degrade". It did not. `pg`'s default `connectionTimeoutMillis` is
       * **0 — wait for ever** — so once those ten were busy or blocked,
       * the next caller waited with no error, no log line and no end.
       *
       * What blocked them is P142 and is fixed there: a handler holding the
       * request transaction asks the same pool for a **second** connection
       * to write the audit row, so ten concurrent requests deadlock. This
       * is the backstop, not the fix — but it is the difference between a
       * 22-hour silent outage and a 500 with a reason.
       *
       * That is what the client saw twice. The browser showed `(pending)`
       * with 0 bytes on every `/admin/*` call while the `OPTIONS` preflight
       * for the same path answered 204 in 30 ms — preflight short-circuits
       * in CORS middleware and never reaches the database. It is also why
       * the container sat `unhealthy` for 22 hours: `/health` runs
       * `SELECT 1`, which hung, so the probe timed out while Caddy, the
       * static bundles and the object storage carried on.
       *
       * A hang is worse than an error in three separate ways, and all three
       * happened: nothing is logged, so there is no evidence afterwards;
       * the connection is held, so the next request inherits the problem;
       * and the browser spends one of its six sockets per origin on it, so
       * a handful of stuck calls take down every screen rather than one.
       *
       * The three limits answer three different questions, and none
       * substitutes for another:
       */

      /** How long to wait for a free connection before giving up. */
      connectionTimeoutMillis: 5_000,

      /**
       * How long **the server** lets one statement run. Enforced by
       * Postgres, so it applies to a query blocked on a lock — which a
       * client-side timer cannot cancel, only stop waiting for.
       *
       * Thirty seconds rather than the five a query should take: this is a
       * backstop against a wedge, not a performance budget. A number tight
       * enough to be interesting is a number that eventually fails a CSV
       * export at month end, and a limit somebody raises in an incident is
       * a limit that is not there.
       */
      statement_timeout: 30_000,

      /**
       * And how long a transaction may sit open doing nothing.
       *
       * Two minutes, deliberately loose, because the RLS transaction wraps
       * the **whole request** (`TenantTransactionInterceptor`) — so it is
       * legitimately idle-in-transaction for as long as a handler is
       * talking to object storage, and assembling a 2 GB multipart upload
       * is not fast. Tighter than this kills a real upload; absent, an
       * abandoned `BEGIN` holds its locks until the process dies.
       */
      idle_in_transaction_session_timeout: 120_000,
      /*
       * Without this the API dies whenever Postgres closes an idle
       * connection (P76-04).
       *
       * A pooled connection sitting idle can be closed by the server at any
       * time — a failover, a restart, an idle-session timeout, a firewall
       * dropping a quiet socket. `pg.Pool` reports that by emitting
       * `'error'`, and in Node an `'error'` event with **no listener** is
       * re-thrown as an uncaught exception. So a routine database event
       * became a dead API process, with no failing request to point at it
       * and nothing in the log but the process ending.
       *
       * It is a report, not a decision: `pg` has already discarded the
       * broken client and the next checkout opens a fresh one. Logged at
       * `error` because a database restarting under the API is worth
       * seeing, and through Nest's logger so it joins the structured stream
       * rather than landing on stderr where nothing collects it.
       *
       * `createPool` rather than `new Pool` so that the pools in this
       * repository cannot drift into most-armed-and-one-not.
       */
      onIdleError: (error) => {
        new Logger(options.name).error(
          `postgres connection lost while idle: ${error.message}`,
        );
      },
    }),
    options.name,
  );
}

@Global()
@Module({
  providers: [
    { provide: APP_CONFIG, useFactory: (): AppConfig => loadConfig() },
    {
      provide: PG_POOL,
      useFactory: (config: AppConfig) => pgPool(config, { max: 10, name: "PgPool" }),
      inject: [APP_CONFIG],
    },
    {
      /*
       * The side pool (P142-01): connections for work that must run outside
       * the request's RLS transaction, taken from somewhere the request path
       * cannot starve.
       *
       * `max: 8` because it carries more than the audit log: participant
       * sign-in and the participant/identity repositories run here too, since
       * `users`, `user_identities` and `learner_credentials` are not
       * tenant-scoped and are read before any tenant is known. Its total with
       * `PG_POOL` is what Postgres sees per API process — 18, against a
       * default `max_connections` of 100.
       *
       * A caller belongs here only if it genuinely needs a second connection:
       * because its write must outlive the rollback of what it audits, or
       * because it must act in a different tenant than the request's. "It was
       * convenient" is how this pool becomes the next deadlock.
       */
      provide: PG_SIDE_POOL,
      useFactory: (config: AppConfig) => pgPool(config, { max: 8, name: "PgSidePool" }),
      inject: [APP_CONFIG],
    },
    {
      provide: REDIS_CLIENT,
      useFactory: (config: AppConfig) =>
        new Redis(config.REDIS_URL, { maxRetriesPerRequest: 3 }),
      inject: [APP_CONFIG],
    },
    {
      // Shares the Redis client: the limit must hold across instances, so an
      // in-process counter would multiply it by the replica count.
      provide: RateLimiter,
      useFactory: (redis: Redis) => new RateLimiter(new RedisRateLimitStore(redis)),
      inject: [REDIS_CLIENT],
    },
  ],
  exports: [APP_CONFIG, PG_POOL, PG_SIDE_POOL, REDIS_CLIENT, RateLimiter],
})
export class DbModule implements OnModuleDestroy {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(PG_SIDE_POOL) private readonly sidePool: Pool,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /** Closes cleanly on shutdown so a redeploy does not orphan connections. */
  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([this.pool.end(), this.sidePool.end(), this.redis.quit()]);
  }
}
