/**
 * A Redis that never answers is a bounded, decided failure (P249-03, RUN-3).
 *
 * The Redis here is a **blackhole**: it accepts the TCP connection and never
 * replies, which is what a wedged instance or a dropped route looks like.
 * Without `commandTimeout`, ioredis queues every command behind a handshake
 * that never completes and gives up only after its reconnects are spent — tens
 * of seconds per request, with the readiness probe hanging the same way. A
 * refused port would fail fast and prove nothing.
 *
 * Two probes, each through the real application:
 *
 * - `/health/ready` answers 503 within a few seconds — the ping is bounded by
 *   the same client timeout as every other command;
 * - participant sign-in, a `closed` rule, answers a 503 problem document with
 *   `Retry-After` rather than a 500 or a hang.
 *
 * The open half (a learning route served unthrottled) is pinned by
 * `rate-limit-store-failure.test.ts`; reaching a learner route here would need
 * a Keycloak, and the decision being tested is the guard's, not the route's.
 */

import { createServer, type Server, type Socket } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "../../src/app.module.js";
import { configureApp } from "../../src/configure-app.js";
import { loadConfig } from "../../src/config/config.js";

/** Far below ioredis' own give-up time, comfortably above `commandTimeout`. */
const ANSWER_WITHIN_MS = 5_000;

let app: NestExpressApplication;
let baseUrl: string;
let blackhole: Server;
const held: Socket[] = [];
const originalRedisUrl = process.env["REDIS_URL"];

beforeAll(async () => {
  blackhole = createServer((socket) => {
    held.push(socket);
    socket.on("error", () => undefined);
  });
  await new Promise<void>((resolve) => blackhole.listen(0, "127.0.0.1", resolve));
  const address = blackhole.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  process.env["REDIS_URL"] = `redis://127.0.0.1:${address.port}`;

  app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: false,
    bodyParser: false,
  });
  await configureApp(app, loadConfig());
  await app.listen(0);
  const bound = app.getHttpServer().address();
  if (bound === null || typeof bound === "string") throw new Error("no port");
  baseUrl = `http://127.0.0.1:${bound.port}`;
}, 40_000);

afterAll(async () => {
  // Stop accepting first: ioredis reconnects the moment a socket is destroyed,
  // and a connection accepted after the destroy loop would hold `close` open.
  const closed = new Promise<void>((resolve) => blackhole.close(() => resolve()));
  for (const socket of held) socket.destroy();
  await app?.close();
  await closed;
  if (originalRedisUrl === undefined) delete process.env["REDIS_URL"];
  else process.env["REDIS_URL"] = originalRedisUrl;
}, 40_000);

describe("with a Redis that accepts and never answers", () => {
  it(
    "the readiness probe answers 503 promptly",
    async () => {
      const response = await fetch(`${baseUrl}/health/ready`, {
        signal: AbortSignal.timeout(ANSWER_WITHIN_MS),
      });
      const body = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(503);
      expect(body["redis"]).toBe(false);
    },
    ANSWER_WITHIN_MS + 5_000,
  );

  it(
    "participant sign-in, a closed rule, answers 503 problem+json with Retry-After",
    async () => {
      const response = await fetch(`${baseUrl}/auth/participant/sign-in`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "nobody@example.test", password: "irrelevant" }),
        signal: AbortSignal.timeout(ANSWER_WITHIN_MS),
      });
      const body = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(503);
      expect(response.headers.get("content-type")).toContain("application/problem+json");
      expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
      expect(body["status"]).toBe(503);
    },
    ANSWER_WITHIN_MS + 5_000,
  );
});
