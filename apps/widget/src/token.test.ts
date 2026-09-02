import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NO_TOKEN_HELD,
  TokenUnavailableError,
  cachingProvider,
  resolveTokenProvider,
} from "./token.js";
import { ApiError } from "@ds/sdk";
import { describeError } from "./hooks.js";
import { de } from "./locale/de.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolveTokenProvider", () => {
  it("prefers an explicit provider over an endpoint", async () => {
    // A host page that sets `tokenProvider` has said it knows better than any
    // default, so the endpoint must not be consulted at all.
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const provider = resolveTokenProvider({
      provider: async () => "from-property",
      endpoint: "/wp-json/ds-lms/v1/token",
    });

    expect(await provider?.({ refresh: false })).toBe("from-property");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns undefined when the page supplied neither", () => {
    // Not a silent fallback to an unauthenticated request: every learner
    // endpoint needs a token, so that would be a wall of 401s instead of one
    // clear "not correctly embedded" message.
    expect(resolveTokenProvider({})).toBeUndefined();
    expect(resolveTokenProvider({ endpoint: "" })).toBeUndefined();
  });

  it("sends the one header the host named", async () => {
    // WordPress's REST nonce. Without it the token endpoint refuses, and the
    // widget renders a signed-out state on a page whose visitor is signed in —
    // which is what happened when the plugin stopped shipping its own script
    // and this attribute did not yet exist (P96-03).
    const fetchSpy = vi.fn(async () => jsonResponse({ token: "abc" }));
    vi.stubGlobal("fetch", fetchSpy);

    const provider = resolveTokenProvider({
      endpoint: "/token",
      header: "X-WP-Nonce: nonce-123",
    });
    expect(await provider?.({ refresh: false })).toBe("abc");

    const [, init] = fetchSpy.mock.calls[0] as unknown as [URL, RequestInit];
    expect(init.headers).toMatchObject({
      accept: "application/json",
      "X-WP-Nonce": "nonce-123",
    });
  });

  it.each([
    ["no colon", "X-WP-Nonce"],
    ["no name", ": value"],
    ["no value", "X-WP-Nonce:"],
    ["a space in the name", "X WP Nonce: value"],
    ["a newline smuggling a second header", "X-WP-Nonce: a\r\nX-Other: b"],
  ])(
    "drops a header with %s rather than throwing inside the provider",
    async (_, header) => {
      // `fetch` throws a TypeError on an invalid header name, and it would throw
      // *inside* the provider — surfacing as "no token", which reads as a session
      // problem and sends whoever is debugging it to the wrong system.
      const fetchSpy = vi.fn(async () => jsonResponse({ token: "abc" }));
      vi.stubGlobal("fetch", fetchSpy);

      const provider = resolveTokenProvider({ endpoint: "/token", header });
      expect(await provider?.({ refresh: false })).toBe("abc");

      const [, init] = fetchSpy.mock.calls[0] as unknown as [URL, RequestInit];
      expect(init.headers).toEqual({ accept: "application/json" });
    },
  );

  it("fetches the endpoint with the session cookie and no cache", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({ token: "abc" }));
    vi.stubGlobal("fetch", fetchSpy);

    const provider = resolveTokenProvider({ endpoint: "/token" });
    expect(await provider?.({ refresh: false })).toBe("abc");

    const [, init] = fetchSpy.mock.calls[0] as unknown as [URL, RequestInit];
    expect(init.credentials).toBe("same-origin");
    // A cached token is a token that may already have expired.
    expect(init.cache).toBe("no-store");
  });

  it("asks for a fresh token on refresh", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({ token: "fresh" }));
    vi.stubGlobal("fetch", fetchSpy);

    const provider = resolveTokenProvider({ endpoint: "/token" });
    await provider?.({ refresh: true });

    const [url] = fetchSpy.mock.calls[0] as unknown as [URL];
    expect(url.searchParams.get("refresh")).toBe("1");
  });

  it("accepts the two other conventions an endpoint might use", async () => {
    // S2 is open: the WordPress endpoint does not exist yet, and accepting the
    // obvious shapes costs three lines rather than a blank widget on the
    // client's site.
    for (const body of [{ access_token: "a" }, { accessToken: "a" }, "a"]) {
      vi.stubGlobal("fetch", async () => jsonResponse(body));
      const provider = resolveTokenProvider({ endpoint: "/token" });
      expect(await provider?.({ refresh: false })).toBe("a");
    }
  });

  /*
   * These three replace one case that asserted the opposite (P101-03).
   *
   * It read "returns undefined rather than throwing when the endpoint fails",
   * and it was the defect written down as a requirement: the SDK omits the
   * `Authorization` header when `getToken` yields nothing, so the request went
   * out unauthenticated, came back 401 as it always would, and the widget told
   * a signed-in physician their session had expired. The old test was green
   * throughout.
   */
  it("throws with the status when the endpoint refuses", async () => {
    vi.stubGlobal("fetch", async () => new Response("", { status: 403 }));

    const provider = resolveTokenProvider({ endpoint: "/token" });
    await expect(provider?.({ refresh: false })).rejects.toMatchObject({
      name: "TokenUnavailableError",
      // The status is the useful half: 404 is "not installed or switched off",
      // 403 is "installed and refusing this caller".
      reason: "endpoint_403",
    });
  });

  it("throws with the endpoint's own reason when it answers 200 and no token", async () => {
    // The signed-out case, and it is not a failure of anything — the widget
    // maps this one to "bitte melden Sie sich an", not to a technical notice.
    vi.stubGlobal("fetch", async () =>
      jsonResponse({ token: null, reason: "no_token_held" }),
    );

    const provider = resolveTokenProvider({ endpoint: "/token" });
    await expect(provider?.({ refresh: false })).rejects.toMatchObject({
      reason: "no_token_held",
    });
  });

  it("refuses a reason that is prose rather than a token", async () => {
    // It reaches a screen, and it comes from a server we do not own. Anything
    // that is not a short lowercase identifier falls back to the default.
    vi.stubGlobal("fetch", async () =>
      jsonResponse({ token: null, reason: "<img src=x onerror=alert(1)>" }),
    );

    const provider = resolveTokenProvider({ endpoint: "/token" });
    await expect(provider?.({ refresh: false })).rejects.toMatchObject({
      reason: "no_token_held",
    });
  });
});

