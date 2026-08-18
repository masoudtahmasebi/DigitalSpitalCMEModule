/**
 * The embed-origin grammar (P94-04).
 *
 * Two halves that must not be confused: what may be **stored**, and what a
 * stored pattern **matches**. A pattern the platform refuses can still be
 * asked about, and answering "no" is the only safe reply.
 */

import { describe, expect, it } from "vitest";
import {
  embedOriginAllowed,
  embedOriginMatches,
  invalidEmbedOriginPatterns,
  isEmbedOriginPattern,
} from "./embed-origin.js";

describe("what may be stored", () => {
  it("accepts a plain origin, as it always has", () => {
    expect(isEmbedOriginPattern("https://www.medice.de")).toBe(true);
    expect(isEmbedOriginPattern("http://localhost:5173")).toBe(true);
  });

  it("accepts the three shapes the client asked for", () => {
    expect(isEmbedOriginPattern("https://*.medice.de")).toBe(true);
    expect(isEmbedOriginPattern("http://localhost:*")).toBe(true);
    expect(isEmbedOriginPattern("https://*.vercel.app:*")).toBe(true);
  });

  it("refuses a wildcard that is not anchored to a domain somebody owns", () => {
    /*
     * The load-bearing refusal. This API answers with
     * `Access-Control-Allow-Credentials: true`, and the fetch specification
     * forbids that together with a wildcard origin *because* it would let any
     * page on the web make authenticated requests as a signed-in physician.
     */
    for (const value of ["*", "*://*", "https://*", "https://*.de", "https://*.*"]) {
      expect(isEmbedOriginPattern(value), value).toBe(false);
    }
  });

  it("refuses a star that is not the whole leftmost label", () => {
    // `ww*.medice.de` reads as if it means something and would be a different
    // rule from the one the operator thinks they wrote.
    for (const value of [
      "https://ww*.medice.de",
      "https://*x.medice.de",
      "https://a.*.medice.de",
    ]) {
      expect(isEmbedOriginPattern(value), value).toBe(false);
    }
  });

  it("refuses anything that is not scheme, host and port", () => {
    for (const value of [
      "https://www.medice.de/",
      "https://www.medice.de/kurs",
      "https://www.medice.de?a=1",
      "https://www.medice.de#x",
      "https://user:pw@www.medice.de",
      "ftp://www.medice.de",
      "www.medice.de",
      "",
      "https://",
      "https://www.medice.de:99999",
      "https://www.medice.de:abc",
    ]) {
      expect(isEmbedOriginPattern(value), value).toBe(false);
    }
  });
});

describe("what a stored pattern matches", () => {
  it("matches an exact origin and nothing adjacent to it", () => {
    expect(embedOriginMatches("https://www.medice.de", "https://www.medice.de")).toBe(
      true,
    );
    expect(embedOriginMatches("https://www.medice.de", "http://www.medice.de")).toBe(
      false,
    );
    expect(
      embedOriginMatches("https://www.medice.de", "https://www.medice.de:8443"),
    ).toBe(false);
  });

  it("covers sub-domains at any depth, and never the apex", () => {
    expect(embedOriginMatches("https://*.medice.de", "https://www.medice.de")).toBe(true);
    expect(
      embedOriginMatches("https://*.medice.de", "https://staging.www.medice.de"),
    ).toBe(true);
    expect(embedOriginMatches("https://*.medice.de", "https://medice.de")).toBe(false);
  });

  it("is not a suffix comparison, which is how the neighbours get in", () => {
    /*
     * The attack a `endsWith("medice.de")` would allow: a domain anybody can
     * register, one character away from the customer's, and the physician's
     * session travels to it with credentials attached.
     */
    expect(embedOriginMatches("https://*.medice.de", "https://evil-medice.de")).toBe(
      false,
    );
    expect(embedOriginMatches("https://*.medice.de", "https://xmedice.de")).toBe(false);
    expect(embedOriginMatches("https://*.medice.de", "https://medice.de.evil.com")).toBe(
      false,
    );
    expect(
      embedOriginMatches("https://www.medice.de", "https://www.medice.de.evil.com"),
    ).toBe(false);
  });

  it("treats the default port as the port", () => {
    // A browser sends `https://x.de`, never `https://x.de:443`, so a rule
    // written either way has to cover the other.
    expect(embedOriginMatches("https://www.medice.de:443", "https://www.medice.de")).toBe(
      true,
    );
    expect(embedOriginMatches("http://localhost:80", "http://localhost")).toBe(true);
  });

  it("lets a port wildcard cover whatever port the tooling picked", () => {
    for (const port of ["5173", "4173", "3000"]) {
      expect(embedOriginMatches("http://localhost:*", `http://localhost:${port}`)).toBe(
        true,
      );
    }
    expect(embedOriginMatches("http://localhost:*", "http://localhost")).toBe(true);
    // Still one host, and still one scheme.
    expect(embedOriginMatches("http://localhost:*", "http://127.0.0.1:5173")).toBe(false);
    expect(embedOriginMatches("http://localhost:*", "https://localhost:5173")).toBe(
      false,
    );
  });

  it("is case-insensitive about the host, as DNS is", () => {
    expect(embedOriginMatches("https://*.medice.de", "https://WWW.MEDICE.DE")).toBe(true);
  });

  it("answers no for a pattern it would refuse to store", () => {
    // A row written before a grammar change, or by hand. Matching something it
    // cannot validate would be the one direction that fails open.
    expect(embedOriginMatches("*", "https://anything.example")).toBe(false);
    expect(embedOriginMatches("https://*", "https://anything.example")).toBe(false);
  });

  it("answers no for anything that is not an Origin header", () => {
    expect(embedOriginMatches("https://www.medice.de", "https://www.medice.de/")).toBe(
      false,
    );
    expect(embedOriginMatches("https://www.medice.de", "null")).toBe(false);
    expect(embedOriginMatches("https://www.medice.de", "")).toBe(false);
  });
});

describe("a whole list", () => {
  const patterns = [
    "https://www.medice.de",
    "https://*.medice-staging.de",
    "http://localhost:*",
  ];

  it("allows an origin any one entry covers", () => {
    expect(embedOriginAllowed(patterns, "https://www.medice.de")).toBe(true);
    expect(embedOriginAllowed(patterns, "https://pr-42.medice-staging.de")).toBe(true);
    expect(embedOriginAllowed(patterns, "http://localhost:5173")).toBe(true);
  });

  it("refuses one no entry covers", () => {
    expect(embedOriginAllowed(patterns, "https://medice-staging.de")).toBe(false);
    expect(embedOriginAllowed(patterns, "https://www.example.com")).toBe(false);
    expect(embedOriginAllowed([], "https://www.medice.de")).toBe(false);
  });

  it("names the entries a form should reject, and only those", () => {
    expect(
      invalidEmbedOriginPatterns([
        "https://www.medice.de",
        "https://www.medice.de/",
        "https://*",
        "http://localhost:*",
      ]),
    ).toEqual(["https://www.medice.de/", "https://*"]);
  });
});
