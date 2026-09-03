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
import { APP_CONFIG, PG_POOL, PG_SIDE_POOL } from "../../db/tokens.js";
import type { AppConfig } from "../../config/config.js";
import { AuditService } from "../../audit/audit.service.js";
import { createSecretCipher } from "../../shared/secret-cipher.js";
import { pluginRegistry } from "../../plugins.js";
import { EivRepository } from "./eiv.repository.js";
import { EivAlertRepository } from "./eiv-alert.repository.js";
import { EivAlertService, WebhookAlertSink } from "./eiv-alert.service.js";
import { EivService, type EivSweepTarget } from "./eiv.service.js";
import { eivEndpointUrl } from "@ds/eiv-client";
import { PlatformSettingsRepository } from "../platform/platform-settings.repository.js";

@Injectable()
export class EivScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EivScheduler.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private readonly service: EivService;
  private readonly alerts: EivAlertService;
  private readonly settings: PlatformSettingsRepository;

  constructor(
    @Inject(PG_POOL) pool: Pool,
    @Inject(PG_SIDE_POOL) sidePool: Pool,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.alerts = new EivAlertService(
      new EivAlertRepository(pool),
      new AuditService(sidePool),
      this.logger,
      config.ALERT_WEBHOOK_URL === ""
        ? undefined
        : new WebhookAlertSink(config.ALERT_WEBHOOK_URL),
    );

    this.service = new EivService(
      new EivRepository(
        pool,
        createSecretCipher(config.NODE_ENV, config.SECRETS_KMS_KEY),
      ),
      pluginRegistry().require("accreditationReporter"),
      new AuditService(sidePool),
      {
        batchSize: config.EIV_SWEEP_BATCH_SIZE,
        // Two sweeps of headroom, so a slow submission is never double-claimed.
        leaseSeconds: config.EIV_SWEEP_INTERVAL_SEC * 2,
      },
    );

    this.settings = new PlatformSettingsRepository(sidePool);
  }

  /**
   * What the operator has switched on, right now (P180-01).
   *
   * Read on **every tick**, not at boot. That is the difference the client
   * asked for: `EIV_WORKER_ENABLED` and `EIV_BASE_URL` took a deploy to change,
   * so pausing submissions or moving to EIV's test system meant editing a file
   * on the host — and in practice nobody did. A worker that reads its own
   * switch once, hours before it is flipped, would have moved that problem
   * behind a screen rather than solving it.
   *
   * A failed read stops the sweep rather than defaulting. "Off" would be the
   * safe-looking default and it is the one that hides a broken installation: a
   * Punktemeldung approaching its statutory deadline would sit there with a
   * console reporting a worker that is on.
   */
  private async target(): Promise<
    { enabled: false } | ({ enabled: true } & EivSweepTarget)
  > {
    const row = await this.settings.read();
    if (!row.eivWorkerEnabled) return { enabled: false };

    const baseUrl = eivEndpointUrl(row.eivEndpoint, this.config.EIV_MOCK_BASE_URL);
    return {
      enabled: true,
      baseUrl,
      // Consent is a fact on the row, not a flag in a file — and it is the
      // service that still enforces it against the resolved address, so the two
      // halves cannot drift.
      allowLive: row.eivLiveConfirmedAt !== null,
    };
  }

  onModuleInit(): void {
    /*
     * The timer always starts (P180-01).
     *
     * Whether a sweep *does* anything is asked of `platform_settings` on each
     * tick — so an operator arming the worker in the console has it running
     * within a minute, rather than after the next deploy. The old shape
     * returned here and left a process that could not be switched on without a
     * restart, which is precisely what the client objected to.
     */
    const intervalMs = this.config.EIV_SWEEP_INTERVAL_SEC * 1000;
    this.timer = setInterval(() => void this.tick(), intervalMs);
    // Does not hold the process open on its own; shutdown should not wait for
    // the next tick.
    this.timer.unref();

    this.logger.log(
      `EIV worker armed: checking platform_settings every ` +
        `${this.config.EIV_SWEEP_INTERVAL_SEC}s. Whether it submits, and to ` +
        `which register, is set in the console (Plattform → Punktemeldung).`,
    );

    /*
     * Say, at boot, that deadline alerts have nowhere to go (QA §4.3, P147-01).
     *
     * `ALERT_WEBHOOK_URL` empty is a supported configuration and the alert does
     * still reach the log at `error` — so this is not broken. It is the §9.10a
     * shape instead: the consequence nobody wrote down. A statutory
     * Punktemeldung has eight days, and "somebody was reading the container log
     * at the right moment" is not a mechanism. On a host with no log shipping,
     * an approaching deadline alerts precisely nobody.
     *
     * Warned once, at boot, where an operator is already looking — rather than
     * on every sweep, which is how a warning becomes wallpaper. `deploy.sh`
     * prints the same thing at install time (P140); this is the running
     * system's own answer, because §9.9's corollary is that the repository's
     * state is not the installation's.
     */
    if (this.config.ALERT_WEBHOOK_URL === "") {
      this.logger.warn(
        "ALERT_WEBHOOK_URL is not set: EIV deadline alerts will be written to " +
          "this log and sent nowhere else. A submission approaching its " +
          "statutory deadline will not reach a person unless something ships " +
          "these logs.",
      );
    }
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

      const target = await this.target();
      if (!target.enabled) return;

      const result = await this.service.sweep(now, target);
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
