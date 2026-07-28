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

import { ApiError, createClient, type ApiClient } from "@ds/sdk";
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
 * `detail` on a problem document is the message the API wrote for a person to
 * read; it carries no identifiers or stack traces by construction
 * (`problem-details.ts`). Anything else gets the generic line.
 */
export function describeError(error: unknown, generic: string): string {
  if (error instanceof ApiError) {
    if (error.problem.status === 403) return generic;
    if (error.problem.detail !== undefined && error.problem.detail !== "") {
      return error.problem.detail;
    }
  }
  return generic;
}

export function isForbidden(error: unknown): boolean {
  return error instanceof ApiError && error.problem.status === 403;
}

export function isUnauthenticated(error: unknown): boolean {
  return error instanceof ApiError && error.problem.status === 401;
}
