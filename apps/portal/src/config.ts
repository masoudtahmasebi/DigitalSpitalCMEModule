/**
 * Runtime configuration for the standalone portal.
 *
 * Read from Vite's `import.meta.env` at build time. Nothing here is secret — a
 * client id, an issuer URL and an API base are public by construction in a
 * browser app, and the portal holds no credential of its own. The bearer token
 * comes from Keycloak at runtime and never leaves memory (`@ds/oidc`).
 *
 * `projectSlug` is the same `X-DS-Project` value a WordPress host would send.
 * The portal is a host surface like any other (ADR-0007) — it gets no special
 * standing with the API for being ours, and the API cannot tell the difference.
 */

export interface PortalConfig {
  readonly apiBase: string;
  readonly projectSlug: string;
  readonly issuer: string;
  readonly clientId: string;
  readonly redirectUri: string;
}

export function readConfig(): PortalConfig | undefined {
  const env = import.meta.env;

  const config: PortalConfig = {
    apiBase: env.VITE_API_BASE ?? "",
    projectSlug: env.VITE_PROJECT_SLUG ?? "",
    issuer: env.VITE_KEYCLOAK_ISSUER ?? "",
    clientId: env.VITE_KEYCLOAK_CLIENT_ID ?? "",
    // Defaults to wherever the portal is served from, which is what a
    // single-page app registered as one redirect URI wants.
    redirectUri: env.VITE_REDIRECT_URI ?? window.location.origin + "/",
  };

  // A missing value is a deployment mistake, and the portal says so rather than
  // producing a wall of failed requests nobody can act on.
  const complete = Object.values(config).every((value) => value !== "");
  return complete ? config : undefined;
}
