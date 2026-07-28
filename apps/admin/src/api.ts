/**
 * The console's API client.
 *
 * Everything network-facing goes through `@ds/sdk`, whose types come from
 * `contracts/openapi.yaml` — no component here calls `fetch`.
 *
 * The token comes from `auth.ts` and is held only in memory. On a 401 the
 * console does not attempt a silent refresh: it sends the user back through
 * Keycloak, which is both simpler and the honest behaviour for an admin
 * session that has genuinely expired.
 */

import { createClient, isForbidden, problemDetail, type ApiClient } from "@ds/sdk";
import { currentSession } from "./auth.js";
import type { AdminConfig } from "./config.js";

export function createAdminClient(config: AdminConfig, onExpired: () => void): ApiClient {
  return createClient({
    baseUrl: config.apiBase,
    projectSlug: config.projectSlug,
    getToken: async () => currentSession()?.accessToken,
    onUnauthorized: async () => {
      onExpired();
      // No refreshed token, so the SDK does not retry — the user is being sent
      // to the login screen instead.
      return undefined;
    },
  });
}

/**
 * A German sentence for a failure, without leaking internals.
 *
 * The predicates and the `detail` extraction come from `@ds/sdk`, which owns
 * `ApiError`; what stays here is the copy, because an admin on a settings
 * screen and a physician mid-video need different words for the same status.
 *
 * A 403 gets the generic line on purpose: the API's own detail for a refused
 * admin action is written for a developer reading a log, and telling an admin
 * which role they lack is more than they need to act on it.
 */
export function describeError(error: unknown, generic: string): string {
  if (isForbidden(error)) return generic;
  return problemDetail(error) ?? generic;
}

// Re-exported so components import their failure vocabulary from one place
// rather than reaching into the SDK for some of it and this file for the rest.
export { isForbidden, isUnauthenticated } from "@ds/sdk";
