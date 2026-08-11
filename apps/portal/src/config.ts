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
 * ## What is deliberately *not* here any more (P21-03)
 *
 * `projectSlug`. It used to name the one customer this portal was, which made
 * `fortbildung.digitalspital.com` MEDICE's front door and left no way to reach
 * anybody else through it. The tenant now comes from the first path segment,
 * and travels to the API as the same `X-DS-Project` value a WordPress host
 * would send — the portal is a host surface like any other (ADR-0007), and gets
 * no special standing for being ours.
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
  readonly redirectUri: string;
}

export function readConfig(): PortalConfig | undefined {
  const env = import.meta.env;
  const runtime: RuntimeConfig | undefined =
    typeof window === "undefined" ? undefined : window.__DS_CONFIG__;

  const config: PortalConfig = {
    apiBase: configValue(runtime, "apiBase", env.VITE_API_BASE),
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

/**
 * The commit this bundle was built from, for the footer (P46-01).
 *
 * **Deliberately not a field of `PortalConfig`.** `readConfig` returns
 * `undefined` when any value is empty and the portal renders "misconfigured",
 * which is right for `apiBase` and wrong for a diagnostic: there is no
 * `DS_COMMIT` under `pnpm dev`, and a portal that refused to render because it
 * did not know its own version would be P44-01 in a second place.
 */
export function buildCommit(): string | undefined {
  return typeof window === "undefined" ? undefined : window.__DS_CONFIG__?.commit;
}
