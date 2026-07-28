/**
 * Runs the EIV sweep on an interval (P7-06).
 *
 * A plain timer rather than a job framework: the queue is a database table
 * with `FOR UPDATE SKIP LOCKED`, so correctness under multiple instances comes
 * from Postgres, not from a scheduler with leader election. Adding a queue
 * library would be a dependency and an operational surface for no property we
 * do not already have.
 *
 * Three properties this deliberately has:
 *
 * - **Never overlapping.** A sweep that runs long does not get a second copy
 *   started on top of it; the next tick is skipped instead.
 * - **Never fatal.** A sweep that throws logs and returns. An unhandled
 *   rejection in a background timer takes the API process down with it, which
 *   would turn a transient EIV outage into an outage of the whole platform.
 * - **Stops cleanly.** `onModuleDestroy` clears the timer so a redeploy does
 *   not leave a sweep half-run against a closing pool.
 */

import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import type { Pool } from "pg";
import { APP_CONFIG, PG_POOL } from "../../db/tokens.js";
import type { AppConfig } from "../../config/config.js";
import { AuditService } from "../../audit/audit.service.js";
import { createSecretCipher } from "../../shared/secret-cipher.js";
import { EivRepository } from "./eiv.repository.js";
import { EivAlertRepository } from "./eiv-alert.repository.js";
import { EivAlertService, WebhookAlertSink } from "./eiv-alert.service.js";
import { EivService, LiveEivSubmitter } from "./eiv.service.js";

@Injectable()
export class EivScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EivScheduler.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private readonly service: EivService;
  private readonly alerts: EivAlertService;

  constructor(
    @Inject(PG_POOL) pool: Pool,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.alerts = new EivAlertService(
      new EivAlertRepository(pool),
      new AuditService(pool),
      this.logger,
      config.ALERT_WEBHOOK_URL === ""
        ? undefined
        : new WebhookAlertSink(config.ALERT_WEBHOOK_URL),
    );

    this.service = new EivService(
      new EivRepository(pool, createSecretCipher(config.NODE_ENV)),
      new LiveEivSubmitter(),
      new AuditService(pool),
      {
        baseUrl: config.EIV_BASE_URL,
        batchSize: config.EIV_SWEEP_BATCH_SIZE,
        allowLive: config.EIV_ALLOW_LIVE,
        // Two sweeps of headroom, so a slow submission is never double-claimed.
        leaseSeconds: config.EIV_SWEEP_INTERVAL_SEC * 2,
      },
    );
  }

  onModuleInit(): void {
    if (!this.config.EIV_WORKER_ENABLED) {
      this.logger.log("EIV worker disabled (EIV_WORKER_ENABLED=no)");
      return;
    }

    const intervalMs = this.config.EIV_SWEEP_INTERVAL_SEC * 1000;
    this.timer = setInterval(() => void this.tick(), intervalMs);
    // Does not hold the process open on its own; shutdown should not wait for
    // the next tick.
    this.timer.unref();

    this.logger.log(
      `EIV worker sweeping every ${this.config.EIV_SWEEP_INTERVAL_SEC}s ` +
        `against ${this.config.EIV_BASE_URL}` +
        (this.config.EIV_ALLOW_LIVE ? " (LIVE submissions allowed)" : ""),
    );
  }

  onModuleDestroy(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
  }

  /**
   * The deadline alarm, in its own try/catch.
   *
   * Separated from the submission sweep so a failure in either cannot suppress
   * the other. An alerting path that dies quietly when the thing it watches is
   * broken is the worst possible shape for this code.
   */
  private async sweepAlerts(now: Date): Promise<void> {
    try {
      const raised = await this.alerts.sweep(now);
      if (raised.length > 0) {
        this.logger.warn(`EIV deadline alerts raised: ${raised.length}`);
      }
    } catch (error) {
      this.logger.error(
        `EIV deadline alert sweep failed: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }

  /** Exposed so a test or an admin trigger can run one sweep synchronously. */
  async tick(now = new Date()): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      // Before the sweep, not after: if submitting throws, the deadline alarm
      // has already run. The one thing that must not depend on the EIV
      // interface being reachable is the alarm about the EIV interface not
      // being reachable.
      await this.sweepAlerts(now);

      const result = await this.service.sweep(now);
      if (result.considered > 0) {
        // Counts only. Nothing identifying a physician reaches a log line.
        this.logger.log(
          `EIV sweep: considered=${result.considered} submitted=${result.submitted} ` +
            `retrying=${result.retrying} abandoned=${result.abandoned} waiting=${result.waiting}`,
        );
      }
    } catch (error) {
      // Swallowed on purpose: an EIV outage must not take the API down. The
      // rows stay queued and the next tick retries them.
      this.logger.error(
        `EIV sweep failed: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    } finally {
      this.running = false;
    }
  }
}
