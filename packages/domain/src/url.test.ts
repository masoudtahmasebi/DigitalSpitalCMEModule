/**
 * The trailing-slash rule, and the input that made it a finding (P49-01).
 *
 * The last case is the one this file exists for: a long run of slashes is what
 * `\/+$` turns quadratic, and it has to come back instantly. It asserts a
 * duration, which is normally a bad idea in a test — a slow machine makes it
 * flake. The bound here is deliberately enormous (a second, against work that
 * takes microseconds) because the failure it guards is *seconds to minutes*,
 * not milliseconds. A regex-based implementation does not fail this by a
 * little.
 */

import { describe, expect, it } from "vitest";
import { joinUrl, stripTrailingSlashes } from "./url.js";

describe("stripTrailingSlashes", () => {
  it("leaves a URL without one alone", () => {
    expect(stripTrailingSlashes("https://api.example.com")).toBe(
      "https://api.example.com",
    );
  });

  it("removes one", () => {
    expect(stripTrailingSlashes("https://api.example.com/")).toBe(
      "https://api.example.com",
    );
  });

  it("removes several", () => {
    expect(stripTrailingSlashes("https://api.example.com///")).toBe(
      "https://api.example.com",
    );
  });

  it("does not touch slashes that are not at the end", () => {
    expect(stripTrailingSlashes("https://api.example.com/v1/thing")).toBe(
      "https://api.example.com/v1/thing",
    );
  });

  it("empties a string that is only slashes, rather than inventing an origin", () => {
    expect(stripTrailingSlashes("///")).toBe("");
    expect(stripTrailingSlashes("")).toBe("");
  });

  it("returns immediately on the input that made the regex a finding", () => {
    // A long run of slashes followed by one other character: no match, and the
    // regex engine restarts the scan at every position to find that out.
    const pathological = `${"/".repeat(50_000)}x`;

    const started = Date.now();
    expect(stripTrailingSlashes(pathological)).toBe(pathological);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe("joinUrl", () => {
  it("puts exactly one slash between the two", () => {
    expect(joinUrl("https://api.example.com", "health")).toBe(
      "https://api.example.com/health",
    );
    expect(joinUrl("https://api.example.com/", "health")).toBe(
      "https://api.example.com/health",
    );
    expect(joinUrl("https://api.example.com///", "health")).toBe(
      "https://api.example.com/health",
    );
  });

  it("leaves the path as given", () => {
    // Every call site passes a literal. Normalising here would hide a caller
    // passing something it should not.
    expect(joinUrl("https://api.example.com", "v1/thing")).toBe(
      "https://api.example.com/v1/thing",
    );
  });
});
