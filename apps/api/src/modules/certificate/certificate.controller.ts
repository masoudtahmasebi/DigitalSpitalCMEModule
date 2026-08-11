/**
 * Certificate download (P8). Interface layer — ADR-0006.
 *
 * Streams the PDF rather than returning a URL: there is no object storage in
 * this budget, and a signed-URL indirection would add one for no benefit while
 * the document is generated in milliseconds.
 *
 * Email delivery to the learner via the customer's own SMTP is the intended
 * next step. The data and assets it needs are exactly what this endpoint
 * already assembles, so that becomes a second caller of `CertificateService`
 * rather than a second implementation — see `projects.smtp_*`, which already
 * carries the per-customer credentials.
 */

import { Controller, Get, Header, Param, StreamableFile } from "@nestjs/common";
import { RateLimit } from "../../shared/rate-limit.guard.js";
import { Roles } from "../../auth/roles.decorator.js";
import { CurrentPrincipal } from "../../auth/current-principal.decorator.js";
import type { Principal } from "../../auth/principal.js";
import { TenantDb } from "../../db/tenant-db.decorator.js";
import type { Db } from "../../db/tenant-db.js";
import { CertificateService } from "./certificate.service.js";

const LEARNER_ROLES = [
  "learner",
  "department_admin",
  "customer_admin",
  "super_admin",
] as const;

@Controller("courses/:slug/certificate")
export class CertificateController {
  /** The certificate's fields, for rendering a preview before download. */
  @Get()
  @Roles(...LEARNER_ROLES)
  async preview(
    @Param("slug") slug: string,
    @CurrentPrincipal() principal: Principal,
    @TenantDb() db: Db,
  ) {
    return CertificateService.fromDb(db).preview(slug, {
      customerId: principal.customerId,
      userId: principal.userId,
    });
  }

  /**
   * Returns a `StreamableFile` rather than writing to `@Res()` directly.
   *
   * That is not a style choice. `@Res()` writes the body from inside the route
   * handler, which runs *inside* the tenant transaction — so the learner could
   * receive a complete PDF before the row recording that it was issued had
   * committed, and a commit that then failed would leave a certificate in the
   * world that the system has no record of. Returning a value hands the write
   * back to `TenantTransactionInterceptor`, which responds only after COMMIT.
   */
  @Get("pdf")
  @RateLimit("certificatePdf")
  /*
   * No `@Header("content-type", …)` here (P56-02). `StreamableFile` below sets
   * it for the success path, and a decorator sets it *before* the handler runs
   * — so every refusal from this route went out as a problem document labelled
   * `application/pdf`. The filter now sets the type on every error, and this
   * route no longer has to claim one it may not produce.
   */
  // No-store: this is a named physician's participation record, and a shared
  // proxy holding a copy is a disclosure the learner did not agree to.
  @Header("cache-control", "no-store, private")
  @Roles(...LEARNER_ROLES)
  async download(
    @Param("slug") slug: string,
    @CurrentPrincipal() principal: Principal,
    @TenantDb() db: Db,
  ): Promise<StreamableFile> {
    const certificate = await CertificateService.fromDb(db).download(
      slug,
      { customerId: principal.customerId, userId: principal.userId },
      new Date(),
    );

    return new StreamableFile(Buffer.from(certificate.bytes), {
      type: "application/pdf",
      // `filenameFor` strips everything a header (or a filesystem) dislikes,
      // so the quoted value cannot be broken out of.
      disposition: `attachment; filename="${certificate.filename}"`,
    });
  }
}
