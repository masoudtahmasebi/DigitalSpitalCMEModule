/**
 * Shutdown waits for a sweep that is mid-run (P249-04, closes RUN-4).
 *
 * `onModuleDestroy` used to clear the timer and return. A tick already inside
 * `service.sweep` carried on against pools that `DbModule` was closing in the
 * same phase — so a Punktemeldung could be accepted by EIV and its success row
 * never written, leaving it to be re-claimed after the lease. These tests hold
 * a tick open on a promise the test controls and assert the destroy hook does
 * not resolve until that tick has finished.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import type { AppConfig } from "../../config/config.js";
import { EivScheduler } from "./eiv.scheduler.js";

const CONFIG = {
  NODE_ENV: "test",
  SECRETS_KMS_KEY: "",
  ALERT_WEBHOOK_URL: "",
  EIV_MOCK_BASE_URL: "",
  EIV_SWEEP_BATCH_SIZE: 10,
  EIV_SWEEP_INTERVAL_SEC: 60,
} as unknown as AppConfig;

/** Never reached: every database-touching step is replaced below. */
const NO_POOL = {} as Pool;

function deferred(): { promise: Promise<void>; release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("EivScheduler shutdown", () => {
  it("waits for a tick that is mid-run before the destroy hook resolves", async () => {
    const scheduler = new EivScheduler(NO_POOL, NO_POOL, CONFIG);
    const gate = deferred();
    const order: string[] = [];

    // The alert sweep is the first thing a tick awaits; holding it holds the tick.
    vi.spyOn(
      EivScheduler.prototype as unknown as { sweepAlerts: () => Promise<void> },
      "sweepAlerts",
    ).mockImplementation(async () => {
      await gate.promise;
      order.push("tick finished");
    });
    vi.spyOn(
      EivScheduler.prototype as unknown as { target: () => Promise<unknown> },
      "target",
    ).mockResolvedValue({ enabled: false });

    const tick = scheduler.tick();
    const destroyed = Promise.resolve(scheduler.onModuleDestroy()).then(() => {
      order.push("destroy resolved");
    });

    // Plenty of turns for a hook that does not wait to have resolved.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(order).toEqual([]);

    gate.release();
    await Promise.all([tick, destroyed]);
    expect(order).toEqual(["tick finished", "destroy resolved"]);
  });

  it("starts no new tick once shutdown has begun", async () => {
    const scheduler = new EivScheduler(NO_POOL, NO_POOL, CONFIG);
    const alerts = vi
      .spyOn(
        EivScheduler.prototype as unknown as { sweepAlerts: () => Promise<void> },
        "sweepAlerts",
      )
      .mockResolvedValue(undefined);

    await scheduler.onModuleDestroy();
    await scheduler.tick();

    expect(alerts).not.toHaveBeenCalled();
  });
});
