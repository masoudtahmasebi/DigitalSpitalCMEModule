/**
 * The staff plane's requests carry what the API requires of them (P139-01/02).
 *
 * ## Why these did not exist
 *
 * Every one of these functions is exercised somewhere — sign-in has browser
 * coverage, the platform sender has `PlatformSender.test.tsx`, sign-out is in
 * the journey. All of them stub `fetch` and assert on what comes **back**. Not
 * one asserted what goes **out**, so a missing header was invisible to the whole
 * suite: the stub answers 200 regardless.
 *
 * That is CLAUDE.md §9.7 in its plainest form. The tests covered the function
 * and proved nothing about the request, and the first authenticated POST to go
 * through the shared helper was refused in production with a `403` the console
 * reported as "check your connection".
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CSRF_COOKIE, sendPlatformTestMail, signOut } from "./staff-auth.js";

const API = "https://api.example.test/";

/** The last request `fetch` was called with, as headers a test can read. */
function lastHeaders(mock: ReturnType<typeof vi.fn>): Record<string, string> {
  const call = mock.mock.calls[mock.mock.calls.length - 1];
  const init = call?.[1] as RequestInit | undefined;
  const headers = (init?.headers ?? {}) as Record<string, string>;
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );
}

beforeEach(() => {
  // The double-submit cookie the API sets beside the session. Present exactly
  // as it is in a browser that has signed in and then **reloaded** — which is
  // the state P139-02 got wrong.
  document.cookie = `${CSRF_COOKIE}=token-from-the-cookie`;
});

afterEach(() => {
  document.cookie = `${CSRF_COOKIE}=; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  vi.restoreAllMocks();
});

describe("an authenticated POST", () => {
  it("carries the CSRF token, without which the API answers 403", async () => {
    /*
     * The defect, exactly: `post()` sent `content-type` and `accept` and no
     * CSRF header. It cost nothing for years because every other caller is a
     * `@Public()` route — sign-in, TOTP, credential redemption, password reset
     * — and the check only applies to a request carrying a staff session.
     *
     * "Send test email" was the first authenticated POST through it.
     */
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ status: "sent", sentTo: "a@b.test" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendPlatformTestMail(API);

    expect(result.status).toBe("sent");
    expect(lastHeaders(fetchMock)["x-ds-csrf"]).toBe("token-from-the-cookie");
  });

  it("reports a refusal as a refusal, not as a network problem", async () => {
    /*
     * §9.4. The API's 403 is a complete, deliberate answer. Mapping it to
     * "unreachable" made the console say "check your connection and whether you
     * are still signed in" — the one sentence guaranteed to send somebody
     * looking in the wrong place, which is precisely what happened.
     */
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 403 })),
    );

    expect((await sendPlatformTestMail(API)).status).toBe("refused");
  });

  it("still says unreachable when the server really is unreachable", async () => {
    // The control. Without it the case above passes on a client that calls
    // everything a refusal, which would be the same defect wearing the other
    // label (§9.1).
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );

    expect((await sendPlatformTestMail(API)).status).toBe("unreachable");
  });
});

describe("signing out", () => {
  it("sends the token from the cookie, so a reload does not break sign-out", async () => {
    /*
     * The severity is in what happens when it fails (P139-02). `signOut` read a
     * module variable set at sign-in and gone after a reload, so the header was
     * absent, the API refused with 403, the `.catch` swallowed it — and the
     * function went on to clear the local state anyway.
     *
     * The result is the worst shape available: the console says you are signed
     * out and the **server session is still live**, with its cookie still in
     * the browser. Pressing Back is enough to be signed in again.
     *
     * This module has never signed in, so the variable is undefined here —
     * which is exactly the reloaded-page state.
     */
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await signOut(API);

    expect(lastHeaders(fetchMock)["x-ds-csrf"]).toBe("token-from-the-cookie");
  });
});
