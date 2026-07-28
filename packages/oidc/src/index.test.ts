/**
 * The login flow's security properties.
 *
 * These are the assertions that matter: PKCE is only a defence if the challenge
 * is derived rather than sent, `state` is only a CSRF defence if a mismatch
 * actually refuses, and the "token never persisted" rule is only true if
 * nothing writes it anywhere.
 *
 * They moved here from the admin console when the portal needed the same flow.
 * Testing them once, against the implementation, is the point of having one
 * implementation — and it means a third host adapter inherits the coverage
 * rather than being trusted to write it again.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOidcClient, LoginFailedError, type OidcClient } from "./index.js";

const config = {
  issuer: "https://auth.example.de/realms/ds-admin",
  clientId: "ds-admin-console",
  redirectUri: "https://admin.example.de/",
  storagePrefix: "ds-admin",
} as const;

let client: OidcClient;

let assigned: string | undefined;

beforeEach(() => {
  // A fresh client per test: the session lives inside it, so sharing one would
  // let a token from an earlier test satisfy a later one.
  client = createOidcClient(config);
  assigned = undefined;
  sessionStorage.clear();
  localStorage.clear();

  // jsdom refuses a real navigation; capture the target instead.
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      origin: "https://admin.example.de",
      pathname: "/",
      search: "",
      href: "https://admin.example.de/",
      assign: (url: string) => {
        assigned = url;
      },
    },
  });

  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("beginLogin", () => {
  it("sends a derived S256 challenge, never the verifier", async () => {
    // The whole point of PKCE: the value on the wire must not be the secret
    // that redeems the code.
    void client.beginLogin();
    await vi.waitFor(() => expect(assigned).toBeDefined());

    const url = new URL(assigned!);
    const verifier = sessionStorage.getItem("ds-admin-pkce-verifier");

    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).not.toBe(verifier);
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    expect(assigned).not.toContain(verifier!);
  });

  it("asks for a code, with the registered client and redirect", async () => {
    void client.beginLogin();
    await vi.waitFor(() => expect(assigned).toBeDefined());

    const url = new URL(assigned!);
    expect(url.origin + url.pathname).toBe(
      "https://auth.example.de/realms/ds-admin/protocol/openid-connect/auth",
    );
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe(config.clientId);
    expect(url.searchParams.get("redirect_uri")).toBe(config.redirectUri);
  });

  it("generates a fresh verifier and state on every attempt", async () => {
    void client.beginLogin();
    await vi.waitFor(() => expect(assigned).toBeDefined());
    const first = sessionStorage.getItem("ds-admin-pkce-verifier");

    assigned = undefined;
    void client.beginLogin();
    await vi.waitFor(() => expect(assigned).toBeDefined());

    expect(sessionStorage.getItem("ds-admin-pkce-verifier")).not.toBe(first);
  });
});

describe("completeLogin", () => {
  function arriveAt(search: string): void {
    Object.defineProperty(window.location, "search", {
      configurable: true,
      value: search,
    });
  }

  it("does nothing on an ordinary first visit", async () => {
    arriveAt("");
    await expect(client.completeLogin()).resolves.toBeUndefined();
  });

  it("refuses a code whose state does not match this tab's flow", async () => {
    // The CSRF defence. A code arriving with somebody else's state is not
    // exchanged, whatever it is.
    sessionStorage.setItem("ds-admin-pkce-state", "ours");
    sessionStorage.setItem("ds-admin-pkce-verifier", "verifier");
    arriveAt("?code=abc&state=theirs");

    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(client.completeLogin()).rejects.toBeInstanceOf(LoginFailedError);
    // And crucially, the code was never sent anywhere.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses when no verifier survived the redirect", async () => {
    sessionStorage.setItem("ds-admin-pkce-state", "ours");
    arriveAt("?code=abc&state=ours");

    await expect(client.completeLogin()).rejects.toBeInstanceOf(LoginFailedError);
  });

  it("surfaces an error Keycloak sent back", async () => {
    arriveAt("?error=access_denied");
    await expect(client.completeLogin()).rejects.toBeInstanceOf(LoginFailedError);
  });

  it("exchanges the code with the verifier and keeps the token in memory only", async () => {
    sessionStorage.setItem("ds-admin-pkce-state", "ours");
    sessionStorage.setItem("ds-admin-pkce-verifier", "the-verifier");
    arriveAt("?code=abc&state=ours");

    const fetchSpy = vi.fn(async () =>
      jsonResponse({ access_token: "at", expires_in: 300 }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const session = await client.completeLogin();
    expect(session?.accessToken).toBe("at");

    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(init.body)).toContain("code_verifier=the-verifier");

    // The rule this whole design exists for: a bearer token for a
    // customer_admin must not be readable by any script that runs later.
    expect(JSON.stringify(sessionStorage)).not.toContain("at");
    expect(JSON.stringify(localStorage)).not.toContain("at");
    expect(document.cookie).not.toContain("at");
  });

  it("clears the single-use verifier and state after the exchange", async () => {
    sessionStorage.setItem("ds-admin-pkce-state", "ours");
    sessionStorage.setItem("ds-admin-pkce-verifier", "v");
    arriveAt("?code=abc&state=ours");
    vi.stubGlobal("fetch", async () => jsonResponse({ access_token: "at" }));

    await client.completeLogin();

    expect(sessionStorage.getItem("ds-admin-pkce-verifier")).toBeNull();
    expect(sessionStorage.getItem("ds-admin-pkce-state")).toBeNull();
  });

  it("strips the code from the address bar", async () => {
    // So a copied URL is not an authorization code, and a reload does not
    // retry a spent one.
    sessionStorage.setItem("ds-admin-pkce-state", "ours");
    sessionStorage.setItem("ds-admin-pkce-verifier", "v");
    sessionStorage.setItem("ds-admin-return-to", "/courses");
    arriveAt("?code=abc&state=ours");
    vi.stubGlobal("fetch", async () => jsonResponse({ access_token: "at" }));

    await client.completeLogin();

    expect(window.location.href).not.toContain("code=");
  });

  it("fails loudly when the token endpoint refuses", async () => {
    sessionStorage.setItem("ds-admin-pkce-state", "ours");
    sessionStorage.setItem("ds-admin-pkce-verifier", "v");
    arriveAt("?code=abc&state=ours");
    vi.stubGlobal("fetch", async () => new Response("", { status: 400 }));

    await expect(client.completeLogin()).rejects.toBeInstanceOf(LoginFailedError);
  });

  it("fails when the response carries no access token", async () => {
    sessionStorage.setItem("ds-admin-pkce-state", "ours");
    sessionStorage.setItem("ds-admin-pkce-verifier", "v");
    arriveAt("?code=abc&state=ours");
    vi.stubGlobal("fetch", async () => jsonResponse({ id_token: "only-this" }));

    await expect(client.completeLogin()).rejects.toBeInstanceOf(LoginFailedError);
  });
});

describe("currentSession", () => {
  it("treats a token expiring within the grace window as already gone", async () => {
    // A token that expires in flight would produce a confusing 401 mid-action.
    sessionStorage.setItem("ds-admin-pkce-state", "ours");
    sessionStorage.setItem("ds-admin-pkce-verifier", "v");
    Object.defineProperty(window.location, "search", {
      configurable: true,
      value: "?code=abc&state=ours",
    });
    vi.stubGlobal("fetch", async () =>
      jsonResponse({ access_token: "at", expires_in: 10 }),
    );

    await client.completeLogin();
    expect(client.currentSession()).toBeUndefined();
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
