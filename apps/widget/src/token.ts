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
 *    A host whose endpoint needs one extra request header supplies it as
 *    `token-header="X-WP-Nonce: abc123"`. That is deliberately one header and
 *    not a mechanism: WordPress needs exactly this — a nonce proving the
 *    request came from a page it rendered rather than from another origin
 *    borrowing the visitor's cookie — and a general header facility would be a
 *    way for a page to make the widget send anything anywhere.
 *
 *    This attribute is why the WordPress plugin ships no JavaScript (P96-03).
 *    It used to inline a provider that did precisely what `endpointProvider`
 *    below does, which meant every change to *how a token is fetched* needed a
 *    plugin update on every customer's site. The plugin now states where the
 *    endpoint is and what header it wants; everything about the fetching is
 *    here, and ships with the bundle.
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

/**
 * The host page was asked for a token and could not produce one (P101-03).
 *
 * ## Why this is thrown rather than answered with `undefined`
 *
 * It used to return `undefined`, and the SDK omits the `Authorization` header
 * when `getToken` yields nothing — so the request went out unauthenticated,
 * the API answered 401 as it must, and the widget said **"Ihre Sitzung ist
 * abgelaufen"**. That sentence is wrong twice over: the physician's MEDICE
 * session was fine, and the fix it implies — sign in again — cannot work,
 * because nothing about signing in changes a token endpoint that is answering
 * 404.
 *
 * Two completely different failures produced one message, and the message
 * named the one thing that was working. That is P97-01's shape exactly, one
 * layer out: an unauthenticated request that is *certain* to 401 is not a
 * request, it is a guess with a misleading answer attached.
 *
 * ## `reason` is a token, not a sentence
 *
 * It reaches a screen, so it must not be prose from a server we do not own.
 * `no_token_held` is the endpoint's own word for "this visitor is not signed
 * in"; `endpoint_404`, `endpoint_401` and the rest describe the endpoint
 * itself. The widget maps the first to "please sign in" and the others to
 * "this page could not obtain a token", which are the two different things a
 * person can act on.
 */
export class TokenUnavailableError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(`no bearer token available: ${reason}`);
    this.name = "TokenUnavailableError";
    this.reason = reason;
  }
}

/** The endpoint's word for "this visitor holds no session token". */
export const NO_TOKEN_HELD = "no_token_held";

/** Builds a provider from whatever the host page supplied. */
export function resolveTokenProvider(options: {
  readonly provider?: TokenProvider | undefined;
  readonly endpoint?: string | undefined;
  readonly header?: string | undefined;
}): TokenProvider | undefined {
  if (typeof options.provider === "function") return options.provider;
  if (options.endpoint !== undefined && options.endpoint !== "") {
    return endpointProvider(options.endpoint, parseHeader(options.header));
  }
  return undefined;
}

/**
 * `"X-WP-Nonce: abc123"` → `{ "X-WP-Nonce": "abc123" }`, or nothing.
 *
 * Anything that is not one field name followed by a colon is dropped in
 * silence, because the alternative is worse: `fetch` throws a `TypeError` on an
 * invalid header name, and it would throw inside the provider — surfacing as
 * "no token", which reads as a session problem and sends whoever is debugging
 * it to the wrong system entirely.
 *
 * The name is checked against RFC 7230's `token` production rather than trusted
 * from the attribute. A host page cannot use this to inject a second header:
 * everything after the first colon is one value, and a newline is not in the
 * permitted set on either side.
 */
function parseHeader(header: string | undefined): Record<string, string> {
  if (header === undefined || header === "") return {};
  const separator = header.indexOf(":");
  if (separator <= 0) return {};

  const name = header.slice(0, separator).trim();
  const value = header.slice(separator + 1).trim();
  if (value === "" || !/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/u.test(name)) return {};
  // A control character in the value is the other half of the same injection,
  // and is likewise refused rather than passed to `fetch` to throw over.
  // eslint-disable-next-line no-control-regex -- refusing control characters is the point
  if (/[\u0000-\u001f\u007f]/u.test(value)) return {};

  return { [name]: value };
}

function endpointProvider(
  endpoint: string,
  extraHeaders: Record<string, string>,
): TokenProvider {
  return async ({ refresh }) => {
    const url = new URL(endpoint, window.location.href);
    if (refresh) url.searchParams.set("refresh", "1");

    const response = await fetch(url, {
      // The WP session cookie is what authenticates this call.
      credentials: "same-origin",
      // A cached token is a token that may already have expired.
      cache: "no-store",
      headers: { accept: "application/json", ...extraHeaders },
    });

    if (!response.ok) {
      // The status, not the body: an error page from a proxy or a WAF is not
      // this endpoint's JSON, and `404` is the single most useful fact about
      // it — it is the difference between "the plugin is not installed or the
      // setting is off" and "the endpoint refused this caller".
      throw new TokenUnavailableError(`endpoint_${response.status}`);
    }

    const body: unknown = await response.json();
    const token = readToken(body);
    if (token === undefined) {
      // A 200 with no token is the endpoint working correctly and saying the
      // visitor has no session — a different fact from the endpoint failing,
      // and the only one of the two a physician can act on themselves.
      throw new TokenUnavailableError(reasonOf(body) ?? NO_TOKEN_HELD);
    }
    return token;
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

/** The endpoint's own `reason`, when it sent one. */
function reasonOf(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const value = (body as Record<string, unknown>)["reason"];
  // Bounded and character-restricted: it is the host page's string and it
  // reaches a screen. A token, never a sentence — see the error's docblock.
  return typeof value === "string" && /^[a-z0-9_]{1,64}$/u.test(value)
    ? value
    : undefined;
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
