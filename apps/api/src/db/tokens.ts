/**
 * DI tokens for infrastructure singletons that have no natural class identity
 * to inject by (a `pg.Pool`, an `ioredis.Redis` client, the parsed config).
 */
export const PG_POOL = Symbol("PG_POOL");

/**
 * A second, small pool for work that must run **outside** the request's RLS
 * transaction — today, the audit log and the customer-administration
 * repository (P142-01).
 *
 * It exists because those callers hold a `PG_POOL` connection for the whole
 * request (`TenantTransactionInterceptor`) and then need another. Taken from
 * the same pool, N concurrent requests deadlock a pool of N and the API stops
 * answering until it is restarted; taken from a pool the request path never
 * touches, they cannot starve each other.
 *
 * Deliberately separate rather than "make `max` bigger": a larger pool moves
 * the deadlock's threshold, it does not remove it.
 */
export const PG_SIDE_POOL = Symbol("PG_SIDE_POOL");
export const REDIS_CLIENT = Symbol("REDIS_CLIENT");
export const APP_CONFIG = Symbol("APP_CONFIG");
