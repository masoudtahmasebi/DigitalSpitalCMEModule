/**
 * Keycloak login for the admin console (P9-01).
 *
 * Authorization Code with PKCE (RFC 7636), for a public client. Hand-written
 * rather than pulled from a library: the flow is about a hundred lines, and the
 * part that actually decides anything — whether a token is real — happens
 * server-side against JWKS (ADR-0003). Nothing here is trusted by the API.
 *
 * ## The token is never persisted
 *
 * Not in `localStorage`, not in `sessionStorage`, not in a cookie. It lives in
 * a module-scoped variable for the lifetime of the tab and nowhere else.
 *
 * The usual argument for `sessionStorage` is surviving a page reload. The cost
 * is that any script that ever runs on the page — a dependency, an injected
 * one — can read a `customer_admin` bearer token. The benefit is unnecessary
 * here: Keycloak holds its own SSO session cookie, so a reload re-runs this
 * flow and returns without the user seeing a login screen. Persistence would
 * buy a few hundred milliseconds and sell the credential.
 *
 * ## What is validated here, and what is not
 *
 * `state` is checked on return, because that is the CSRF defence the client
 * owns and nobody else can do for it. The token's signature, issuer, audience
 * and expiry are **not** checked here — the API does that on every request, and
 * a client that validated its own token would be deciding it is trustworthy,
 * which is precisely the thing a client may never decide.
 */

const VERIFIER_KEY = "ds-admin-pkce-verifier";
const STATE_KEY = "ds-admin-pkce-state";
const RETURN_KEY = "ds-admin-return-to";

export interface AuthConfig {
  /** e.g. https://auth.example.de/realms/ds-admin */
  readonly issuer: string;
  readonly clientId: string;
  /** Where Keycloak sends the browser back. Must be registered on the client. */
  readonly redirectUri: string;
}

export interface Session {
  readonly accessToken: string;
  readonly expiresAt: number;
}

let current: Session | undefined;

export function currentSession(): Session | undefined {
  // Treated as expired slightly early, so a request is not sent with a token
  // that expires in flight.
  if (current !== undefined && current.expiresAt - 30_000 > Date.now()) return current;
  return undefined;
}

/** Send the browser to Keycloak. Never returns — the page navigates away. */
export async function beginLogin(config: AuthConfig): Promise<never> {
  const verifier = randomString(64);
  const state = randomString(32);

  // sessionStorage is correct for these two and only these two: they are
  // single-use, worthless to an attacker without the authorization code, and
  // must survive the redirect. The token itself is a different matter.
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem(STATE_KEY, state);
  sessionStorage.setItem(RETURN_KEY, window.location.pathname + window.location.search);

  const url = new URL(`${config.issuer}/protocol/openid-connect/auth`);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid profile email");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", await sha256Base64Url(verifier));
  url.searchParams.set("code_challenge_method", "S256");

  window.location.assign(url.toString());
  // The navigation is asynchronous; without this the caller would continue
  // rendering a screen that is about to be replaced.
  return new Promise<never>(() => {});
}

export class LoginFailedError extends Error {
  constructor(reason: string) {
    super(`login failed: ${reason}`);
    this.name = "LoginFailedError";
  }
}

/**
 * Complete the flow if this page load is a redirect back from Keycloak.
 *
 * Returns the session, or `undefined` when there is no code in the URL — which
 * is the ordinary first visit.
 */
export async function completeLogin(config: AuthConfig): Promise<Session | undefined> {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  if (code === null) {
    const error = params.get("error");
    if (error !== null) throw new LoginFailedError(error);
    return undefined;
  }

  const expectedState = sessionStorage.getItem(STATE_KEY);
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  sessionStorage.removeItem(STATE_KEY);
  sessionStorage.removeItem(VERIFIER_KEY);

  // The CSRF check. A mismatch means this code did not come from a flow this
  // tab started, so it is not exchanged.
  if (expectedState === null || params.get("state") !== expectedState) {
    throw new LoginFailedError("state mismatch");
  }
  if (verifier === null) {
    throw new LoginFailedError("no PKCE verifier for this flow");
  }

  const response = await fetch(`${config.issuer}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      code,
      code_verifier: verifier,
    }),
  });

  if (!response.ok) {
    throw new LoginFailedError(`token endpoint returned ${response.status}`);
  }

  const body = (await response.json()) as { access_token?: string; expires_in?: number };
  if (typeof body.access_token !== "string") {
    throw new LoginFailedError("token endpoint returned no access_token");
  }

  current = {
    accessToken: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 300) * 1000,
  };

  // Strip the code and state from the address bar so a copied URL is not a
  // (spent, but still) authorization code, and a reload does not retry it.
  const returnTo = sessionStorage.getItem(RETURN_KEY) ?? "/";
  sessionStorage.removeItem(RETURN_KEY);
  window.history.replaceState({}, "", returnTo);

  return current;
}

/** Drop the in-memory token and send the browser to Keycloak's logout. */
export function logout(config: AuthConfig): void {
  current = undefined;
  const url = new URL(`${config.issuer}/protocol/openid-connect/logout`);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("post_logout_redirect_uri", config.redirectUri);
  window.location.assign(url.toString());
}

function randomString(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return base64Url(buffer);
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64Url(new Uint8Array(digest));
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
