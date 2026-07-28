import { afterEach, describe, expect, it, vi } from "vitest";
import { cachingProvider, resolveTokenProvider } from "./token.js";

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

  it("returns undefined rather than throwing when the endpoint fails", async () => {
    vi.stubGlobal("fetch", async () => new Response("", { status: 403 }));

    const provider = resolveTokenProvider({ endpoint: "/token" });
    expect(await provider?.({ refresh: false })).toBeUndefined();
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
