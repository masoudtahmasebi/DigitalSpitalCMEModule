/**
 * Runtime configuration for the standalone portal.
 *
 * Nothing here is secret — a client id, an issuer URL and an API base are
 * public by construction in a browser app, and the portal holds no credential
 * of its own. The bearer token comes from Keycloak at runtime and never leaves
 * memory (`@ds/oidc`).
 *
 * ## Read at runtime, not baked into the bundle (P16-02)
 *
 * `window.__DS_CONFIG__` comes from `/config.js`, written when the container
 * starts by `infra/nginx/ds-runtime-config.sh` from the environment the deploy
 * derives out of `BASE_DOMAIN`. See `apps/admin/src/config.ts` for the full
 * account of why this stopped being a build-time value; the short version is
 * that an image which knows its own domain has to be rebuilt to move.
 *
 * `import.meta.env` survives as the **development** path only.
 *
 * `projectSlug` is the same `X-DS-Project` value a WordPress host would send.
 * The portal is a host surface like any other (ADR-0007) — it gets no special
 * standing with the API for being ours, and the API cannot tell the difference.
 */

import { configValue, type RuntimeConfig } from "@ds/domain";

/**
 * `/config.js` assigns this. Declared per app rather than in `@ds/domain`,
 * which is pure and must not know that a DOM exists.
 */
declare global {
  interface Window {
    __DS_CONFIG__?: RuntimeConfig;
  }
}

export interface PortalConfig {
  readonly apiBase: string;
  readonly projectSlug: string;
  readonly issuer: string;
  readonly clientId: string;
  readonly redirectUri: string;
}

export function readConfig(): PortalConfig | undefined {
  const env = import.meta.env;
  const runtime: RuntimeConfig | undefined =
    typeof window === "undefined" ? undefined : window.__DS_CONFIG__;

  const config: PortalConfig = {
    apiBase: configValue(runtime, "apiBase", env.VITE_API_BASE),
    projectSlug: configValue(runtime, "projectSlug", env.VITE_PROJECT_SLUG),
    issuer: configValue(runtime, "issuer", env.VITE_KEYCLOAK_ISSUER),
    clientId: configValue(runtime, "clientId", env.VITE_KEYCLOAK_CLIENT_ID),
    // Defaults to wherever the portal is served from, which is what a
    // single-page app registered as one redirect URI wants.
    redirectUri:
      configValue(runtime, "redirectUri", env.VITE_REDIRECT_URI) ||
      window.location.origin + "/",
  };

  // A missing value is a deployment mistake, and the portal says so rather than
  // producing a wall of failed requests nobody can act on.
  const complete = Object.values(config).every((value) => value !== "");
  return complete ? config : undefined;
}
