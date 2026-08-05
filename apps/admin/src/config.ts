/**
 * Runtime configuration for the admin console.
 *
 * Read from Vite's `import.meta.env` at build time. Nothing secret is here and
 * nothing can be: this is a browser bundle, and a value shipped to a browser is
 * public whatever it is called.
 *
 * ## What used to be here
 *
 * A Keycloak issuer, client id and redirect URI. All three are gone with
 * P12-06: the console authenticates against its own staff plane (ADR-0012), so
 * there is no OIDC flow to configure and no customer realm the console depends
 * on being reachable. What is left is where the API is, and which project a
 * tenant-scoped screen acts within.
 *
 * The credential is an httpOnly cookie the API sets. It is not configured here
 * and cannot be read by anything here, which is the point of it.
 */

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

export function readConfig(): AdminConfig | undefined {
  const env = import.meta.env;

  const config: AdminConfig = {
    apiBase: env.VITE_API_BASE ?? "",
    projectSlug: env.VITE_PROJECT_SLUG ?? "",
  };

  // A missing value is a deployment mistake, and the console says so rather
  // than producing a wall of failed requests nobody can act on.
  const complete = Object.values(config).every((value) => value !== "");
  return complete ? config : undefined;
}
