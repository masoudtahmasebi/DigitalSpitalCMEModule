/**
 * How often the API asks Keycloak for its keys, and which keys it will still
 * accept (P247-03, closes SEC-3 and the audit's "revoked key" item).
 *
 * ## The defects
 *
 * 1. Every verified token triggered a JWKS fetch: the resolver called
 *    `void this.snapshot()` after each success, and `snapshot` fetched the
 *    whole set again to warm Redis. One request per authenticated API call,
 *    to Keycloak, for nothing.
 * 2. When Keycloak stopped publishing a key, a token signed with it failed
 *    against the live set — and was then verified against the Redis snapshot,
 *    which still held it, for up to `JWKS_CACHE_TTL_SEC`.
 *
 * ## Why a real HTTP server
 *
 * The extra fetch went through the global `fetch`, not the injected one, so a
 * stubbed `fetchImpl` would have counted one request and passed on the broken
 * code. A server counts every request whoever makes it (§9.1).
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import {
  exportJWK,
  generateKeyPair,
  jwtVerify,
  SignJWT,
  type CryptoKey,
  type JSONWebKeySet,
  type JWK,
} from "jose";
import { JwksProvider, type JwksCache } from "./jwks.provider.js";

const ISSUER = "https://kc.example.test/realms/test";
const TTL_SEC = 300;

let server: Server;
let jwksUri: string;
let requests = 0;
/** What the server publishes. Changed by a case to model a rotation. */
let published: JSONWebKeySet = { keys: [] };

let currentKey: CryptoKey;
let currentJwk: JWK;
let retiredKey: CryptoKey;
let retiredJwk: JWK;

beforeAll(async () => {
  const current = await generateKeyPair("RS256");
  currentKey = current.privateKey;
  currentJwk = { ...(await exportJWK(current.publicKey)), kid: "current", alg: "RS256" };
  const retired = await generateKeyPair("RS256");
  retiredKey = retired.privateKey;
  retiredJwk = { ...(await exportJWK(retired.publicKey)), kid: "retired", alg: "RS256" };

  server = createServer((_request, response) => {
    requests += 1;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(published));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  jwksUri = `http://127.0.0.1:${String(address.port)}/certs`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterEach(() => {
  requests = 0;
});

function memoryCache(initial: Record<string, string> = {}): JwksCache & {
  store: Map<string, string>;
} {
  const store = new Map(Object.entries(initial));
  return {
    store,
    get: async (key) => store.get(key) ?? null,
    set: async (key, value) => {
      store.set(key, value);
    },
  };
}

async function mint(key: CryptoKey, kid: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid })
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(key);
}

/** Let fire-and-forget work reach the server before counting. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 100));

describe("within the TTL", () => {
  it("ten verifications make at most one JWKS fetch", async () => {
    published = { keys: [currentJwk] };
    const provider = new JwksProvider(memoryCache(), { jwksUri, cacheTtlSec: TTL_SEC });
    const resolver = await provider.resolver();
    const token = await mint(currentKey, "current");

    for (let i = 0; i < 10; i += 1) {
      await jwtVerify(token, resolver, { issuer: ISSUER });
    }
    await settle();

    expect(requests).toBeLessThanOrEqual(1);
  });

  it("ten concurrent verifications on a cold provider share one fetch", async () => {
    // §11.10: a sequential test cannot show two refreshes racing.
    published = { keys: [currentJwk] };
    const provider = new JwksProvider(memoryCache(), { jwksUri, cacheTtlSec: TTL_SEC });
    const resolver = await provider.resolver();
    const token = await mint(currentKey, "current");

    await Promise.all(
      Array.from({ length: 10 }, () => jwtVerify(token, resolver, { issuer: ISSUER })),
    );
    await settle();

    expect(requests).toBe(1);
  });

  it("refreshes once the snapshot is older than the TTL", async () => {
    published = { keys: [currentJwk] };
    let now = 1_000_000;
    const provider = new JwksProvider(memoryCache(), {
      jwksUri,
      cacheTtlSec: TTL_SEC,
      now: () => now,
    });
    const resolver = await provider.resolver();
    const token = await mint(currentKey, "current");

    await jwtVerify(token, resolver, { issuer: ISSUER });
    now += TTL_SEC * 1000 + 1;
    await jwtVerify(token, resolver, { issuer: ISSUER });
    await settle();

    expect(requests).toBe(2);
  });
});

describe("a key Keycloak no longer publishes", () => {
  it("is refused, even though the Redis snapshot still holds it", async () => {
    // The snapshot another instance (or this one, before the rotation) wrote.
    const cache = memoryCache({
      [`jwks:test`]: JSON.stringify({ keys: [retiredJwk, currentJwk] }),
    });
    published = { keys: [currentJwk] };
    const provider = new JwksProvider(cache, {
      jwksUri,
      cacheTtlSec: TTL_SEC,
      cacheKey: "jwks:test",
    });
    const resolver = await provider.resolver();

    await expect(
      jwtVerify(await mint(retiredKey, "retired"), resolver, { issuer: ISSUER }),
    ).rejects.toThrow();
    // The current key still works.
    await expect(
      jwtVerify(await mint(currentKey, "current"), resolver, { issuer: ISSUER }),
    ).resolves.toBeTruthy();
  });

  it("is still served from the snapshot while Keycloak cannot be reached", async () => {
    // ADR-0003's mitigation, kept: an outage is not a rotation.
    const cache = memoryCache({ [`jwks:down`]: JSON.stringify({ keys: [currentJwk] }) });
    const provider = new JwksProvider(cache, {
      jwksUri: "http://127.0.0.1:1/certs",
      cacheTtlSec: TTL_SEC,
      cacheKey: "jwks:down",
    });
    const resolver = await provider.resolver();

    await expect(
      jwtVerify(await mint(currentKey, "current"), resolver, { issuer: ISSUER }),
    ).resolves.toBeTruthy();
  });
});
