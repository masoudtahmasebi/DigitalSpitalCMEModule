/**
 * Keycloak login in a browser: Authorization Code with PKCE (RFC 7636).
 *
 * Extracted from the admin console when the standalone portal needed the same
 * flow (P9-01, P11-01). Two copies of a login flow is two places to get the
 * `state` check wrong, and the `state` check is the only CSRF defence the
 * client owns — nobody else can do it for us.
 *
 * Hand-written rather than pulled from a library: the flow is about a hundred
 * lines, and the part that actually decides anything — whether a token is real
 * — happens server-side against JWKS (ADR-0003). Nothing here is trusted by the
 * API.
 *
 * ## The token is never persisted
 *
 * Not in `localStorage`, not in `sessionStorage`, not in a cookie. It lives in
 * a variable for the lifetime of the tab and nowhere else.
 *
 * The usual argument for `sessionStorage` is surviving a reload. The cost is
 * that any script that ever runs on the page — a dependency, an injected one —
 * can read a bearer token belonging to a physician or an admin. The benefit is
 * unnecessary: Keycloak holds its own SSO session cookie, so a reload re-runs
 * this flow and returns without the user seeing a login screen. Persistence
 * would buy a few hundred milliseconds and sell the credential.
 *
 * ## What is validated here, and what is not
 *
 * `state` is checked on return. The token's signature, issuer, audience and
 * expiry are **not** checked here — the API does that on every request, and a
 * client that validated its own token would be deciding it is trustworthy,
 * which is precisely the thing a client may never decide.
 *
 * ## Why a client instead of module functions
 *
 * The admin console and the portal run on different origins against different
 * realms, and a test runs several in one process. Module-level state would make
 * "the current session" a single global that all three share. `createOidcClient`
 * gives each one its own, and the `storagePrefix` keeps their PKCE parameters
 * out of each other's way when a developer runs both on `localhost`.
 */

export interface OidcConfig {
  /** e.g. https://auth.example.de/realms/medice */
  readonly issuer: string;
  readonly clientId: string;
  /** Where Keycloak sends the browser back. Must be registered on the client. */
  readonly redirectUri: string;
  /**
   * Namespace for the two `sessionStorage` keys this uses. Defaults to
   * `ds-oidc`; set it when two apps of ours may share an origin.
   */
  readonly storagePrefix?: string;
  /** Defaults to `openid profile email`. */
  readonly scope?: string;
}

export interface Session {
  readonly accessToken: string;
  /** Epoch milliseconds. */
  readonly expiresAt: number;
}

export class LoginFailedError extends Error {
  constructor(reason: string) {
    super(`login failed: ${reason}`);
    this.name = "LoginFailedError";
  }
}

/**
 * Treat a token as expired this long before it actually is.
 *
 * A request sent with a token that expires in flight comes back 401, and the
 * app then bounces a user who was perfectly well authenticated a moment ago.
 */
const EXPIRY_MARGIN_MS = 30_000;

/** Keycloak's default when the token response omits `expires_in`. */
const FALLBACK_LIFETIME_SEC = 300;

export interface OidcClient {
  /** The current token, or `undefined` if there is none or it is about to expire. */
  readonly currentSession: () => Session | undefined;
  /** Send the browser to Keycloak. Never returns — the page navigates away. */
  readonly beginLogin: () => Promise<never>;
  /**
   * Complete the flow if this page load is a redirect back from Keycloak.
   *
   * Returns the session, or `undefined` when there is no code in the URL —
   * which is the ordinary first visit.
   */
  readonly completeLogin: () => Promise<Session | undefined>;
  /** Drop the in-memory token and send the browser to Keycloak's logout. */
  readonly logout: () => void;
}

export function createOidcClient(config: OidcConfig): OidcClient {
  const prefix = config.storagePrefix ?? "ds-oidc";
  const verifierKey = `${prefix}-pkce-verifier`;
  const stateKey = `${prefix}-pkce-state`;
  const returnKey = `${prefix}-return-to`;

  let current: Session | undefined;

  function currentSession(): Session | undefined {
    if (current !== undefined && current.expiresAt - EXPIRY_MARGIN_MS > Date.now()) {
      return current;
    }
    return undefined;
  }

  async function beginLogin(): Promise<never> {
    const verifier = randomString(64);
    const state = randomString(32);

    // sessionStorage is correct for these two and only these two: they are
    // single-use, worthless to an attacker without the authorization code, and
    // must survive the redirect. The token itself is a different matter.
    sessionStorage.setItem(verifierKey, verifier);
    sessionStorage.setItem(stateKey, state);
    sessionStorage.setItem(returnKey, window.location.pathname + window.location.search);

    const url = new URL(`${config.issuer}/protocol/openid-connect/auth`);
    url.searchParams.set("client_id", config.clientId);
    url.searchParams.set("redirect_uri", config.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", config.scope ?? "openid profile email");
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", await sha256Base64Url(verifier));
    url.searchParams.set("code_challenge_method", "S256");

    window.location.assign(url.toString());
    // The navigation is asynchronous; without this the caller would continue
    // rendering a screen that is about to be replaced.
    return new Promise<never>(() => {});
  }

  async function completeLogin(): Promise<Session | undefined> {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (code === null) {
      const error = params.get("error");
      if (error !== null) throw new LoginFailedError(error);
      return undefined;
    }

    const expectedState = sessionStorage.getItem(stateKey);
    const verifier = sessionStorage.getItem(verifierKey);
    sessionStorage.removeItem(stateKey);
    sessionStorage.removeItem(verifierKey);

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

    const body = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (typeof body.access_token !== "string") {
      throw new LoginFailedError("token endpoint returned no access_token");
    }

    current = {
      accessToken: body.access_token,
      expiresAt: Date.now() + (body.expires_in ?? FALLBACK_LIFETIME_SEC) * 1000,
    };

    // Strip the code and state from the address bar so a copied URL is not a
    // (spent, but still) authorization code, and a reload does not retry it.
    const returnTo = sessionStorage.getItem(returnKey) ?? "/";
    sessionStorage.removeItem(returnKey);
    window.history.replaceState({}, "", returnTo);

    return current;
  }

  function logout(): void {
    current = undefined;
    const url = new URL(`${config.issuer}/protocol/openid-connect/logout`);
    url.searchParams.set("client_id", config.clientId);
    url.searchParams.set("post_logout_redirect_uri", config.redirectUri);
    window.location.assign(url.toString());
  }

  return { currentSession, beginLogin, completeLogin, logout };
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
