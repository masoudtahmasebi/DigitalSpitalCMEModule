/**
 * A request that arrives while the API is shutting down is told so (P249-04,
 * closes RUN-4).
 *
 * ## The order that was wrong
 *
 * Nest's shutdown runs `onModuleDestroy` on every provider, then closes the
 * HTTP server, then runs `onApplicationShutdown`. `DbModule` ended both pools
 * and quit Redis in `onModuleDestroy` — the **first** phase — while the server
 * was still accepting. Every request in that window reached a pool that had
 * been ended and answered 500, logging `Cannot use a pool after calling end on
 * the pool`: a redeploy produced a burst of our-fault errors for requests that
 * had done nothing wrong.
 *
 * ## How the window is made deterministic
 *
 * The window is real but short, so the test holds it open: the HTTP server's
 * `close` is wrapped to signal when Nest calls it and to wait for the test
 * before closing. By then every `onModuleDestroy` has run — so on the old
 * order the pools are already ended — and the server has not yet stopped
 * accepting. A request sent in that gap is exactly "a request arriving after
 * shutdown begins".
 *
 * `GET /tenants/:slug` is the probe because it is public, reads the request
 * pool, and carries no rate limit — so it fails on Postgres and nothing else.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import type { Pool } from "pg";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "../../src/app.module.js";
import { configureApp } from "../../src/configure-app.js";
import { loadConfig } from "../../src/config/config.js";
import { PG_POOL, PG_SIDE_POOL } from "../../src/db/tokens.js";

let app: NestExpressApplication;
let baseUrl: string;
let closing: Promise<void> | undefined;
const logged: string[] = [];

beforeAll(async () => {
  app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: false,
    bodyParser: false,
  });
  await configureApp(app, loadConfig());
  await app.listen(0);
  const address = app.getHttpServer().address();
  if (address === null || typeof address === "string") {
    throw new Error("expected a bound TCP port");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
}, 40_000);

afterAll(async () => {
  vi.restoreAllMocks();
  await closing;
});

describe("a request arriving after shutdown has begun", () => {
  it("answers 503 problem+json, and the pools outlive the server", async () => {
    // Sanity: the probe answers normally before anything closes.
    const before = await fetch(`${baseUrl}/tenants/no-such-tenant`);
    expect(before.status).toBe(200);

    const server = app.getHttpServer() as Server;
    const realClose = server.close.bind(server);
    let reached!: () => void;
    const closeReached = new Promise<void>((resolve) => {
      reached = resolve;
    });
    let release!: () => void;
    const closeGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.close = ((callback?: (error?: Error) => void) => {
      reached();
      void closeGate.then(() => realClose(callback));
      return server;
    }) as Server["close"];

    vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      logged.push(String(chunk));
      return true;
    });

    const pools = [app.get<Pool>(PG_POOL), app.get<Pool>(PG_SIDE_POOL)];

    closing = app.close();
    await closeReached;

    // The server is being closed and the pools are not: the order is the fix.
    const endedBeforeServerClosed = pools.map((pool) => pool.ending);

    const during = await fetch(`${baseUrl}/tenants/no-such-tenant`);
    const body = (await during.json()) as Record<string, unknown>;

    release();
    await closing;
    vi.restoreAllMocks();

    expect(endedBeforeServerClosed).toEqual([false, false]);
    expect(pools.map((pool) => pool.ending)).toEqual([true, true]);
    expect(during.status).toBe(503);
    expect(during.headers.get("content-type")).toContain("application/problem+json");
    expect(during.headers.get("connection")).toBe("close");
    expect(body["status"]).toBe(503);
    expect(logged.join("")).not.toContain("Cannot use a pool after calling end");
  }, 30_000);
});
