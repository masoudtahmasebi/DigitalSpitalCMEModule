/**
 * The headers this client sends on behalf of its caller — here, the profile
 * hint (P257-01, P258-07).
 *
 * The API's guard has parsed `X-DS-Profile` since P105-01, and its parser has
 * exhaustive tests (`apps/api/src/auth/profile-hint.test.ts`). What nothing
 * tested was the *sender*: this client had no `profileHint` option, the widget
 * passed one in a conditional spread that TypeScript does not check for
 * unknown keys, and the header was never sent. This is the test of the call,
 * not of the rule (CLAUDE.md §9.7).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "./index.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

function capture(): Headers[] {
  const seen: Headers[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: URL, init: RequestInit) => {
      seen.push(new Headers(init.headers));
      return new Response(JSON.stringify({ items: [], total: 0 }), {
        status: 200,
        headers: { "content-type": "application/json", "content-disposition": "" },
      });
    }),
  );
  return seen;
}

describe("X-DS-Profile", () => {
  it("is sent on a JSON request when the host page gave a profile", async () => {
    const seen = capture();
    const client = createClient({
      baseUrl: "https://api.test",
      projectSlug: "medice-adhs",
      profileHint: "eyJlbWFpbCI6ImFAYi5kZSJ9",
      getToken: async () => "token",
    });
    await client.listCourses();
    expect(seen[0]?.get("x-ds-profile")).toBe("eyJlbWFpbCI6ImFAYi5kZSJ9");
  });

  it("is sent on a byte request too — the certificate download", async () => {
    const seen = capture();
    const client = createClient({
      baseUrl: "https://api.test",
      projectSlug: "medice-adhs",
      profileHint: "eyJlbWFpbCI6ImFAYi5kZSJ9",
      getToken: async () => "token",
    });
    await client.downloadCertificate("kurs");
    expect(seen[0]?.get("x-ds-profile")).toBe("eyJlbWFpbCI6ImFAYi5kZSJ9");
  });

  it.each([
    ["raw JSON with a non-Latin-1 name", '{"lastName":"Łukasz"}'],
    ["a newline", "eyJh\nYiI6MX0"],
    ["something far larger than any profile", "A".repeat(4097)],
  ])(
    "drops a hint that is not one — %s — and still sends the request",
    async (_case, hint) => {
      // P258-07: `Headers#set` throws on a non-ByteString or a newline, and it
      // threw *before* `fetch`, so one malformed attribute on a host page broke
      // every request the widget made. The API already treats a bad hint as no
      // hint; the client must not fail harder than the server.
      const seen = capture();
      const client = createClient({
        baseUrl: "https://api.test",
        projectSlug: "medice-adhs",
        profileHint: hint,
        getToken: async () => "token",
      });
      await client.listCourses();
      expect(seen).toHaveLength(1);
      expect(seen[0]?.has("x-ds-profile")).toBe(false);
    },
  );

  it("is absent when there is no profile, rather than sent empty", async () => {
    const seen = capture();
    const client = createClient({ baseUrl: "https://api.test", projectSlug: "p" });
    await client.listCourses();
    expect(seen[0]?.has("x-ds-profile")).toBe(false);
  });
});
