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
import { APP_CONFIG, PG_POOL, REDIS_CLIENT } from "./tokens.js";
import { RateLimiter, RedisRateLimitStore } from "../shared/rate-limit.js";

@Global()
@Module({
  providers: [
    { provide: APP_CONFIG, useFactory: (): AppConfig => loadConfig() },
    {
      provide: PG_POOL,
      useFactory: (config: AppConfig) =>
        createPool({
          connectionString: config.DATABASE_URL,
          // Bounded so a leak (a missing client.release()) degrades instead of
          // exhausting Postgres connections outright.
          max: 10,
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
            new Logger("PgPool").error(
              `postgres connection lost while idle: ${error.message}`,
            );
          },
        }),
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
  exports: [APP_CONFIG, PG_POOL, REDIS_CLIENT, RateLimiter],
})
export class DbModule implements OnModuleDestroy {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /** Closes cleanly on shutdown so a redeploy does not orphan connections. */
  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([this.pool.end(), this.redis.quit()]);
  }
}
