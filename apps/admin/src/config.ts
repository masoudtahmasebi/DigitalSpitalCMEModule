/**
 * Runtime configuration for the admin console.
 *
 * Read from Vite's `import.meta.env` at build time. There is nothing secret
 * here — a client id, an issuer URL and an API base are all public by
 * construction in a browser app, and the console holds no credential of its
 * own. The bearer token comes from Keycloak at runtime and never leaves memory
 * (see `auth.ts`).
 */

export interface AdminConfig {
  readonly apiBase: string;
  readonly projectSlug: string;
  readonly issuer: string;
  readonly clientId: string;
  readonly redirectUri: string;
}

export function readConfig(): AdminConfig | undefined {
  const env = import.meta.env;

  const config: AdminConfig = {
    apiBase: env.VITE_API_BASE ?? "",
    projectSlug: env.VITE_PROJECT_SLUG ?? "",
    issuer: env.VITE_KEYCLOAK_ISSUER ?? "",
    clientId: env.VITE_KEYCLOAK_CLIENT_ID ?? "",
    // Defaults to wherever the console is served from, which is what a
    // single-page app registered as one redirect URI wants.
    redirectUri: env.VITE_REDIRECT_URI ?? window.location.origin + "/",
  };

  // A missing value is a deployment mistake, and the console says so rather
  // than producing a wall of failed requests nobody can act on.
  const complete = Object.values(config).every((value) => value !== "");
  return complete ? config : undefined;
}
