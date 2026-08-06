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
