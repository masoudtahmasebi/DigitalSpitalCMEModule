/**
 * The portal's API client.
 *
 * Everything network-facing goes through `@ds/sdk`, whose types come from
 * `contracts/openapi.yaml` — no component here calls `fetch`.
 *
 * Note what this client is *not*: it is not the one the widget uses. The widget
 * builds its own from the `api-base` and `project` attributes and the token
 * provider it was handed (ADR-0007). This one exists purely for the catalogue
 * screen, which is the portal's own. Two clients, one contract — and neither
 * knows anything the other does not.
 */

import { createClient, problemDetail, type ApiClient } from "@ds/sdk";
import type { PortalConfig } from "./config.js";

export function createPortalClient(
  config: PortalConfig,
  getToken: () => Promise<string | undefined>,
  onUnauthorized: () => Promise<string | undefined>,
): ApiClient {
  return createClient({
    baseUrl: config.apiBase,
    projectSlug: config.projectSlug,
    getToken,
    onUnauthorized,
  });
}

/**
 * A German sentence for a failure, without leaking internals.
 *
 * The `detail` extraction comes from `@ds/sdk`, which owns `ApiError`; the copy
 * stays here, because "the session expired" reads differently to a physician
 * mid-video and to an admin on a settings screen.
 */
export function describeError(error: unknown, generic: string): string {
  return problemDetail(error) ?? generic;
}

export { isNotFound, isUnauthenticated } from "@ds/sdk";
