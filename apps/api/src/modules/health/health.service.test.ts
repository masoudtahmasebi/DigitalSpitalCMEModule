/**
 * What the health endpoint is allowed to say (P52-01).
 *
 * This file exists because there was no test here at all, and the gap it
 * covered was found by hand: a QA pass stopped Redis and watched `/health` go
 * on answering `{"status":"ok"}`. The compose healthcheck reads that endpoint
 * and treats any 200 as healthy, so `depends_on` was satisfied and a deploy
 * went green on an API that could not validate a token or count a rate limit.
 *
 * The tests below are therefore mostly about the **failure** answers. A health
 * check that only ever reports health is not a health check (CLAUDE.md §9.1) —
 * so every case here is one where something is down and the endpoint has to
 * say which thing.
 */

import { describe, expect, it } from "vitest";
import { HealthService } from "./health.service.js";

/** A pool that answers, or refuses in the way `pg` actually refuses. */
function pool(ok: boolean) {
  return {
    query: async () => {
      if (!ok) throw new Error("ECONNREFUSED 127.0.0.1:5432");
      return { rows: [{ "?column?": 1 }] };
    },
  } as never;
}

function redis(ok: boolean) {
  return {
    ping: async () => {
      if (!ok) throw new Error("Connection is closed.");
      return "PONG";
    },
  } as never;
}

function service(dbOk: boolean, redisOk: boolean): HealthService {
  return new HealthService(pool(dbOk), redis(redisOk));
}

describe("HealthService", () => {
  it("is ok only when both dependencies answer", async () => {
    expect(await service(true, true)).toBeDefined();

    const status = await service(true, true).check();
    expect(status.status).toBe("ok");
    expect(status.database).toBe(true);
    expect(status.redis).toBe(true);
  });

  it("is degraded when Redis is down, and says so", async () => {
    // The case that was silently green. `redis: false` is the field the
    // operator reads; `status: degraded` is what makes /health/ready a 503.
    const status = await service(true, false).check();

    expect(status.status).toBe("degraded");
    expect(status.redis).toBe(false);
    // And not blamed on the database, which is up.
    expect(status.database).toBe(true);
  });

  it("is degraded when the database is down, and says so", async () => {
    const status = await service(false, true).check();

    expect(status.status).toBe("degraded");
    expect(status.database).toBe(false);
    expect(status.redis).toBe(true);
  });

  it("reports both as down without attributing one failure to the other", async () => {
    // Two separate catches, not one shared one. A single try/catch around both
    // probes would report whichever threw first and leave the other reading
    // `false` by omission — sending whoever is debugging to the wrong
    // container at 22:00.
    const status = await service(false, false).check();

    expect(status.database).toBe(false);
    expect(status.redis).toBe(false);
    expect(status.status).toBe("degraded");
  });

  it("never throws, whatever the dependencies do", async () => {
    // A health endpoint that 500s tells a load balancer nothing it can act on
    // and loses the body that says which dependency failed.
    await expect(service(false, false).check()).resolves.toBeDefined();
  });

  it("answers 'unknown' for build fields rather than omitting them", async () => {
    // A local run sets neither. An absent field renders as an old build in a
    // footer; "unknown" says which question could not be answered.
    const previousCommit = process.env["DS_COMMIT"];
    const previousVersion = process.env["DS_VERSION"];
    delete process.env["DS_COMMIT"];
    delete process.env["DS_VERSION"];

    try {
      const status = await new HealthService(pool(true), redis(true)).check();
      expect(status.commit).toBe("unknown");
      expect(status.version).toBe("unknown");
    } finally {
      // Ambient state reset in the test that set it — P42-01's lesson, and the
      // reason these two are read at construction rather than per request.
      if (previousCommit !== undefined) process.env["DS_COMMIT"] = previousCommit;
      if (previousVersion !== undefined) process.env["DS_VERSION"] = previousVersion;
    }
  });
});
