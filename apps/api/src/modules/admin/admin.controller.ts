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
  Get,
  Header,
  Inject,
  Param,
  Patch,
  Put,
  StreamableFile,
} from "@nestjs/common";
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
import { adminCourseUpdateSchema, certificateAssetSchema } from "./admin.dto.js";

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
    return AdminService.fromDb(db, createSecretCipher(this.config.NODE_ENV));
  }
}

function context(principal: Principal) {
  return { customerId: principal.customerId, userId: principal.userId };
}

/** Slugs are already tame, but a filename must never carry a quote or CRLF. */
function safeFilename(slug: string): string {
  return slug.replace(/[^A-Za-z0-9-]+/g, "-").slice(0, 60);
}
