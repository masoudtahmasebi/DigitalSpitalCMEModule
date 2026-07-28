/**
 * How `<ds-lms>` obtains a bearer token (P5-02, ADR-0003).
 *
 * ## The rule this file exists to enforce
 *
 * The widget never authenticates anyone. It asks the host page for a token and
 * sends it; the API decides whether it is real, by validating the signature,
 * issuer, audience and expiry against Keycloak's JWKS. Nothing the host page
 * says about *who* the user is is believed — CLAUDE.md §4 invariant 2. That is
 * why this module has no notion of a user, a role or a login state: those
 * would be claims the widget is not entitled to make.
 *
 * ## Two ways to supply one, in priority order
 *
 * 1. **A `tokenProvider` property** set on the element by the host page:
 *
 *    ```js
 *    document.querySelector('ds-lms').tokenProvider =
 *      async ({ refresh }) => wp.getCmeToken({ refresh });
 *    ```
 *
 *    This is the escape hatch for any host that already holds a token. It is
 *    tried first because a page that sets it has, by doing so, said it knows
 *    better than any default.
 *
 * 2. **A `token-endpoint` attribute** — a URL the widget GETs, expecting
 *    `{ "token": "..." }`. Fetched with `credentials: "same-origin"`, because
 *    for the WordPress case the caller is authenticated by the WP session
 *    cookie and the endpoint mints a token from it.
 *
 * If neither is present the widget renders its "not correctly embedded"
 * message. It deliberately does not fall back to an unauthenticated request:
 * every learner endpoint requires a token, so that would produce a wall of
 * 401s instead of one clear sentence.
 *
 * ## Refresh
 *
 * `getToken({ refresh: true })` is called at most once per 401, by the SDK's
 * `onUnauthorized`. For the endpoint case that means re-fetching with
 * `cache: "no-store"` and a `refresh=1` query parameter, so a host that keeps a
 * short-lived token can mint a new one rather than return the expired one from
 * a cache. A 25-minute video outliving a 5-minute access token is the expected
 * case, not an edge case (docs/show-stoppers.md S2).
 *
 * ## What is never done here
 *
 * The token is not stored in `localStorage`, `sessionStorage`, a cookie or any
 * other place a later script on the page can read. It is held in a closure for
 * the lifetime of the widget and passed to `fetch`. Persisting it would extend
 * its life beyond the session that minted it for no benefit.
 */

export interface TokenRequest {
  /** True when the previous token was rejected and a fresh one is wanted. */
  readonly refresh: boolean;
}

export type TokenProvider = (request: TokenRequest) => Promise<string | undefined>;

export class TokenUnavailableError extends Error {
  constructor(reason: string) {
    super(`no bearer token available: ${reason}`);
    this.name = "TokenUnavailableError";
  }
}

/** Builds a provider from whatever the host page supplied. */
export function resolveTokenProvider(options: {
  readonly provider?: TokenProvider | undefined;
  readonly endpoint?: string | undefined;
}): TokenProvider | undefined {
  if (typeof options.provider === "function") return options.provider;
  if (options.endpoint !== undefined && options.endpoint !== "") {
    return endpointProvider(options.endpoint);
  }
  return undefined;
}

function endpointProvider(endpoint: string): TokenProvider {
  return async ({ refresh }) => {
    const url = new URL(endpoint, window.location.href);
    if (refresh) url.searchParams.set("refresh", "1");

    const response = await fetch(url, {
      // The WP session cookie is what authenticates this call.
      credentials: "same-origin",
      // A cached token is a token that may already have expired.
      cache: "no-store",
      headers: { accept: "application/json" },
    });

    if (!response.ok) return undefined;

    const body: unknown = await response.json();
    return readToken(body);
  };
}

/**
 * Accepts `{ token }`, `{ access_token }` or a bare string.
 *
 * Three shapes because the WordPress endpoint does not exist yet and this is
 * the boundary we do not control (S2 is still open). Accepting the two obvious
 * conventions costs three lines and removes a class of integration failure that
 * would otherwise surface as a blank widget on the client's site.
 */
function readToken(body: unknown): string | undefined {
  if (typeof body === "string" && body !== "") return body;
  if (typeof body !== "object" || body === null) return undefined;

  const record = body as Record<string, unknown>;
  for (const key of ["token", "access_token", "accessToken"]) {
    const value = record[key];
    if (typeof value === "string" && value !== "") return value;
  }
  return undefined;
}

/**
 * Caches the current token in memory and coalesces concurrent requests.
 *
 * Without the coalescing, mounting a screen that fires four parallel requests
 * would call the host's provider four times — and for an endpoint-backed
 * provider that is four round trips before the first render.
 */
export function cachingProvider(provider: TokenProvider): TokenProvider {
  let current: string | undefined;
  let inFlight: Promise<string | undefined> | undefined;

  return async ({ refresh }) => {
    if (!refresh && current !== undefined) return current;
    if (!refresh && inFlight !== undefined) return inFlight;

    inFlight = provider({ refresh })
      .then((token) => {
        current = token;
        return token;
      })
      .finally(() => {
        inFlight = undefined;
      });

    return inFlight;
  };
}