describe("cachingProvider", () => {
  it("calls the host once for concurrent requests", async () => {
    // Mounting a screen fires several requests at once; an endpoint-backed
    // provider would otherwise make that many round trips before first render.
    let calls = 0;
    const cached = cachingProvider(async () => {
      calls += 1;
      return "token";
    });

    const results = await Promise.all([
      cached({ refresh: false }),
      cached({ refresh: false }),
      cached({ refresh: false }),
    ]);

    expect(results).toEqual(["token", "token", "token"]);
    expect(calls).toBe(1);
  });

  it("reuses the cached token on later calls", async () => {
    let calls = 0;
    const cached = cachingProvider(async () => {
      calls += 1;
      return `token-${calls}`;
    });

    expect(await cached({ refresh: false })).toBe("token-1");
    expect(await cached({ refresh: false })).toBe("token-1");
    expect(calls).toBe(1);
  });

  it("bypasses the cache on refresh, which is the point of refresh", async () => {
    let calls = 0;
    const cached = cachingProvider(async () => {
      calls += 1;
      return `token-${calls}`;
    });

    expect(await cached({ refresh: false })).toBe("token-1");
    expect(await cached({ refresh: true })).toBe("token-2");
    // And the refreshed one becomes the cached one.
    expect(await cached({ refresh: false })).toBe("token-2");
  });

  it("does not wedge after a failure", async () => {
    let attempt = 0;
    const cached = cachingProvider(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("network");
      return "recovered";
    });

    await expect(cached({ refresh: false })).rejects.toThrow("network");
    expect(await cached({ refresh: false })).toBe("recovered");
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/*
 * The message a person actually reads (P101-03).
 *
 * `describeError` is the one place every screen routes a failure through, and
 * until now a token that could not be fetched arrived there as a plain 401 —
 * indistinguishable from a real expiry. These assert the mapping rather than
 * the throwing, which is the half that was wrong on the client's site: the
 * provider could have thrown all day and still produced "Ihre Sitzung ist
 * abgelaufen" if nothing downstream told the two apart (§9.7 — name the
 * caller).
 */
describe("describeError, for a token that never arrived", () => {
  it("does not blame the physician's session when the endpoint failed", async () => {
    const message = describeError(new TokenUnavailableError("endpoint_404"), de.error);

    // The old sentence, and the whole defect: it is not their session.
    expect(message).not.toContain(de.error.unauthenticated);
    expect(message).toContain(de.tokenUnavailable.message);
    // And enough for whoever maintains the site to act on.
    expect(message).toContain("endpoint_404");
  });

  it("asks a signed-out visitor to sign in, with no technical detail", () => {
    const message = describeError(new TokenUnavailableError(NO_TOKEN_HELD), de.error);

    expect(message).toBe(de.signedOut.message);
    expect(message).not.toContain("no_token_held");
  });

  it("still says a real 401 is a real 401", () => {
    // The other direction, so this cannot pass by never reaching the old path.
    const expired = new ApiError(
      { type: "about:blank", title: "Unauthorized", status: 401 },
      new Response("", { status: 401 }),
    );
    expect(describeError(expired, de.error)).toBe(de.error.unauthenticated);
  });
});

/**
 * The reference a report can quote (P122-01).
 *
 * The API has minted a correlation id per failure and returned it on every
 * error response since observability landed. No client read it, so the one
 * string that finds the failing request in the server log reached the payload
 * and stopped there — and somebody reporting "it did not work" could not hand
 * over the thing that would locate it.
 */
describe("the correlation id in an error message", () => {
  const copy = {
    unauthenticated: "abgelaufen",
    generic: "später erneut",
    noCourse: "nicht gefunden",
  };

  function apiError(status: number, detail: string, correlationId?: string) {
    return new ApiError(
      {
        type: "about:blank",
        title: "x",
        status,
        detail,
        ...(correlationId === undefined ? {} : { correlationId }),
      },
      new Response(null, { status }),
    );
  }

  it("appends it to a failure somebody would report", () => {
    const message = describeError(
      apiError(500, "Serverfehler.", "7f2a689e-da4e-4d97-92aa-000000000001"),
      copy,
    );

    expect(message).toContain("Serverfehler.");
    expect(message).toContain("7f2a689e-da4e-4d97-92aa-000000000001");
  });

  it("says only the sentence when the API sent no id", () => {
    expect(describeError(apiError(500, "Serverfehler."), copy)).toBe("Serverfehler.");
  });

  /*
   * The two cases it must stay off. A physician told their session expired, or
   * that a Fortbildung does not exist, has been told something they can act on
   * — a reference number there is noise attached to an ordinary outcome, and it
   * would train everyone to ignore the one place it matters.
   */
  it("stays off an expired session and a missing Fortbildung", () => {
    expect(
      describeError(apiError(401, "egal", "aaaaaaaa-0000-4000-8000-00000000000a"), copy),
    ).toBe(copy.unauthenticated);
    expect(
      describeError(apiError(404, "egal", "aaaaaaaa-0000-4000-8000-00000000000a"), copy),
    ).toBe(copy.noCourse);
  });
});
