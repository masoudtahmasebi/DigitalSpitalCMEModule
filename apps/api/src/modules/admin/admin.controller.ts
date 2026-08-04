/**
 * Admin console HTTP surface (P9). Interface layer — ADR-0006.
 *
 * ## Roles
 *
 * Nothing here is reachable by a `learner`. That is the guard's job, but it is
 * worth stating why the list is what it is: `department_admin` sees their own
 * department's data because RLS scopes it, `customer_admin` sees the customer,
 * and `super_admin` acts as one customer at a time through the same
 * `X-DS-Project` binding as everyone else. There is no cross-tenant read
 * anywhere in this controller, and none is possible — the connection this runs
 * on is not `BYPASSRLS` (ADR-0002).
 *
 * A hidden navigation item in the console is a convenience. The refusal is
 * here.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  Inject,
  Param,
  Patch,
  Put,
  StreamableFile,
} from "@nestjs/common";
import { RateLimit } from "../../shared/rate-limit.guard.js";
import { Roles } from "../../auth/roles.decorator.js";
import { CurrentPrincipal } from "../../auth/current-principal.decorator.js";
import type { Principal } from "../../auth/principal.js";
import { AppError } from "../../shared/problem-details.js";
import { TenantDb } from "../../db/tenant-db.decorator.js";
import type { Db } from "../../db/tenant-db.js";
import { APP_CONFIG } from "../../db/tokens.js";
import type { AppConfig } from "../../config/config.js";
import { createSecretCipher } from "../../shared/secret-cipher.js";
import { AdminService } from "./admin.service.js";
import { participantsToCsv } from "./participant-csv.js";
import {
  adminCourseUpdateSchema,
  certificateAssetSchema,
  fontUploadSchema,
} from "./admin.dto.js";

const ADMIN_ROLES = ["department_admin", "customer_admin", "super_admin"] as const;

@Controller("admin")
export class AdminController {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  @Get("courses")
  @Roles(...ADMIN_ROLES)
  async listCourses(@TenantDb() db: Db) {
    return this.service(db).listCourses();
  }

  @Get("courses/:slug")
  @Roles(...ADMIN_ROLES)
  async getCourse(@Param("slug") slug: string, @TenantDb() db: Db) {
    return this.service(db).getCourse(slug);
  }

  @Patch("courses/:slug")
  @Roles("customer_admin", "super_admin")
  async updateCourse(
    @Param("slug") slug: string,
    @Body() body: unknown,
    @CurrentPrincipal() principal: Principal,
    @TenantDb() db: Db,
  ) {
    const parsed = adminCourseUpdateSchema.safeParse(body);
    if (!parsed.success) {
      // Field paths, never values — one of the fields is the VNR password.
      throw new AppError(
        "validation",
        `invalid course update: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`,
        "Die Eingaben sind nicht gültig. Bitte prüfen Sie die markierten Felder.",
      );
    }

    return this.service(db).updateCourse(slug, parsed.data, context(principal));
  }

  /**
   * The stamp and signature of the Wissenschaftliche Leitung.
   *
   * PUT because it replaces whatever is stored — a certificate carries one
   * stamp, and "add another" has no meaning. Base64 in JSON rather than
   * multipart: these are a few kilobytes, the API is otherwise entirely JSON,
   * and adding a multipart parser would add a file-upload attack surface for
   * one endpoint.
   */
  @Put("courses/:slug/certificate-assets")
  @RateLimit("adminUpload")
  @Roles("customer_admin", "super_admin")
  async setCertificateAssets(
    @Param("slug") slug: string,
    @Body() body: unknown,
    @CurrentPrincipal() principal: Principal,
    @TenantDb() db: Db,
  ) {
    const parsed = certificateAssetSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError(
        "validation",
        `invalid certificate asset upload: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`,
        "Die hochgeladene Datei ist nicht gültig. Zulässig sind PNG und JPEG bis 512 KB.",
      );
    }

    return this.service(db).setCertificateAssets(slug, parsed.data, context(principal));
  }

  /**
   * The white-label font (P10-08).
   *
   * ## Why the project comes from the header
   *
   * `X-DS-Project` is the same binding every other request carries, and it is
   * not trusted here any more than anywhere else: the write runs inside the
   * tenant transaction, so RLS scopes it to the caller's customer. A slug
   * belonging to another customer updates zero rows and comes back as the same
   * 404 as a slug that does not exist — no cross-tenant write, and no oracle
   * for which project slugs are real (ADR-0002, ADR-0007).
   *
   * Taking it from the header rather than the path also keeps the console from
   * having to know a project id it is never told.
   *
   * ## Why `customer_admin` and above
   *
   * A department admin manages their department's participants. Replacing the
   * typeface changes what every learner of every course in the project sees,
   * which is a customer-level decision.
   */
  @Get("branding/font")
  @Roles(...ADMIN_ROLES)
  async getFont(@Headers("x-ds-project") projectSlug: string, @TenantDb() db: Db) {
    return this.service(db).getFont(projectSlug);
  }

  /**
   * Upload a font.
   *
   * PUT because a project has one typeface; "add another" has no meaning.
   * Base64 in JSON rather than multipart for the same reason as the certificate
   * assets — the API is otherwise entirely JSON, and a multipart parser is a
   * file-upload attack surface added for one endpoint.
   *
   * The bytes are validated by `@ds/domain`'s sniffer in the service. Nothing
   * about the declared type or the filename is believed.
   */
  @Put("branding/font")
  @RateLimit("adminUpload")
  @Roles("customer_admin", "super_admin")
  async setFont(
    @Headers("x-ds-project") projectSlug: string,
    @Body() body: unknown,
    @CurrentPrincipal() principal: Principal,
    @TenantDb() db: Db,
  ) {
    const parsed = fontUploadSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError(
        "validation",
        `invalid font upload: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`,
        "Die hochgeladene Schriftdatei ist nicht gültig. Zulässig sind WOFF2 und WOFF bis 2 MB.",
      );
    }

    return this.service(db).setFont(projectSlug, parsed.data, context(principal));
  }

  @Delete("branding/font")
  @Roles("customer_admin", "super_admin")
  async clearFont(
    @Headers("x-ds-project") projectSlug: string,
    @CurrentPrincipal() principal: Principal,
    @TenantDb() db: Db,
  ) {
    return this.service(db).clearFont(projectSlug, context(principal));
  }

  @Get("courses/:slug/participants")
  @Roles(...ADMIN_ROLES)
  async listParticipants(@Param("slug") slug: string, @TenantDb() db: Db) {
    return this.service(db).listParticipants(slug, new Date());
  }

  /**
   * The same rows as the list, as CSV (P9-07).
   *
   * Built from `listParticipants`, not from a second query — the acceptance
   * criterion is that the export contains exactly the rows the list shows, and
   * the only way to guarantee that is for both to be the same rows.
   */
  @Get("courses/:slug/participants.csv")
  @RateLimit("adminExport")
  @Header("content-type", "text/csv; charset=utf-8")
  // A participant list is personal data; no shared cache should hold a copy.
  @Header("cache-control", "no-store, private")
  @Roles(...ADMIN_ROLES)
  async exportParticipants(
    @Param("slug") slug: string,
    @CurrentPrincipal() principal: Principal,
    @TenantDb() db: Db,
  ): Promise<StreamableFile> {
    const service = this.service(db);
    const list = await service.listParticipants(slug, new Date());

    // Audited because this is where personal data leaves the system's
    // access controls entirely — a spreadsheet on a laptop is outside all of
    // them (P9-07). Row count, never row content.
    await service.auditExport(slug, list.rows.length, context(principal));

    return new StreamableFile(Buffer.from(participantsToCsv(list.rows), "utf8"), {
      type: "text/csv; charset=utf-8",
      disposition: `attachment; filename="teilnehmende-${safeFilename(slug)}.csv"`,
    });
  }

  private service(db: Db): AdminService {
    return AdminService.fromDb(
      db,
      createSecretCipher(this.config.NODE_ENV, this.config.SECRETS_KMS_KEY),
    );
  }
}

function context(principal: Principal) {
  return { customerId: principal.customerId, userId: principal.userId };
}

/** Slugs are already tame, but a filename must never carry a quote or CRLF. */
function safeFilename(slug: string): string {
  return slug.replace(/[^A-Za-z0-9-]+/g, "-").slice(0, 60);
}
