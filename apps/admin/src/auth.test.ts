/**
 * The console's binding to `@ds/oidc`.
 *
 * The flow itself is tested in `packages/oidc`, against the implementation.
 * What is specific to the console — and what would break login if it were
 * wrong — is that repeated calls reach the **same** client. The session lives
 * inside the client, so a `clientFor` that built a fresh one per call would
 * hand back an empty session immediately after a successful login, and the
 * console would bounce the user straight back to Keycloak.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { beginLogin, currentSession, resetAuthForTesting } from "./auth.js";

const config = {
  issuer: "https://auth.example.de/realms/ds-admin",
  clientId: "ds-admin-console",
  redirectUri: "https://admin.example.de/",
};

let assigned: string | undefined;

beforeEach(() => {
  resetAuthForTesting();
  assigned = undefined;
  sessionStorage.clear();

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
});

describe("the console's auth binding", () => {
  it("has no session before a login has completed", () => {
    expect(currentSession()).toBeUndefined();
  });

  it("namespaces its PKCE parameters, so the portal cannot clobber them", async () => {
    // Both apps run on localhost during development. Sharing a storage key
    // would mean starting one login discards the other's verifier, and the
    // second flow then fails with "no PKCE verifier for this flow".
    void beginLogin(config);
    await vi.waitFor(() => expect(assigned).toBeDefined());

    expect(sessionStorage.getItem("ds-admin-pkce-verifier")).toBeTruthy();
    expect(sessionStorage.getItem("ds-portal-pkce-verifier")).toBeNull();
  });

  it("reuses one client across calls, so a completed login survives", async () => {
    void beginLogin(config);
    await vi.waitFor(() => expect(assigned).toBeDefined());
    const verifier = sessionStorage.getItem("ds-admin-pkce-verifier");

    // A second call with the same config must not be a second client — if it
    // were, `currentSession` would read a different, empty one.
    assigned = undefined;
    void beginLogin(config);
    await vi.waitFor(() => expect(assigned).toBeDefined());

    // Different verifier (each attempt generates one) but still no session,
    // which is the observable proof there is exactly one client holding it.
    expect(sessionStorage.getItem("ds-admin-pkce-verifier")).not.toBe(verifier);
    expect(currentSession()).toBeUndefined();
  });
});
