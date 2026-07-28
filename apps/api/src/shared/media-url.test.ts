/**
 * The isolation boundary for object storage.
 *
 * Postgres has RLS to fall back on if a query forgets a filter. A bucket does
 * not: a signed URL is honoured by the storage service with no idea who asked
 * for it. So the check that a key belongs to the caller is the entire
 * guarantee, and these are the tests for it.
 */

import { describe, expect, it } from "vitest";
import { PassthroughMediaResolver, PresigningMediaResolver } from "./media-url.js";
import type { Presigner } from "./s3-presigner.js";

const CUSTOMER = "0198f4c1-7a2e-7000-8000-000000000001";
const OTHER = "0198f4c1-7a2e-7000-8000-000000000002";
const NOW = new Date("2026-07-28T10:00:00Z");

/** Records what it was asked to sign, so the tests can assert it was not. */
function spyPresigner() {
  const signed: string[] = [];
  const presigner: Presigner = {
    presignGet(key) {
      signed.push(key);
      return `https://storage.example/${key}?signed=1`;
    },
  };
  return { presigner, signed };
}

describe("PresigningMediaResolver", () => {
  it("signs a key belonging to the caller", () => {
    const { presigner } = spyPresigner();
    const url = new PresigningMediaResolver(presigner, 300).resolve(
      `s3://${CUSTOMER}/courses/abc/modul-1.mp4`,
      CUSTOMER,
      NOW,
    );

    expect(url).toContain("signed=1");
  });

  it("refuses another customer's key, and never signs it", () => {
    // The row would have to be mis-seeded or tampered with to get here — and
    // that is exactly the case this exists for, because the bucket cannot
    // refuse on its own.
    const { presigner, signed } = spyPresigner();
    const url = new PresigningMediaResolver(presigner, 300).resolve(
      `s3://${OTHER}/courses/abc/modul-1.mp4`,
      CUSTOMER,
      NOW,
    );

    expect(url).toBeNull();
    expect(signed).toEqual([]);
  });

  it("refuses a traversal that would climb out of the prefix", () => {
    const { presigner, signed } = spyPresigner();
    const url = new PresigningMediaResolver(presigner, 300).resolve(
      `s3://${CUSTOMER}/../${OTHER}/secret.mp4`,
      CUSTOMER,
      NOW,
    );

    expect(url).toBeNull();
    expect(signed).toEqual([]);
  });

  it("is indistinguishable from 'no media' when it refuses", () => {
    // Telling a client that an object exists but is not theirs is more than
    // the refusal needs to say.
    const { presigner } = spyPresigner();
    const resolver = new PresigningMediaResolver(presigner, 300);

    expect(resolver.resolve(`s3://${OTHER}/a.mp4`, CUSTOMER, NOW)).toBeNull();
    expect(resolver.resolve(null, CUSTOMER, NOW)).toBeNull();
  });

  it("passes an ordinary URL through without signing it", () => {
    // A customer already serving media from their own CDN keeps doing so.
    const { presigner, signed } = spyPresigner();
    const url = new PresigningMediaResolver(presigner, 300).resolve(
      "https://cdn.medice.de/modul-1.mp4",
      CUSTOMER,
      NOW,
    );

    expect(url).toBe("https://cdn.medice.de/modul-1.mp4");
    expect(signed).toEqual([]);
  });

  it("uses the configured TTL", () => {
    const seen: number[] = [];
    const presigner: Presigner = {
      presignGet(_key, expiresInSec) {
        seen.push(expiresInSec);
        return "https://storage.example/x";
      },
    };

    new PresigningMediaResolver(presigner, 900).resolve(
      `s3://${CUSTOMER}/a.mp4`,
      CUSTOMER,
      NOW,
    );
    expect(seen).toEqual([900]);
  });
});

describe("PassthroughMediaResolver — a deployment with no object storage", () => {
  const resolver = new PassthroughMediaResolver();

  it("passes an ordinary URL through", () => {
    expect(resolver.resolve("https://cdn.medice.de/a.mp4")).toBe(
      "https://cdn.medice.de/a.mp4",
    );
  });

  it("refuses an s3 reference rather than leaking it unsigned", () => {
    // A course configured for storage on a system that has none keeps the
    // padlock shut. The alternative — emitting `s3://…` to a browser — is both
    // useless and a disclosure of the key.
    expect(resolver.resolve(`s3://${CUSTOMER}/a.mp4`)).toBeNull();
  });

  it("treats null and empty as nothing", () => {
    expect(resolver.resolve(null)).toBeNull();
    expect(resolver.resolve("")).toBeNull();
  });
});
