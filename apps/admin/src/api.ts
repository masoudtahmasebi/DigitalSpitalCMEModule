/**
 * The console's API clients.
 *
 * Everything network-facing goes through `@ds/sdk`, whose types come from
 * `contracts/openapi.yaml` — no component here calls `fetch`.
 *
 * ## Two clients, because there are two kinds of screen
 *
 * Since ADR-0012 the console authenticates with a staff session cookie rather
 * than a Keycloak bearer token. The cookie is httpOnly, so nothing here reads
 * it; what the client does carry is `credentials: "include"` and the CSRF
 * token, which is the half of the double-submit check the page is allowed to
 * know.
 *
 * The two differ in one header. Tenant screens send `X-DS-Customer`, which pins
 * which customer the request acts within. **Platform screens must not**: the
 * customer registry spans customers, and creating the first one has to work
 * before any customer exists — which is exactly the state a fresh installation
 * is in. A client that always sent one would 403 the one operator able to fix
 * that.
 *
 * ## Why a customer id and not a project slug (P22-03)
 *
 * It was a project slug, from `ADMIN_DEFAULT_PROJECT_SLUG` in the deployment.
 * Two things wrong with that, and the second is worse.
 *
 * The deployment named one project for the whole console, so a super
 * administrator could not act inside any other customer — and if the named
 * project did not exist, every tenant screen answered 404 while the platform
 * screens worked. That was reported from production, twice, and the second
 * time only because the first fix turned a misleading 401 into an honest 404.
 *
 * And **creating a project is itself a tenant-scoped write**. It needed a
 * project header, which needed a project. A customer with none had no way to
 * get one — which is every customer on the day it is created, and every fresh
 * installation.
 *
 * On a 401 there is no silent refresh. An opaque server-side session either
 * exists or does not; there is nothing to refresh with, and the honest
 * behaviour for an expired admin session is the login form.
 */

import { createClient, isForbidden, problemDetail, type ApiClient } from "@ds/sdk";
import { currentCsrfToken } from "./staff-auth.js";
import type { AdminConfig } from "./config.js";

export function createAdminClient(
  config: AdminConfig,
  customerId: string,
  onExpired: () => void,
): ApiClient {
  return staffClient(config.apiBase, customerId, onExpired);
}

/** For screens above any tenant — the customer registry (P12-04). */
export function createPlatformClient(
  config: AdminConfig,
  onExpired: () => void,
): ApiClient {
  return staffClient(config.apiBase, undefined, onExpired);
}

function staffClient(
  baseUrl: string,
  customerId: string | undefined,
  onExpired: () => void,
): ApiClient {
  return createClient({
    baseUrl,
    customerId,
    credentials: "include",
    getCsrfToken: currentCsrfToken,
    onUnauthorized: async () => {
      onExpired();
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
