/**
 * Per-issuer JWKS provider cache (P1-03).
 *
 * The platform is multi-tenant at the Keycloak level too: each project binds
 * its own realm (roadmap §3), so a single global JWKS endpoint is not enough —
 * a token from MEDICE's realm and one from a future customer's realm are
 * verified against different key sets. This registry keeps one `JwksProvider`
 * per issuer, created lazily, so each realm's keys are cached independently.
 *
 * The JWKS endpoint is derived from the issuer using Keycloak's standard
 * layout (`<issuer>/protocol/openid-connect/certs`). This is a convention, not
 * a guarantee from the OIDC spec — if a future realm needs a different
 * discovery mechanism, extend `ProjectBinding` with an explicit URI rather than
 * making this derivation cleverer.
 */

import { JwksProvider, type JwksCache } from "./jwks.provider.js";

export interface JwksRegistryOptions {
  readonly cacheTtlSec: number;
}

export class JwksRegistry {
  private readonly providers = new Map<string, JwksProvider>();

  constructor(
    private readonly cache: JwksCache,
    private readonly options: JwksRegistryOptions,
  ) {}

  forIssuer(issuer: string): JwksProvider {
    const existing = this.providers.get(issuer);
    if (existing !== undefined) return existing;

    const jwksUri = deriveJwksUri(issuer);
    const provider = new JwksProvider(this.cache, {
      jwksUri,
      cacheTtlSec: this.options.cacheTtlSec,
      cacheKey: `jwks:${issuer}`,
    });

    this.providers.set(issuer, provider);
    return provider;
  }
}

function deriveJwksUri(issuer: string): string {
  const normalised = issuer.endsWith("/") ? issuer.slice(0, -1) : issuer;
  return `${normalised}/protocol/openid-connect/certs`;
}
