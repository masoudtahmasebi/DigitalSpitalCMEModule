/**
 * The boot gate.
 *
 * `loadConfig` is the only place that decides whether this deployment is
 * allowed to start. Everything below it assumes its answer, so the cases worth
 * testing are the ones where it must say no — particularly the production
 * secrets key, whose absence used to be discovered by a scheduler throwing
 * during startup rather than by a configuration error naming the variable.
 */

import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const KEY = randomBytes(32).toString("base64");

/**
 * The smallest environment that is otherwise valid.
 *
 * Two lines. It was five: a Keycloak issuer, audience and JWKS URI used to be
 * required here and were read by nothing — the realm a token is validated
 * against comes from the project row, per request (P17-02).
 */
const BASE = {
  DATABASE_URL: "postgres://ds_app:pw@db:5432/ds_education",
  REDIS_URL: "redis://redis:6379",
} as const;

describe("SECRETS_KMS_KEY", () => {
  it("is required in production", () => {
    expect(() => loadConfig({ ...BASE, NODE_ENV: "production" })).toThrow(
      /SECRETS_KMS_KEY/,
    );
  });

  it("must decode to 32 bytes in production", () => {
    expect(() =>
      loadConfig({
        ...BASE,
        NODE_ENV: "production",
        SECRETS_KMS_KEY: randomBytes(16).toString("base64"),
      }),
    ).toThrow(/32 bytes/);
  });

  it("is accepted in production when well-formed", () => {
    const config = loadConfig({ ...BASE, NODE_ENV: "production", SECRETS_KMS_KEY: KEY });
    expect(config.SECRETS_KMS_KEY).toBe(KEY);
  });

  it("is optional outside production, so a developer needs no key to run", () => {
    expect(loadConfig({ ...BASE }).SECRETS_KMS_KEY).toBe("");
  });
});

describe("S3_ENDPOINT", () => {
  it("refuses a bare host, naming the fix", () => {
    // The mistake the Hetzner console invites: it displays the endpoint as
    // `nbg1.your-objectstorage.com`, with no scheme. Left unvalidated this is
    // `new URL()` throwing a TypeError on every media request, in a process
    // that started cleanly and reported healthy — so the boot refuses instead,
    // and the message says what to paste.
    expect(() =>
      loadConfig({ ...BASE, S3_ENDPOINT: "nbg1.your-objectstorage.com" }),
    ).toThrow(/https:\/\//);
  });

  it("accepts an absolute URL", () => {
    expect(
      loadConfig({ ...BASE, S3_ENDPOINT: "https://nbg1.your-objectstorage.com" })
        .S3_ENDPOINT,
    ).toBe("https://nbg1.your-objectstorage.com");
  });

  it("strips a trailing slash", () => {
    // `${origin}/${bucket}/${key}` with a trailing slash is a double slash, and
    // a double slash is a *different key* to S3 — the object uploads to one
    // path and 404s from the other, which reads as "the upload silently did
    // nothing".
    expect(
      loadConfig({ ...BASE, S3_ENDPOINT: "https://nbg1.your-objectstorage.com/" })
        .S3_ENDPOINT,
    ).toBe("https://nbg1.your-objectstorage.com");
  });

  it("stays optional — object storage is a whole feature, not a requirement", () => {
    expect(loadConfig({ ...BASE }).S3_ENDPOINT).toBe("");
  });
});

describe("ALLOWED_ORIGINS", () => {
  it("splits and trims a comma-separated list", () => {
    const config = loadConfig({
      ...BASE,
      ALLOWED_ORIGINS: "https://a.example , https://b.example",
    });
    expect(config.ALLOWED_ORIGINS).toEqual(["https://a.example", "https://b.example"]);
  });

  it("refuses a wildcard at boot", () => {
    // `cors` would treat "*" in an array as a literal origin and deny
    // everything, which reads as "CORS is broken" and invites someone to
    // configure something genuinely open.
    expect(() => loadConfig({ ...BASE, ALLOWED_ORIGINS: "*" })).toThrow(/\*/);
  });

  it("defaults to empty rather than permissive", () => {
    expect(loadConfig({ ...BASE }).ALLOWED_ORIGINS).toEqual([]);
  });
});

describe("the required set", () => {
  it.each(Object.keys(BASE))("refuses to start without %s", (key) => {
    const incomplete: Record<string, string> = { ...BASE };
    delete incomplete[key];
    expect(() => loadConfig(incomplete)).toThrow(new RegExp(key));
  });

  it("names every problem at once rather than one per restart", () => {
    try {
      loadConfig({});
      expect.unreachable("an empty environment must not be valid");
    } catch (error) {
      const message = (error as Error).message;
      for (const key of Object.keys(BASE)) expect(message).toContain(key);
    }
  });
});
