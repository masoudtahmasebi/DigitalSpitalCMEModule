import { describe, expect, it } from "vitest";
import { ApiError } from "@ds/sdk";
import { isSessionExpired } from "./session.js";

const apiError = (status: number) =>
  new ApiError(
    { type: "about:blank", title: "x", status },
    new Response(null, { status }),
  );

describe("telling an expired session from a bad minute", () => {
  it("is an expired session at 401", () => {
    expect(isSessionExpired(apiError(401))).toBe(true);
  });

  it("is not, for anything the next flush could recover from", () => {
    // Each of these leaves the original silence in place, which is correct:
    // the learner cannot act on them and the server converges anyway.
    for (const status of [408, 429, 500, 502, 503, 504]) {
      expect(isSessionExpired(apiError(status))).toBe(false);
    }
  });

  it("is not a 403, which no reload fixes", () => {
    expect(isSessionExpired(apiError(403))).toBe(false);
  });

  it("is not a network failure, which carries no status at all", () => {
    expect(isSessionExpired(new TypeError("fetch failed"))).toBe(false);
    expect(isSessionExpired(undefined)).toBe(false);
  });
});
