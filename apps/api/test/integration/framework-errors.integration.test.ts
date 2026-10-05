/**
 * Errors the framework raises before any handler runs still answer as problem
 * documents, with the status they mean (P249-01, closes RUN-1).
 *
 * ## Why this file exists
 *
 * `ProblemDetailsFilter` used to know three shapes — `AppError`, a Zod error,
 * Nest's `HttpException` — and send everything else to its 500 branch.
 * Body-parser's refusals are none of those: they are plain `http-errors`
 * objects carrying `status: 413` or `415` and `expose: true`. So a body over
 * `MAX_REQUEST_BODY_SIZE` was reported as **our** failure, counted in the 500
 * rate, and left the caller nothing to act on.
 *
 * And Nest's own 404 for an unknown route is an `HttpException` whose message
 * is `Cannot GET <originalUrl>` — the query string included. The filter drops
 * the query from `instance` and from the log precisely because a query is
 * where capability tokens end up, and then echoed it back in `detail`.
 *
 * Every case here goes through the real application over HTTP, because the
 * defect lived in the wiring between Express middleware and the filter — a
 * unit test of the filter with a hand-made error would pass on the broken
 * system (§9.7).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "../../src/app.module.js";
import { configureApp } from "../../src/configure-app.js";
import { loadConfig } from "../../src/config/config.js";

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
    throw new Error("expected a bound TCP port");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
}, 40_000);

afterAll(async () => {
  await app?.close();
});

interface Answer {
  status: number;
  contentType: string;
  text: string;
  body: Record<string, unknown>;
}

async function call(path: string, init: RequestInit = {}): Promise<Answer> {
  const response = await fetch(`${baseUrl}${path}`, init);
  const text = await response.text();
  return {
    status: response.status,
    contentType: response.headers.get("content-type") ?? "",
    text,
    body: JSON.parse(text) as Record<string, unknown>,
  };
}

describe("a refusal raised by the framework, before any handler", () => {
  it("answers 413 problem+json for a body over MAX_REQUEST_BODY_SIZE", async () => {
    // `loadConfig()`'s default is "1mb"; two megabytes is over it whatever the
    // exact byte interpretation.
    const oversize = JSON.stringify({ padding: "x".repeat(2 * 1024 * 1024) });

    const answer = await call("/health", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: oversize,
    });

    expect(answer.status).toBe(413);
    expect(answer.contentType).toContain("application/problem+json");
    expect(answer.body["status"]).toBe(413);
    expect(answer.body["title"]).toBe("Payload Too Large");
    // Body-parser's own message ("request entity too large") is not ours to
    // forward, and nothing about the body is echoed.
    expect(answer.text).not.toContain("entity");
  });

  it("answers 415 problem+json for a JSON body in a charset the parser refuses", async () => {
    const answer = await call("/health", {
      method: "POST",
      headers: { "content-type": "application/json; charset=latin1" },
      body: "{}",
    });

    expect(answer.status).toBe(415);
    expect(answer.contentType).toContain("application/problem+json");
    expect(answer.body["status"]).toBe(415);
    // body-parser's message quotes the charset the caller sent.
    expect(answer.text.toLowerCase()).not.toContain("latin1");
  });

  it("answers an unknown route 404 without echoing its query string", async () => {
    const answer = await call("/no-such?token=secret");

    expect(answer.status).toBe(404);
    expect(answer.contentType).toContain("application/problem+json");
    expect(answer.text).not.toContain("secret");
    expect(answer.body["detail"]).toBe("Cannot GET /no-such");
    expect(answer.body["instance"]).toBe("/no-such");
  });

  it("leaves a well-formed request to a known route alone", async () => {
    // The control, so the three above are not passing because everything now
    // answers 4xx.
    const response = await fetch(`${baseUrl}/health/live`);
    expect(response.status).toBeLessThan(500);
  });
});
