/**
 * JWKS resolution with a Redis cache and key-rotation handling (P1-03).
 *
 * ADR-0003 accepts that the API's availability is coupled to Keycloak's. This
 * is the mitigation: the JWK set is cached in Redis so a brief Keycloak outage
 * does not immediately reject every valid token, and an unknown `kid` triggers a
 * single rate-limited refetch (so a flood of tokens with bogus kids cannot be
 * used to hammer Keycloak) before the key is treated as unknown.
 *
 * `jose`'s remote JWKS helper already does in-process caching and cooldown; the
 * Redis layer adds cross-instance sharing and outage tolerance on top.
 */

import { createLocalJWKSet, createRemoteJWKSet, type JSONWebKeySet } from "jose";
import type { KeyResolver } from "./token-verifier.js";

export interface JwksCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSec: number): Promise<void>;
}

export interface JwksProviderOptions {
  readonly jwksUri: string;
  readonly cacheTtlSec: number;
  readonly cacheKey?: string;
}

const DEFAULT_CACHE_KEY = "jwks:keycloak";

export class JwksProvider {
  private readonly remote: KeyResolver;
  private readonly cacheKey: string;

  constructor(
    private readonly cache: JwksCache,
    private readonly options: JwksProviderOptions,
    fetchImpl?: typeof fetch,
  ) {
    this.cacheKey = options.cacheKey ?? DEFAULT_CACHE_KEY;
    this.remote = createRemoteJWKSet(new URL(options.jwksUri), {
      // jose's own cooldown protects Keycloak from repeated fetches for the
      // same unknown kid within this window.
      cooldownDuration: 30_000,
      cacheMaxAge: options.cacheTtlSec * 1000,
      ...(fetchImpl ? { [Symbol.for("jose.fetch")]: fetchImpl } : {}),
    });
  }

  /**
   * A resolver that verifies against the live/remote JWKS, and refreshes the
   * Redis snapshot on success so other instances — and this one during a later
   * Keycloak outage — can fall back to it.
   */
  async resolver(): Promise<KeyResolver> {
    return async (protectedHeader, token) => {
      try {
        const key = await this.remote(protectedHeader, token);
        void this.snapshot();
        return key;
      } catch (remoteError) {
        // Keycloak is unreachable or the key is unknown. Try the cached set: a
        // warm cache keeps valid tokens working through a brief outage.
        const cached = await this.fromCache();
        if (cached !== undefined) {
          return cached(protectedHeader, token);
        }
        throw remoteError;
      }
    };
  }

  private async fromCache(): Promise<KeyResolver | undefined> {
    const raw = await this.cache.get(this.cacheKey);
    if (raw === null) return undefined;

    try {
      const set = JSON.parse(raw) as JSONWebKeySet;
      return createLocalJWKSet(set);
    } catch {
      return undefined;
    }
  }

  private async snapshot(): Promise<void> {
    // createRemoteJWKSet keeps the fetched set internally; re-fetch the raw JSON
    // once to store it, tolerating failure since it is only a cache warm.
    try {
      // A deadline, because this runs on the token-validation path (P141-01).
      //
      // `fetch` has no default timeout: an unreachable Keycloak does not fail
      // here, it **hangs**, and it hangs holding the request that triggered it.
      // Given P70-02 — this container had no egress at all for months and
      // nothing said so — that is not a hypothetical. Five seconds, and the
      // `catch` below already treats a failure as "cache not warmed".
      const response = await fetch(new URL(this.options.jwksUri), {
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) return;
      const body = await response.text();
      await this.cache.set(this.cacheKey, body, this.options.cacheTtlSec);
    } catch {
      // Best-effort only.
    }
  }
}
