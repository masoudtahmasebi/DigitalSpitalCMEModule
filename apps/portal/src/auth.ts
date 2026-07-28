/**
 * Keycloak login for the portal (P11-01, ADR-0003).
 *
 * The flow is `@ds/oidc`, shared with the admin console. What is portal-
 * specific is the **token provider** below, which is the contract every host
 * adapter has to satisfy (ADR-0007, contract 2): an async function returning a
 * currently-valid bearer token.
 *
 * That is the whole of what makes this a host. WordPress satisfies the same
 * contract by calling a nonce-protected REST endpoint that mints a token from
 * the WP session cookie; the portal satisfies it by holding a token it obtained
 * from Keycloak itself. The widget cannot tell the two apart, and neither can
 * the API — which validates the token against JWKS regardless, because nothing
 * a host says about who the user is is believed (CLAUDE.md §4 invariant 2).
 */

import { createOidcClient, type OidcClient, type Session } from "@ds/oidc";
import type { PortalConfig } from "./config.js";

export type { Session };

export function createAuth(config: PortalConfig): OidcClient {
  return createOidcClient({
    issuer: config.issuer,
    clientId: config.clientId,
    redirectUri: config.redirectUri,
    // Distinct from the console's, so a developer running both on localhost
    // does not have one flow's PKCE verifier overwritten by the other's.
    storagePrefix: "ds-portal",
  });
}

/**
 * What `<ds-lms>` is handed.
 *
 * `refresh` is passed by the widget after a 401, at most once per failure. The
 * portal answers it by sending the browser back through Keycloak rather than by
 * silently renewing: it holds no refresh token, deliberately — a refresh token
 * in a browser is a long-lived credential in the one place we have decided not
 * to keep credentials.
 *
 * A 25-minute video outliving a 5-minute access token is the expected case, not
 * an edge case (docs/show-stoppers.md S2). Keycloak's own SSO cookie means the
 * round trip is usually invisible; what the learner loses is their scroll
 * position, not their progress, because progress is recorded server-side as it
 * happens.
 */
export function tokenProviderFor(
  auth: OidcClient,
): (request: { readonly refresh: boolean }) => Promise<string | undefined> {
  return async ({ refresh }) => {
    const session = auth.currentSession();
    if (session !== undefined && !refresh) return session.accessToken;

    // No usable token. `beginLogin` navigates away and never resolves, so
    // nothing after this line runs.
    await auth.beginLogin();
    return undefined;
  };
}
