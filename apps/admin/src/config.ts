/**
 * Runtime configuration for the admin console.
 *
 * Nothing secret is here and nothing can be: this is a browser bundle, and a
 * value shipped to a browser is public whatever it is called. The credential is
 * an httpOnly cookie the API sets — not configured here and not readable here,
 * which is the point of it.
 *
 * ## Read at runtime, not baked into the bundle (P16-02)
 *
 * `window.__DS_CONFIG__` comes from `/config.js`, written when the container
 * starts by `infra/nginx/ds-runtime-config.sh` from the environment the deploy
 * derives out of `BASE_DOMAIN`.
 *
 * It used to be `import.meta.env.VITE_API_BASE`, which Vite inlines at build
 * time. That made the image environment-specific — moving a domain meant a full
 * CI rebuild for a string, and the value lived in a GitHub repository *variable*
 * while the hostname it had to match lived in a GitHub *secret*, with nothing
 * checking the two agreed. When they disagreed the console loaded and every
 * request failed CORS: a browser-side failure with no server-side trace.
 *
 * `import.meta.env` survives as the **development** path only. `pnpm dev` has
 * no container to generate `/config.js`, and a dev server that needed one would
 * be a worse trade than this fallback.
 *
 * ## What used to be here
 *
 * A Keycloak issuer, client id and redirect URI. All three are gone with
 * P12-06: the console authenticates against its own staff plane (ADR-0012), so
 * there is no OIDC flow to configure and no customer realm the console depends
 * on being reachable.
 */

import { configValue, type RuntimeConfig } from "@ds/domain";

export interface AdminConfig {
  readonly apiBase: string;
  /**
   * Which project tenant-scoped screens act within, sent as `X-DS-Project`.
   *
   * The customer registry is above any tenant and deliberately does *not* send
   * it — see `createPlatformClient` in `api.ts`.
   */
  readonly projectSlug: string;
}

/**
 * `/config.js` assigns this. Declared once per app rather than in `@ds/domain`,
 * which is pure and must not know that a DOM exists.
 */
declare global {
  interface Window {
    __DS_CONFIG__?: RuntimeConfig;
  }
}

export function readConfig(): AdminConfig | undefined {
  const env = import.meta.env;
  const runtime = typeof window === "undefined" ? undefined : window.__DS_CONFIG__;

  const config: AdminConfig = {
    apiBase: configValue(runtime, "apiBase", env.VITE_API_BASE),
    projectSlug: configValue(runtime, "projectSlug", env.VITE_PROJECT_SLUG),
  };

  // A missing value is a deployment mistake, and the console says so rather
  // than producing a wall of failed requests nobody can act on.
  const complete = Object.values(config).every((value) => value !== "");
  return complete ? config : undefined;
}
