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

/**
 * The token provider for a tenant whose participants sign in *here* (P25-02).
 *
 * It returns `undefined`, always, and that is the whole implementation. The
 * credential for such a tenant is an httpOnly cookie the SDK attaches itself
 * (`credentials: "include"` in `apps/widget/src/api.ts`); there is no bearer
 * token, there never will be one, and the request authenticates perfectly well
 * without one.
 *
 * ## Why it is a separate function rather than a branch above
 *
 * `tokenProviderFor` calls `beginLogin()` when it has no token — an OIDC
 * redirect to the tenant's realm. For a local tenant there is no realm to
 * redirect to, and the first browser run of this feature showed exactly what
 * that costs: the participant signed in, the page said "Abmelden", and the
 * catalogue was **empty with no error**, because the widget was waiting on a
 * provider that had gone off to start a login instead of simply saying "no
 * token, use the cookie". `GET /courses` was never sent at all.
 *
 * `refresh` is ignored for the same reason. A 401 here means the session
 * expired or was revoked, and the answer to that is signing in again — which
 * the shell offers as soon as `/auth/participant/me` says so. Silently
 * renewing a session the API deliberately ended is not a refresh, it is a
 * bypass.
 */
export function cookieTokenProvider(): () => Promise<undefined> {
  return async () => undefined;
}
