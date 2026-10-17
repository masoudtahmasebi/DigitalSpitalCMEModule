/**
 * What the rate limiter does when Redis cannot be asked (P249-03, RUN-3).
 *
 * Before P249-03 a store failure propagated out of `RateLimitGuard` as an
 * unknown error, so every rate-limited route — sign-in and progress alike —
 * answered 500 while Redis was down. The client chose "split by risk": a rule
 * whose limit is a security control refuses with 503 (closed); a learning
 * route serves unthrottled (open). Either way it is counted and logged.
 *
 * The policy table is pinned here as well as declared in `RATE_LIMIT_RULES`,
 * because the declaration is the thing a later rule could get wrong quietly:
 * a sign-in rule declared `open` compiles, passes every other test, and is an
 * unthrottled guessing door for the length of the next Redis outage.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExecutionContext } from "@nestjs/common";
import { Logger } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Metrics } from "../observability/metrics.js";
import { AppError, toProblemDetails } from "./problem-details.js";
import { RATE_LIMIT_RULES, RateLimiter, type RateLimitName } from "./rate-limit.js";
import { RateLimitGuard } from "./rate-limit.guard.js";

const failingStore = {
  increment: () => Promise.reject(new Error("Command timed out")),
};

function guardFor(metrics: Metrics) {
  let rule: RateLimitName = "progress";
  const reflector = { getAllAndOverride: () => rule } as unknown as Reflector;
  const guard = new RateLimitGuard(reflector, new RateLimiter(failingStore), metrics);

  const call = async (name: RateLimitName) => {
    rule = name;
    const headers: Record<string, unknown> = {};
    const context = {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({
        getRequest: () => ({ ip: "203.0.113.7" }),
        getResponse: () => ({
          setHeader: (key: string, value: unknown) => {
            headers[key.toLowerCase()] = value;
          },
        }),
      }),
    } as unknown as ExecutionContext;

    try {
      return { allowed: await guard.canActivate(context), headers, error: undefined };
    } catch (error) {
      return { allowed: false, headers, error };
    }
  };

  return call;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("a rate-limit store that throws", () => {
  it("lets an open rule through and refuses a closed rule with 503", async () => {
    vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const metrics = new Metrics();
    const call = guardFor(metrics);

    const open = await call("progress");
    expect(open.error).toBeUndefined();
    expect(open.allowed).toBe(true);

    const closed = await call("participantSignIn");
    expect(closed.error).toBeInstanceOf(AppError);
    expect(toProblemDetails(closed.error).status).toBe(503);
    expect(Number(closed.headers["retry-after"])).toBeGreaterThan(0);

    const rendered = metrics.render();
    expect(rendered).toContain(
      'ds_rate_limit_store_failures_total{rule="progress",policy="open"} 1',
    );
    expect(rendered).toContain(
      'ds_rate_limit_store_failures_total{rule="participantSignIn",policy="closed"} 1',
    );
  });

  it("logs at most once per minute per rule, and counts every failure", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-05T12:00:00Z"));
    const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const metrics = new Metrics();
    const call = guardFor(metrics);

    await call("progress");
    await call("progress");
    expect(warn).toHaveBeenCalledTimes(1);

    await call("quizSubmit");
    expect(warn).toHaveBeenCalledTimes(2);

    vi.setSystemTime(new Date("2026-10-05T12:01:01Z"));
    await call("progress");
    expect(warn).toHaveBeenCalledTimes(3);

    expect(metrics.render()).toContain(
      'ds_rate_limit_store_failures_total{rule="progress",policy="open"} 3',
    );
  });
});

/** Every `@RateLimit("…")` in the API's source, by name. */
function rateLimitNamesInSource(): string[] {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const names: string[] = [];
  const walk = (dir: string) => {
    // The entry's type comes from the same directory read, so no separate
    // `stat` decides what `readFileSync` then opens (CodeQL js/file-system-race).
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && path.endsWith(".ts") && !path.endsWith(".test.ts")) {
        for (const match of readFileSync(path, "utf8").matchAll(
          /@RateLimit\("(\w+)"\)/gu,
        )) {
          if (match[1] !== undefined) names.push(match[1]);
        }
      }
    }
  };
  walk(root);
  return names;
}

describe("every rate-limit rule declares what happens when the store fails", () => {
  it("finds the decorators it is checking", () => {
    // So the check below cannot pass by scanning nothing (§9.1).
    expect(rateLimitNamesInSource().length).toBeGreaterThan(30);
  });

  it("has an open or closed policy for every @RateLimit name in use", () => {
    const rules = RATE_LIMIT_RULES as Record<string, { onStoreFailure?: unknown }>;
    const missing = rateLimitNamesInSource().filter(
      (name) =>
        rules[name]?.onStoreFailure !== "open" &&
        rules[name]?.onStoreFailure !== "closed",
    );
    expect(missing).toEqual([]);
  });

  it("closes exactly the rules whose limit is a security control", () => {
    const closed = Object.entries(
      RATE_LIMIT_RULES as Record<string, { onStoreFailure?: unknown }>,
    )
      .filter(([, rule]) => rule.onStoreFailure === "closed")
      .map(([name]) => name)
      .sort();

    expect(closed).toEqual(
      [
        "participantCreate",
        "participantPasswordChange",
        "participantSignIn",
        "platformMailTest",
        "staffCreate",
        "staffPasswordReset",
        "staffPasswordSet",
        "subjectErasure",
      ].sort(),
    );
  });
});
