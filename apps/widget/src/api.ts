/**
 * The widget's one API client (P5-02).
 *
 * Everything network-facing goes through `@ds/sdk`, whose types are generated
 * from `contracts/openapi.yaml`. No component calls `fetch`. That is what makes
 * a contract change a compile error here rather than a runtime surprise on a
 * physician's screen.
 */

import { createClient, type ApiClient } from "@ds/sdk";
import type { TokenProvider } from "./token.js";

export interface WidgetConfig {
  readonly apiBase: string;
  readonly projectSlug: string;
  /**
   * Optional. With a slug the widget opens that course directly, which is how
   * MEDICE embeds it on a page dedicated to one Fortbildung. Without one it
   * opens the catalogue, which is what a host page that lists several needs.
   */
  readonly courseSlug: string;
}

export function createWidgetClient(
  config: WidgetConfig,
  getToken: TokenProvider,
): ApiClient {
  return createClient({
    baseUrl: config.apiBase,
    projectSlug: config.projectSlug,
    getToken: () => getToken({ refresh: false }),
    // Exactly one refresh per 401, enforced by the SDK — see its `isRetry`.
    onUnauthorized: () => getToken({ refresh: true }),
    /*
     * Send the participant session cookie when there is one (P25-02).
     *
     * Needed because a project whose `identity_provider` is `local` has no
     * bearer token at all — the credential is an httpOnly cookie, and without
     * this the browser simply does not attach it, so every request 401s while
     * the sign-in that produced it looks like it worked.
     *
     * Safe cross-origin only because `configure-app.ts` pairs
     * `Access-Control-Allow-Credentials: true` with an explicit origin
     * allowlist, never a wildcard — the fetch specification forbids the
     * combination that would be dangerous.
     *
     * It changes nothing for a WordPress embed. That is cross-*site*, and the
     * cookie is `SameSite=Lax`, so the browser withholds it there regardless;
     * those requests keep authenticating with the bearer token they always did.
     */
    credentials: "include",
  });
}

/**
 * True when the element has everything it needs to talk to the API at all.
 *
 * `courseSlug` is deliberately not required: an embed with no course attribute
 * is a catalogue, not a misconfiguration. The two values that *are* required
 * are the ones without which no request can be made — the API's address and
 * the project binding that resolves the tenant and the Keycloak realm.
 */
export function isConfigured(config: WidgetConfig): boolean {
  return config.apiBase !== "" && config.projectSlug !== "";
}
