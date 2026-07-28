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
  });
}

/** True when the element has everything it needs to talk to the API at all. */
export function isConfigured(config: WidgetConfig): boolean {
  return (
    config.apiBase !== "" && config.projectSlug !== "" && config.courseSlug !== ""
  );
}
