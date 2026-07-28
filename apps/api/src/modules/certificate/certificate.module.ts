import { Module } from "@nestjs/common";
import { CertificateController } from "./certificate.controller.js";
import { CertificateDeliveryScheduler } from "./delivery.scheduler.js";

/**
 * Controllers only — see CONTRIBUTING.md for the per-request construction
 * pattern — plus the delivery worker, which is a background timer rather than a
 * request path and so has to be a provider Nest owns the lifecycle of (P8-03).
 */
@Module({
  controllers: [CertificateController],
  providers: [CertificateDeliveryScheduler],
})
export class CertificateModule {}
