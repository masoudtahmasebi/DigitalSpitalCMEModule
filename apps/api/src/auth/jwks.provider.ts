/**
 * JWKS resolution with a Redis cache and key-rotation handling (P1-03,
 * rewritten P247-03).
 *
 * ADR-0003 accepts that the API's availability is coupled to Keycloak's. This
 * is the mitigation: the JWK set is kept in memory for `JWKS_CACHE_TTL_SEC`,
 * written to Redis so a Keycloak outage does not immediately reject every
 * valid token, and an unknown `kid` triggers at most one refetch per cooldown
 * (so a flood of tokens with bogus kids cannot be used to hammer Keycloak).
 *
 * ## What P247-03 changed, and why
 *
 * The first version delegated fetching to `jose`'s `createRemoteJWKSet` and
 * then, after **every** successful verification, fetched the whole set a
 * second time to warm Redis (`void this.snapshot()`). That was one request to
 * Keycloak per authenticated API call (SEC-3), invisible to any test that
 * stubbed `fetchImpl`, because the second fetch used the global one.
 *
 * And on a failure of any kind it fell back to the Redis snapshot — including
 * the failure "Keycloak no longer publishes this key". A retired or revoked
 * key therefore kept verifying for up to the TTL after Keycloak dropped it.
 *
 * Now there is one fetch per TTL per issuer, and one in flight at a time. The
 * Redis snapshot is read **only when Keycloak cannot be reached** — an outage
 * is not a rotation, and a `kid` absent from a set just fetched is refused.
 */

import { createLocalJWKSet, errors, type JSONWebKeySet } from "jose";
import { withDeadline } from "../shared/deadline-fetch.js";
import type { KeyResolver } from "./token-verifier.js";

export interface JwksCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSec: number): Promise<void>;
}

export interface JwksProviderOptions {
  readonly jwksUri: string;
  readonly cacheTtlSec: number;
  readonly cacheKey?: string;
  /** Milliseconds since the epoch. Injectable so a test can move past the TTL. */
  readonly now?: () => number;
}

const DEFAULT_CACHE_KEY = "jwks:keycloak";

/**
 * How soon an unknown `kid` may cause another fetch.
 *
 * Keycloak publishes a new key before signing with it, so a genuinely new
 * `kid` is found by the first refetch; a token with an invented one must not
 * be a way to make the API fetch on every request.
 */
const UNKNOWN_KID_COOLDOWN_MS = 30_000;

/** On the token-validation path: an unreachable Keycloak must not hang a request. */
const FETCH_DEADLINE_MS = 5_000;

interface Snapshot {
  readonly resolve: KeyResolver;
  /** When it was fetched from Keycloak, or `undefined` if it came from Redis. */
  readonly fetchedAt: number | undefined;
}

export class JwksProvider {
  private readonly cacheKey: string;
  private readonly now: () => number;
  private snapshot: Snapshot | undefined;
  /** The one refresh in flight, shared by every caller that needs it. */
  private inflight: Promise<Snapshot> | undefined;
  private lastFetchAttempt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly cache: JwksCache,
    private readonly options: JwksProviderOptions,
    private readonly fetchImpl: typeof fetch = withDeadline(FETCH_DEADLINE_MS),
  ) {
    this.cacheKey = options.cacheKey ?? DEFAULT_CACHE_KEY;
    this.now = options.now ?? Date.now;
  }

  /**
   * A resolver over the current set: in memory while younger than the TTL,
   * fetched once when missing or stale, from Redis only while Keycloak is
   * unreachable.
   */
  async resolver(): Promise<KeyResolver> {
    return async (protectedHeader, token) => {
      const snapshot = await this.current();
      try {
        return await snapshot.resolve(protectedHeader, token);
      } catch (error) {
        // A `kid` this set does not hold. Possibly a key Keycloak has just
        // started signing with, so fetch again — once per cooldown, and only
        // through the same single in-flight refresh.
        if (
          !(error instanceof errors.JWKSNoMatchingKey) ||
          this.now() - this.lastFetchAttempt < UNKNOWN_KID_COOLDOWN_MS
        ) {
          throw error;
        }
        const refreshed = await this.refresh();
        return refreshed.resolve(protectedHeader, token);
      }
    };
  }

  private async current(): Promise<Snapshot> {
    const snapshot = this.snapshot;
    if (
      snapshot !== undefined &&
      snapshot.fetchedAt !== undefined &&
      this.now() - snapshot.fetchedAt < this.options.cacheTtlSec * 1000
    ) {
      return snapshot;
    }
    // A snapshot that came from Redis during an outage is retried no more often
    // than the unknown-kid cooldown, so an outage is not also a fetch storm.
    if (
      snapshot !== undefined &&
      snapshot.fetchedAt === undefined &&
      this.now() - this.lastFetchAttempt < UNKNOWN_KID_COOLDOWN_MS
    ) {
      return snapshot;
    }
    return this.refresh();
  }

  /** One refresh at a time; every concurrent caller awaits the same one. */
  private refresh(): Promise<Snapshot> {
    this.inflight ??= this.fetchSnapshot().finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }

  private async fetchSnapshot(): Promise<Snapshot> {
    this.lastFetchAttempt = this.now();

    let body: string;
    let set: JSONWebKeySet;
    try {
      const response = await this.fetchImpl(new URL(this.options.jwksUri));
      if (!response.ok) throw new Error(`JWKS answered ${String(response.status)}`);
      body = await response.text();
      set = JSON.parse(body) as JSONWebKeySet;
      const fresh: Snapshot = { resolve: createLocalJWKSet(set), fetchedAt: this.now() };
      this.snapshot = fresh;
      // Best-effort: Redis is the outage fallback, not the source of truth.
      await this.cache
        .set(this.cacheKey, body, this.options.cacheTtlSec)
        .catch(() => undefined);
      return fresh;
    } catch (fetchError) {
      // Keycloak unreachable, or answering nonsense. This — and only this — is
      // what the Redis snapshot is for.
      const cached = await this.fromCache();
      if (cached !== undefined) {
        this.snapshot = cached;
        return cached;
      }
      throw fetchError;
    }
  }

  private async fromCache(): Promise<Snapshot | undefined> {
    const raw = await this.cache.get(this.cacheKey).catch(() => null);
    if (raw === null) return undefined;
    try {
      return {
        resolve: createLocalJWKSet(JSON.parse(raw) as JSONWebKeySet),
        fetchedAt: undefined,
      };
    } catch {
      return undefined;
    }
  }
}
