/**
 * Redis-backed `JwksCache` (P1-03).
 *
 * Thin adapter — the caching *policy* (what to store, when to refresh, the
 * cooldown against hammering Keycloak) lives in `JwksProvider`. This class only
 * knows how to get and set a string in Redis with a TTL.
 */

import type { Redis } from "ioredis";
import type { JwksCache } from "./jwks.provider.js";

export class RedisJwksCache implements JwksCache {
  constructor(private readonly redis: Redis) {}

  async get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async set(key: string, value: string, ttlSec: number): Promise<void> {
    await this.redis.set(key, value, "EX", ttlSec);
  }
}
