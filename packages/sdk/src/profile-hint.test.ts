/**
 * The profile hint leaves the browser (P257-01).
 *
 * The API's parser has had exhaustive tests since P105-01 and nothing ever
 * called it: this client had no `profileHint` option, the widget passed one in
 * a conditional spread that TypeScript does not check for unknown keys, and
 * the header was never sent. Every MEDICE physician arrived with no address.
 * This is the test of the call, not of the rule (CLAUDE.md §9.7).
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

  it("is absent when there is no profile, rather than sent empty", async () => {
    const seen = capture();
    const client = createClient({ baseUrl: "https://api.test", projectSlug: "p" });
    await client.listCourses();
    expect(seen[0]?.has("x-ds-profile")).toBe(false);
  });
});
