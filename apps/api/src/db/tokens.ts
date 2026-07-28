/**
 * DI tokens for infrastructure singletons that have no natural class identity
 * to inject by (a `pg.Pool`, an `ioredis.Redis` client, the parsed config).
 */
export const PG_POOL = Symbol("PG_POOL");
export const REDIS_CLIENT = Symbol("REDIS_CLIENT");
export const APP_CONFIG = Symbol("APP_CONFIG");
