/**
 * Staff sign-in is throttled per client IP (P247-03, closes SEC-4).
 *
 * ## The defect
 *
 * `POST /admin/auth/login` and `/admin/auth/totp/verify` carried no rate
 * limit. The per-account lockout bounds guesses against **one** address; it
 * does nothing against one client spraying a common password across every
 * operator address it can find, or against a stream of TOTP codes for a
 * challenge it holds. The participant sign-in had had a limit since P25-02.
 *
 * ## Why over real HTTP
 *
 * The limit is a guard keyed on `request.ip`, which is `X-Forwarded-For`
 * through `trust proxy` (`configure-app.ts`) — exactly how Caddy hands the
 * client's address over in production. Only the whole chain can say that two
 * clients are told apart.
 *
 * Every request here is a refusal (unknown address, malformed challenge), so
 * nothing is created and no account is locked: the throttle is the only thing
 * under test.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "../../src/app.module.js";
import { configureApp } from "../../src/configure-app.js";
import { loadConfig } from "../../src/config/config.js";
import { RATE_LIMIT_RULES } from "../../src/shared/rate-limit.js";

process.env["KEYCLOAK_ISSUER"] ??= "http://127.0.0.1:1/realms/unused";
process.env["KEYCLOAK_AUDIENCE"] ??= "unused";
process.env["KEYCLOAK_JWKS_URI"] ??=
  "http://127.0.0.1:1/realms/unused/protocol/openid-connect/certs";
process.env["NODE_ENV"] ??= "test";
process.env["CERTIFICATE_DELIVERY_ENABLED"] = "no";

let app: NestExpressApplication;
let baseUrl: string;

beforeAll(async () => {
  app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: false,
    bodyParser: false,
  });
  await configureApp(app, loadConfig());
  await app.listen(0);
  const address = app.getHttpServer().address();
  if (address === null || typeof address === "string") {
    throw new Error("expected the HTTP server to bind a TCP port");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
}, 60_000);

afterAll(async () => {
  await app?.close();
});

/**
 * Read from the rule rather than restated: the number is the rule's to
 * choose, and a copy here would pass on a rule that changed.
 */
const LIMIT = (RATE_LIMIT_RULES as Record<string, { limit: number }>)["staffLogin"]
  ?.limit;

function post(path: string, ip: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

/**
 * Wait out the last seconds of a wall-clock minute.
 *
 * The limiter's window is a fixed bucket, `floor(now / 60 s)`: a burst that
 * straddles the boundary is counted in two keys and the n+1th is allowed.
 * That is the limiter's documented trade, not something to relax — so the
 * burst starts where it fits. One run of this file went red that way.
 */
async function clearOfWindowBoundary(): Promise<void> {
  const seconds = new Date().getUTCSeconds();
  if (seconds >= 50) {
    await new Promise((resolve) => setTimeout(resolve, (61 - seconds) * 1000));
  }
}

const login = (ip: string) =>
  post("/admin/auth/login", ip, {
    email: `niemand-${randomUUID().slice(0, 8)}@example.org`,
    password: "falsch-falsch-falsch",
  });

const verify = (ip: string) =>
  post("/admin/auth/totp/verify", ip, { challenge: randomUUID(), code: "123456" });

describe("staff sign-in from one IP", () => {
  it("has a limit at all", () => {
    expect(LIMIT).toBeGreaterThan(0);
  });

  it("answers the n+1th login inside the window with 429 and a problem document", async () => {
    await clearOfWindowBoundary();
    const limit = LIMIT ?? 0;
    for (let i = 0; i < limit; i += 1) {
      const response = await login("203.0.113.7");
      expect(response.status, `attempt ${String(i + 1)}`).not.toBe(429);
    }

    const refused = await login("203.0.113.7");
    expect(refused.status).toBe(429);
    expect(refused.headers.get("content-type")).toContain("application/problem+json");
    expect(refused.headers.get("retry-after")).not.toBeNull();

    // Another client is unaffected.
    expect((await login("203.0.113.8")).status).not.toBe(429);
  });

  it("counts TOTP verification against the same client", async () => {
    // A challenge is the first factor already spent; a stream of codes
    // against it is the second factor being guessed.
    await clearOfWindowBoundary();
    const limit = LIMIT ?? 0;
    for (let i = 0; i < limit; i += 1) {
      expect((await verify("203.0.113.9")).status).not.toBe(429);
    }
    const refused = await verify("203.0.113.9");
    expect(refused.status).toBe(429);
    expect(refused.headers.get("content-type")).toContain("application/problem+json");

    expect((await verify("203.0.113.10")).status).not.toBe(429);
  });
});
