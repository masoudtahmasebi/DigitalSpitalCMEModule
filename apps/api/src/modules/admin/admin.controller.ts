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
 *
 * ## `course_editor`, and the hole it was in (P38-01)
 *
 * The role the client asked for in as many words — *"customer users who can
 * create only courses, so they have limited access"* — was declared in
 * `@ds/domain`, granted `course` and `content` by the capability matrix,
 * offered on the Konten screen as something to assign, and **accepted by no
 * route anywhere**. An account holding it could sign in and then met "Ihr Konto
 * hat keine Berechtigung für die Verwaltung", because the console's first
 * request is `GET /admin/courses` and that 403'd.
 *
 * A role that grants access to nothing is worse than an absent one: it can be
 * handed out, it looks like a decision, and the person holding it cannot work.
 * So the course and content surfaces below now accept it, and nothing else
 * does. The boundary is exactly the capability matrix: `course`, `content`,
 * and the *reads* those two need — a course list a course editor cannot read is
 * a course they cannot edit.
 *
 * What it still may not touch, stated because a permission is easier to widen
 * than to narrow: departments, projects, participants, certificates, branding,
 * staff accounts and the customer registry.
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
import { allSeekable } from "./media-check.service.js";
import { participantsToCsv } from "./participant-csv.js";
import {
  adminCourseUpdateSchema,
  certificateAssetSchema,
  fontUploadSchema,
} from "./admin.dto.js";

const ADMIN_ROLES = ["department_admin", "customer_admin", "super_admin"] as const;

/**
 * The roles that may read and write a course itself.
 *
 * `course_editor` is here and is not in `ADMIN_ROLES`, which is the whole
 * distinction: they author courses and see nothing about the people taking
 * them. `department_admin` is in both — they run a department, which contains
 * courses and the participants in them.
 */
const COURSE_ROLES = [
  "course_editor",
  "department_admin",
  "customer_admin",
  "super_admin",
] as const;

@Controller("admin")
export class AdminController {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  @Get("courses")
  @Roles(...COURSE_ROLES)
  async listCourses(@TenantDb() db: Db) {
    return this.service(db).listCourses();
  }

  @Get("courses/:slug")
  @Roles(...COURSE_ROLES)
  async getCourse(@Param("slug") slug: string, @TenantDb() db: Db) {
    return this.service(db).getCourse(slug);
  }

  /*
   * `course_editor` too (P38-01): this is the course's own settings — its VNR,
   * its points, its pass threshold, its Veranstalter. Withholding it would
   * leave the role able to create a course and unable to make it certifiable,
   * which is not "limited access", it is a dead end. The compliance floor is
   * enforced in the service for every caller alike: the pass threshold cannot
   * go below the accredited minimum whoever is asking.
   */
  @Patch("courses/:slug")
  @Roles(...COURSE_ROLES)
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
  /**
   * Can a browser seek this course's videos? (P62-03)
   *
   * An operator route because the answer names a URL — §9.5 keeps that away
   * from a learner and §9.10 says it belongs with the audience already
   * entitled to it. It reports rather than refusing: a host healthy at publish
   * time can be wedged an hour later.
   */
  /**
   * Can every source in this course be seeked? (P62-03, P63-04.)
   *
   * `seekable` is the answer and the list is the evidence, in that order. A
   * five-module course probes fifteen URLs, and a response that was only the
   * list would make an operator read fifteen rows to learn one thing —
   * `allSeekable` exists to say it, and until P63-04 nothing called it.
   */
  @Get("courses/:slug/media-check")
  @Roles("department_admin", "customer_admin", "super_admin")
  async checkMedia(@Param("slug") slug: string, @TenantDb() db: Db) {
    const sources = await this.service(db).checkCourseMedia(slug);
    return { seekable: allSeekable(sources), sources };
  }

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
  return {
    customerId: principal.customerId,
    userId: principal.userId,
    identity: principal.identity,
  };
}

/** Slugs are already tame, but a filename must never carry a quote or CRLF. */
function safeFilename(slug: string): string {
  return slug.replace(/[^A-Za-z0-9-]+/g, "-").slice(0, 60);
}
