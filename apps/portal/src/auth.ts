/**
 * How the portal supplies the widget a credential (P11-01, ADR-0007).
 *
 * ## What this file used to be, and why it is not any more
 *
 * It held an OIDC client. The portal ran its own authorization-code flow
 * against a `PORTAL_KEYCLOAK_ISSUER` in `config.env`, and that was wrong in
 * three separate ways:
 *
 * 1. **It was a second route into a customer's identity.** MEDICE signs
 *    learners in from a form on their own site, through the WordPress plugin,
 *    against their Keycloak with a client secret the plugin holds. The portal
 *    redirecting to the same realm was a flow they never asked us to run, and
 *    the one it produced dropped a visitor on a Keycloak page with no way back.
 * 2. **It made the deployment know a customer's realm.** An installation
 *    serving several customers has several realms; one issuer in one env file
 *    can only ever be right for one of them. Which realm a project uses is a
 *    fact about the *project*, and lives on the project row (P17-02).
 * 3. **It had already stopped running.** Since P21-03 the portal reads how a
 *    tenant signs in from `GET /tenants/{slug}` and, for a federated one, shows
 *    a **link** to the customer's own login. Nothing calls `beginLogin()`. The
 *    client was constructed on every render, carried two configuration
 *    variables, and could not be reached.
 *
 * So the flow is gone and the two variables with it. What remains is the one
 * contract a host adapter actually owes the widget (ADR-0007, contract 2): an
 * async function returning a currently-valid bearer token, or `undefined`.
 *
 * ## Why `undefined` is a complete answer
 *
 * A local participant's credential is an httpOnly cookie the SDK attaches
 * itself (`credentials: "include"` in `apps/widget/src/api.ts`). There is no
 * bearer token, there never will be one, and the request authenticates
 * perfectly well without one.
 *
 * A federated participant does not reach the widget through this host at all —
 * they use the customer's own site, where the WordPress plugin is the host
 * adapter and supplies a real token. That the widget cannot tell the two hosts
 * apart is the property ADR-0007 exists to keep.
 */

/**
 * The portal's token provider: there is no bearer token here.
 *
 * A function rather than a constant `undefined`, because the widget's
 * `TokenProvider` contract is a callable and a host that satisfied it with a
 * value would be a host the widget had to special-case.
 *
 * It ignores `refresh`. A 401 means the session expired or was revoked, and the
 * answer to that is signing in again — which the shell offers as soon as
 * `GET /auth/participant/me` says so. Silently renewing a session the API
 * deliberately ended would be a bypass rather than a refresh.
 */
export function cookieTokenProvider(): () => Promise<undefined> {
  return async () => undefined;
}
