/**
 * Runs the certificate delivery sweep on an interval (P8-03).
 *
 * The same shape as `EivScheduler`, for the same reasons: a plain timer over a
 * database queue with `FOR UPDATE SKIP LOCKED`, so correctness under multiple
 * instances comes from Postgres rather than from leader election; never
 * overlapping; never fatal; stops cleanly on redeploy.
 *
 * ## It does nothing when no channel is registered
 *
 * `deliveryChannel` is unregistered in a deployment with no SMTP configured
 * (ADR-0010), and that is a supported state rather than a misconfiguration. The
 * scheduler logs that once at startup and never starts a timer, so a
 * certificate simply stays downloadable and is never emailed — which is exactly
 * what the platform did before this worker existed.
 *
 * ## Slower than the EIV sweep, on purpose
 *
 * The Punktemeldung is racing an 8-day statutory window and sweeps every
 * minute. A certificate has no deadline, and its retry policy backs off over
 * about a day; sweeping it every minute would mean 1,440 claims a day to
 * discover that six rows are still waiting out their backoff.
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
import { pluginRegistry } from "../../plugins.js";
import { DeliveryRepository } from "./delivery.repository.js";
import { CertificateDeliveryService } from "./delivery.service.js";
import { CertificateAttachments } from "./delivery.attachment.js";

@Injectable()
export class CertificateDeliveryScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CertificateDeliveryScheduler.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private readonly service: CertificateDeliveryService | undefined;

  constructor(
    @Inject(PG_POOL) pool: Pool,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    const channel = pluginRegistry().find("deliveryChannel");
    if (channel === undefined) {
      this.service = undefined;
      return;
    }

    this.service = new CertificateDeliveryService(
      new DeliveryRepository(
        pool,
        createSecretCipher(config.NODE_ENV, config.SECRETS_KMS_KEY),
      ),
      channel,
      new AuditService(pool),
      {
        batchSize: config.CERTIFICATE_DELIVERY_BATCH_SIZE,
        // Two sweeps of headroom, so a slow SMTP round trip is never
        // double-claimed and a physician never receives two copies.
        leaseSeconds: config.CERTIFICATE_DELIVERY_INTERVAL_SEC * 2,
        portalBaseUrl: config.PORTAL_BASE_URL,
      },
      // The attachment the e-mail is about (P59-02).
      new CertificateAttachments(pool, this.logger),
    );
  }

  onModuleInit(): void {
    if (this.service === undefined) {
      this.logger.log(
        "certificate delivery disabled: no deliveryChannel registered — " +
          "certificates remain downloadable and are not emailed",
      );
      return;
    }

    if (!this.config.CERTIFICATE_DELIVERY_ENABLED) {
      this.logger.log("certificate delivery disabled (CERTIFICATE_DELIVERY_ENABLED=no)");
      return;
    }

    const intervalMs = this.config.CERTIFICATE_DELIVERY_INTERVAL_SEC * 1000;
    this.timer = setInterval(() => void this.tick(), intervalMs);
    // Does not hold the process open on its own; shutdown should not wait for
    // the next tick.
    this.timer.unref();

    this.logger.log(
      `certificate delivery sweeping every ${this.config.CERTIFICATE_DELIVERY_INTERVAL_SEC}s`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
  }

  /** Exposed so a test or an admin trigger can run one sweep synchronously. */
  async tick(now = new Date()): Promise<void> {
    if (this.running || this.service === undefined) return;
    this.running = true;

    try {
      const result = await this.service.sweep(now);
      if (result.considered > 0) {
        // Counts only. Nothing identifying a physician reaches a log line —
        // not a name, not an address, not a certificate's download token.
        this.logger.log(
          `certificate delivery: considered=${result.considered} ` +
            `delivered=${result.delivered} retrying=${result.retrying} ` +
            `abandoned=${result.abandoned} waiting=${result.waiting}`,
        );
      }
    } catch (error) {
      // Swallowed on purpose: a mail server outage must not take the API down.
      // The rows stay queued and the next tick retries them — and the learner
      // could download the certificate the whole time regardless.
      this.logger.error(
        `certificate delivery sweep failed: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    } finally {
      this.running = false;
    }
  }
}
