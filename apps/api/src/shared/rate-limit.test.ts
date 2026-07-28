import { describe, expect, it } from "vitest";
import {
  RATE_LIMIT_RULES,
  RateLimiter,
  RedisRateLimitStore,
  type RateLimitStore,
} from "./rate-limit.js";

/** An in-memory stand-in with the same increment/expiry semantics as Redis. */
function fakeStore(): RateLimitStore & { keys: Map<string, number> } {
  const keys = new Map<string, number>();
  return {
    keys,
    increment: async (key) => {
      const next = (keys.get(key) ?? 0) + 1;
      keys.set(key, next);
      return next;
    },
  };
}

const NOW = new Date("2026-07-28T12:00:00Z");

describe("a limit allows up to its threshold and then refuses", () => {
  it("allows exactly `limit` requests", async () => {
    const limiter = new RateLimiter(fakeStore());
    const { limit } = RATE_LIMIT_RULES.quizSubmit;

    for (let i = 1; i <= limit; i += 1) {
      const decision = await limiter.check("quizSubmit", "user-1", NOW);
      expect(decision.allowed).toBe(true);
      expect(decision.remaining).toBe(limit - i);
    }

    const overflow = await limiter.check("quizSubmit", "user-1", NOW);
    expect(overflow.allowed).toBe(false);
    expect(overflow.remaining).toBe(0);
  });

  it("reports how long until the window rolls over", async () => {
    const limiter = new RateLimiter(fakeStore());
    const at = new Date("2026-07-28T12:00:20Z");

    for (let i = 0; i <= RATE_LIMIT_RULES.quizSubmit.limit; i += 1) {
      await limiter.check("quizSubmit", "user-1", at);
    }

    const decision = await limiter.check("quizSubmit", "user-1", at);
    // 20 s into a 60 s window.
    expect(decision.retryAfterSec).toBe(40);
  });
});

describe("subjects are isolated", () => {
  it("one learner exhausting their quota does not affect another", async () => {
    // The reason to key on the user id rather than the IP: a hospital behind
    // one NAT address must not share a single quota.
    const limiter = new RateLimiter(fakeStore());

    for (let i = 0; i <= RATE_LIMIT_RULES.quizSubmit.limit; i += 1) {
      await limiter.check("quizSubmit", "user-1", NOW);
    }

    const other = await limiter.check("quizSubmit", "user-2", NOW);
    expect(other.allowed).toBe(true);
  });

  it("keeps separate counters per rule", async () => {
    const limiter = new RateLimiter(fakeStore());

    for (let i = 0; i <= RATE_LIMIT_RULES.quizSubmit.limit; i += 1) {
      await limiter.check("quizSubmit", "user-1", NOW);
    }

    // Exhausting the quiz quota must not lock the learner out of the course.
    const progress = await limiter.check("progress", "user-1", NOW);
    expect(progress.allowed).toBe(true);
  });
});

describe("the window resets", () => {
  it("starts a fresh count in the next window", async () => {
    const limiter = new RateLimiter(fakeStore());

    for (let i = 0; i <= RATE_LIMIT_RULES.quizSubmit.limit; i += 1) {
      await limiter.check("quizSubmit", "user-1", NOW);
    }

    const next = await limiter.check(
      "quizSubmit",
      "user-1",
      new Date(NOW.getTime() + 60_000),
    );

    expect(next.allowed).toBe(true);
  });
});

describe("progress heartbeats are not throttled during normal playback", () => {
  it("permits a heartbeat every second for a full minute", async () => {
    // P10-03 acceptance criterion. Watch coverage gates a CME point, so
    // dropping heartbeats from a real learner costs them credit for a course
    // they genuinely watched.
    const limiter = new RateLimiter(fakeStore());

    for (let second = 0; second < 60; second += 1) {
      const decision = await limiter.check(
        "progress",
        "user-1",
        new Date(NOW.getTime() + second * 1000),
      );
      expect(decision.allowed).toBe(true);
    }
  });

  it("is far more generous than the write limits, by design", () => {
    expect(RATE_LIMIT_RULES.progress.limit).toBeGreaterThan(
      RATE_LIMIT_RULES.quizSubmit.limit * 10,
    );
  });
});

describe("the Redis store", () => {
  it("sets the expiry only on the first increment of a window", async () => {
    // Refreshing the TTL on every hit would let a steady stream of requests
    // hold the window open forever and never reset the count.
    const calls: string[] = [];
    const store = new RedisRateLimitStore({
      incr: async (key) => {
        calls.push(`incr:${key}`);
        return calls.filter((c) => c.startsWith("incr:")).length;
      },
      expire: async (key, seconds) => {
        calls.push(`expire:${key}:${seconds}`);
      },
    });

    await store.increment("k", 60);
    await store.increment("k", 60);
    await store.increment("k", 60);

    expect(calls.filter((c) => c.startsWith("expire:"))).toEqual(["expire:k:60"]);
  });
});
