/**
 * Shutdown waits for a delivery sweep that is mid-run (P249-04, closes RUN-4).
 *
 * The same shape as `eiv.scheduler.test.ts`, for the second timer in the API:
 * a sweep mid-send when the pools close would e-mail a certificate and fail to
 * record that it had, so the next sweep after the lease would send it again.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import type { AppConfig } from "../../config/config.js";
import { CertificateDeliveryScheduler } from "./delivery.scheduler.js";
import { CertificateDeliveryService } from "./delivery.service.js";

const CONFIG = {
  NODE_ENV: "test",
  SECRETS_KMS_KEY: "",
  CERTIFICATE_DELIVERY_BATCH_SIZE: 10,
  CERTIFICATE_DELIVERY_INTERVAL_SEC: 300,
  PORTAL_BASE_URL: "https://portal.example.test",
  // No object storage, so there is no boot drain in these cases.
  S3_ENDPOINT: "",
} as unknown as AppConfig;

const NO_POOL = {} as Pool;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CertificateDeliveryScheduler shutdown", () => {
  it("waits for a tick that is mid-run before the destroy hook resolves", async () => {
    const scheduler = new CertificateDeliveryScheduler(NO_POOL, NO_POOL, CONFIG);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const order: string[] = [];

    vi.spyOn(CertificateDeliveryService.prototype, "sweep").mockImplementation(
      async () => {
        await gate;
        order.push("tick finished");
        return { considered: 0, delivered: 0, retrying: 0, abandoned: 0, waiting: 0 };
      },
    );

    const tick = scheduler.tick();
    const destroyed = Promise.resolve(scheduler.onModuleDestroy()).then(() => {
      order.push("destroy resolved");
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(order).toEqual([]);

    release();
    await Promise.all([tick, destroyed]);
    expect(order).toEqual(["tick finished", "destroy resolved"]);
  });
});
