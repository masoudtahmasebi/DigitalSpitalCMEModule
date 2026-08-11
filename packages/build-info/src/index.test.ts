/**
 * The comparison the footer renders (P46-01).
 *
 * The case worth the file is `unknown` on one side not counting as skew. A
 * footer that reports a version mismatch every time a developer runs
 * `pnpm dev` is a footer nobody reads by Friday — and then the one day it is
 * telling the truth about a half-finished deploy, nobody reads it either.
 */

import { describe, expect, it, vi, afterEach } from "vitest";
import {
  compareBuilds,
  describeBuild,
  fetchApiBuild,
  shortCommit,
  UNKNOWN_BUILD,
} from "./index.js";

describe("shortCommit", () => {
  it("trims a commit to the seven characters the deploy log and docker images show", () => {
    expect(shortCommit("e258c8dab1f4c0091122334455667788990aabbc")).toBe("e258c8d");
  });

  it("leaves an already-short commit alone", () => {
    expect(shortCommit("e258c8d")).toBe("e258c8d");
  });

  it("passes through anything that is not a commit, so a hand-set tag survives", () => {
    expect(shortCommit("v1.2.3-rc1")).toBe("v1.2.3-rc1");
  });

  it("says unknown for absent, empty and whitespace alike", () => {
    expect(shortCommit(undefined)).toBe(UNKNOWN_BUILD);
    expect(shortCommit("")).toBe(UNKNOWN_BUILD);
    expect(shortCommit("   ")).toBe(UNKNOWN_BUILD);
  });
});

describe("compareBuilds", () => {
  it("matches when both sides came from one commit", () => {
    const result = compareBuilds("e258c8dab1f4", "e258c8dab1f4");
    expect(result.agreement).toBe("match");
    expect(result.frontend).toBe("e258c8d");
  });

  it("reports skew when the bundle is older than the API — the case this exists for", () => {
    // A deploy that rebuilt the API and not the console. The console then shows
    // a screen that does not exist yet, or hides one that does, and every
    // report about it is about the wrong build.
    expect(compareBuilds("4601f19", "e258c8d").agreement).toBe("skew");
  });

  it("does not call a missing frontend commit skew", () => {
    // `pnpm dev`: a Vite server has no image and no DS_COMMIT.
    const result = compareBuilds(undefined, "e258c8d");
    expect(result.agreement).toBe("unknown");
    expect(result.api).toBe("e258c8d");
  });

  it("does not call a missing API commit skew either", () => {
    expect(compareBuilds("e258c8d", undefined).agreement).toBe("unknown");
  });
});

describe("describeBuild", () => {
  it("puts the comparable half first and the exact half second", () => {
    expect(describeBuild("1.0.482", "0a177c7aaaa")).toBe("v1.0.482 · 0a177c7");
  });

  it("falls back to the commit alone when there is no version", () => {
    // An API deployed before P47-01 answers a commit and no version.
    expect(describeBuild(undefined, "0a177c7aaaa")).toBe("0a177c7");
    expect(describeBuild("unknown", "0a177c7aaaa")).toBe("0a177c7");
  });

  it("falls back to the version alone when there is no commit", () => {
    expect(describeBuild("1.0.482", undefined)).toBe("v1.0.482");
  });

  it("says one word rather than two when it knows neither", () => {
    // `vunknown · unknown` is noise where `unknown` is the whole message.
    expect(describeBuild(undefined, undefined)).toBe(UNKNOWN_BUILD);
  });
});

describe("fetchApiBuild", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads both fields out of /health in one request", () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          status: "ok",
          database: true,
          commit: "0a177c7",
          version: "1.0.482",
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    return fetchApiBuild("https://api.example.com").then((build) => {
      expect(build).toEqual({ version: "1.0.482", commit: "0a177c7" });
      // One request, not two: this runs on a public page.
      expect(fetchMock.mock.calls).toHaveLength(1);
      expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.example.com/health");
    });
  });

  it("does not double the slash when the base carries one", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ commit: "0a177c7", version: "1.0.482" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchApiBuild("https://api.example.com/");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.example.com/health");
  });

  it("answers unknown rather than throwing when the API is unreachable", async () => {
    // The state in which somebody is most likely to be reading the footer.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connection refused")));
    expect(await fetchApiBuild("https://api.example.com")).toEqual({
      version: UNKNOWN_BUILD,
      commit: UNKNOWN_BUILD,
    });
  });

  it("answers unknown on a non-200, without parsing the body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.reject(new Error("should not be called")),
      }),
    );
    expect((await fetchApiBuild("https://api.example.com")).commit).toBe(UNKNOWN_BUILD);
  });

  it("answers unknown per field when an older API omits them", async () => {
    // Precisely the deployment this exists for: an API from before these
    // fields were on /health.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: "ok", database: true }),
      }),
    );
    expect(await fetchApiBuild("https://api.example.com")).toEqual({
      version: UNKNOWN_BUILD,
      commit: UNKNOWN_BUILD,
    });
  });
});
