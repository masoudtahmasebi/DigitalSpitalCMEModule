/**
 * The learner identity port (P12-02), implementing ADR-0012's second plane.
 *
 * `AuthGuard` used to call `verifyToken` directly, which hard-wired Keycloak
 * into the one place every learner request passes through. Keycloak is MEDICE's
 * choice, not the platform's: the next customer may run Azure AD, another OIDC
 * provider, or SAML, and that has to be a per-project decision rather than a
 * fork.
 *
 * ## What the port deliberately does not abstract
 *
 * Only *verification*. Not login, not redirects, not token exchange — those
 * belong to the host page (ADR-0003: the API never participates in the
 * browser's authentication dance, it only judges the credential it is handed).
 * A port that tried to cover the whole flow would need to know about redirect
 * URIs and PKCE, and the API has no business with either.
 *
 * So the interface is one method. Everything a provider needs to decide is in
 * the binding row it is given.
 *
 * ## Why the registry throws on an unknown name rather than falling back
 *
 * A project naming a provider that does not exist is a configuration error, and
 * the safe failure is a refusal. Falling back to Keycloak would mean a typo in
 * one row silently authenticates learners against the wrong realm — which is
 * indistinguishable from working right up until somebody audits who signed in.
 */

import type { ProjectBinding } from "../modules/projects/project-binding.repository.js";
import type { JwksRegistry } from "./jwks-registry.js";
import {
  TokenInvalidError,
  verifyToken,
  type VerifiedIdentity,
} from "./token-verifier.js";

/** The names a `projects.identity_provider` row may hold. */
export type IdentityProviderName =
  /** OIDC against the project's own realm. The default, and MEDICE's. */
  | "keycloak"
  /**
   * A participant whose credential is this platform's (P25-02).
   *
   * Not a weakening of ADR-0012, which keeps the staff and learner planes
   * apart: this is the *learner* plane gaining a local option, with its own
   * tables and its own sessions. A customer with no identity provider could
   * not use the platform at all before, and "you must run a Keycloak realm"
   * is not a precondition anybody wants to sell.
   */
  | "local";

export interface IdentityProvider {
  readonly name: IdentityProviderName;
  /**
   * Verify a credential and return who presented it.
   *
   * Throws `TokenInvalidError` — or anything carrying a `reason` — when the
   * credential is not acceptable. The guard turns that into a 401 and an audit
   * entry; a provider must never return an unverified identity.
   */
  verify(credential: string, binding: ProjectBinding): Promise<VerifiedIdentity>;
}

/**
 * OIDC/JWT verification against a JWKS endpoint — signature, issuer, audience
 * and expiry, exactly as ADR-0003 requires.
 *
 * Named for Keycloak because that is what it is configured against today, but
 * nothing in it is Keycloak-specific: any OIDC provider publishing a JWKS
 * document works. A second customer on Azure AD would most likely *reuse* this
 * class with a different binding rather than write a new one — which is a good
 * sign about where the seam was cut.
 */
export class KeycloakIdentityProvider implements IdentityProvider {
  readonly name = "keycloak" as const;

  constructor(
    private readonly jwksRegistry: JwksRegistry,
    private readonly clockToleranceSec: number,
  ) {}

  async verify(credential: string, binding: ProjectBinding): Promise<VerifiedIdentity> {
    // Unreachable through `ProjectBindingRepository.resolve`, which already
    // answers `undefined` for a federating project with no binding — but that
    // is a guarantee made in another file, and this class is public. Refusing
    // is the only safe branch: continuing with a placeholder issuer would build
    // a JWKS URL out of the empty string and compare `iss` against it.
    const keycloak = binding.keycloak;
    if (keycloak === undefined) {
      throw new TokenInvalidError("provider_misconfigured");
    }

    const jwks = this.jwksRegistry.forIssuer(keycloak.issuer);
    return verifyToken(credential, await jwks.resolver(), {
      issuer: keycloak.issuer,
      audience: keycloak.audience,
      clockToleranceSec: this.clockToleranceSec,
    });
  }
}

export class UnknownIdentityProviderError extends Error {
  constructor(readonly requested: string) {
    super(`no identity provider named "${requested}" is registered`);
    this.name = "UnknownIdentityProviderError";
  }
}

/**
 * Chooses the provider a project's binding names.
 *
 * Built from a list rather than a hard-coded switch so registering a second one
 * is a change to the composition root and nothing else — which is the property
 * P12-02 exists to give.
 */
export class IdentityProviderRegistry {
  private readonly byName: ReadonlyMap<string, IdentityProvider>;

  constructor(providers: readonly IdentityProvider[]) {
    if (providers.length === 0) {
      // A registry with nothing in it authenticates nobody, and the failure
      // would present as every project being misconfigured rather than as the
      // wiring mistake it is.
      throw new Error("IdentityProviderRegistry needs at least one provider");
    }
    this.byName = new Map(providers.map((provider) => [provider.name, provider]));
  }

  forBinding(binding: ProjectBinding): IdentityProvider {
    const provider = this.byName.get(binding.identityProvider);
    if (provider === undefined) {
      throw new UnknownIdentityProviderError(binding.identityProvider);
    }
    return provider;
  }

  /** The names this registry can serve, for the boot check below. */
  registeredNames(): readonly string[] {
    return [...this.byName.keys()].sort();
  }
}

/**
 * Refuse to start if the schema permits a provider no class implements.
 *
 * `forBinding` throwing is the last line of defence, and by then it is a 401 on
 * a live request — one project's learners locked out, with an audit reason
 * nobody is reading until somebody complains. The failure belongs at boot,
 * where it is one loud line in a deploy log and the previous container is still
 * serving.
 *
 * ## Why this reads the constraint and not the rows
 *
 * `SELECT DISTINCT identity_provider FROM projects` would only catch the
 * mistake once a project actually used the value, which is exactly the "at
 * first request" timing this exists to avoid. The `CHECK` constraint is the
 * schema's declaration of what is *permitted*, so comparing against it catches
 * a migration that widened the set without shipping the class — the real drift
 * — before any row exists.
 *
 * Reading `pg_constraint` needs no tenant context and no RLS exemption: it is
 * catalogue metadata, not tenant data.
 */
export async function assertProvidersCoverSchema(
  registry: IdentityProviderRegistry,
  query: (sql: string) => Promise<{ rows: { allowed: string }[] }>,
): Promise<void> {
  const { rows } = await query(`
    SELECT unnest(
             regexp_matches(pg_get_constraintdef(c.oid), '''([^'']+)''', 'g')
           ) AS allowed
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'projects'
      AND c.conname = 'projects_identity_provider_check'
  `);

  if (rows.length === 0) {
    throw new Error(
      "projects_identity_provider_check is missing: migration 0019 has not been applied",
    );
  }

  const registered = new Set(registry.registeredNames());
  const unimplemented = rows.map((row) => row.allowed).filter((n) => !registered.has(n));

  if (unimplemented.length > 0) {
    throw new Error(
      `projects.identity_provider permits ${unimplemented.join(", ")}, but no ` +
        `IdentityProvider is registered for ${unimplemented.length === 1 ? "it" : "them"}. ` +
        `Registered: ${[...registered].join(", ")}. Register the class in AuthModule, ` +
        `or narrow the CHECK constraint.`,
    );
  }
}
