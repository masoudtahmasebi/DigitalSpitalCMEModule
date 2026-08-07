/**
 * Upload HTTP surface (P23-01). Interface layer — ADR-0006.
 *
 * ## Roles
 *
 * The same two as authoring: `customer_admin` and `super_admin`. A
 * `department_admin` may read reporting and may not change a course, and an
 * upload is a change to a course — it puts bytes into the customer's bucket and
 * produces a reference somebody will attach to a lesson.
 *
 * ## Why these routes live under a course
 *
 * `/admin/courses/{slug}/uploads` rather than `/admin/uploads`. The course is
 * not decoration in the path: it is half the key, it is what the mint is
 * recorded against, and it is what `complete` checks the mint's course id
 * matches. A flat upload endpoint would have to take a course id in the body,
 * where it would look like a parameter rather than the authorization boundary
 * it is.
 *
 * ## Rate limiting
 *
 * `mediaUpload`, its own bucket rather than the `adminUpload` one the font and
 * certificate-image routes use. Those write bytes into the database through
 * this process, so their limit is about a stuck client filling a disk. These
 * sign a URL and the bytes never touch us — and the legitimate shape here is a
 * burst, because seeding a fifteen-lesson course is dozens of files and two
 * requests each. Sharing the tighter limit produced a 429 partway through
 * exactly the task the feature exists for.
 */

import { Body, Controller, HttpCode, Inject, Param, Post } from "@nestjs/common";
import type { Pool } from "pg";
import { Roles } from "../../auth/roles.decorator.js";
import { CurrentPrincipal } from "../../auth/current-principal.decorator.js";
import type { Principal } from "../../auth/principal.js";
import { RateLimit } from "../../shared/rate-limit.guard.js";
import { AppError } from "../../shared/problem-details.js";
import { TenantDb } from "../../db/tenant-db.decorator.js";
import type { Db } from "../../db/tenant-db.js";
import { APP_CONFIG, PG_POOL } from "../../db/tokens.js";
import type { AppConfig } from "../../config/config.js";
import { objectStorageFor } from "../../shared/object-storage.factory.js";
import { uploadBeginSchema, uploadCompleteSchema } from "./upload.dto.js";
import { StorageAuditRecorder, UploadRepository } from "./upload.repository.js";
import { UploadService } from "./upload.service.js";
import type { ZodType } from "zod";

const AUTHOR_ROLES = ["customer_admin", "super_admin"] as const;

@Controller("admin")
export class UploadController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PG_POOL) private readonly pool: Pool,
  ) {}

  @Post("courses/:slug/uploads")
  @RateLimit("mediaUpload")
  @Roles(...AUTHOR_ROLES)
  async begin(
    @Param("slug") slug: string,
    @Body() body: unknown,
    @CurrentPrincipal() principal: Principal,
    @TenantDb() db: Db,
  ) {
    return this.service(db, principal).begin(
      slug,
      parse(uploadBeginSchema, body, "upload"),
      actorOf(principal),
      new Date(),
    );
  }

  @Post("courses/:slug/uploads/complete")
  // 200, not Nest's default 201 for a POST: nothing is created here. The object
  // already exists — this confirms it and hands back a reference. The contract
  // says 200 and a client that checked the status would have been misled.
  @HttpCode(200)
  @RateLimit("mediaUpload")
  @Roles(...AUTHOR_ROLES)
  async complete(
    @Param("slug") slug: string,
    @Body() body: unknown,
    @CurrentPrincipal() principal: Principal,
    @TenantDb() db: Db,
  ) {
    return this.service(db, principal).complete(
      slug,
      parse(uploadCompleteSchema, body, "upload"),
      actorOf(principal),
      new Date(),
    );
  }

  /**
   * The audit recorder gets the pool, not the request's `db`, deliberately.
   *
   * Its rows have to survive the request's transaction rolling back — a refusal
   * is the handler throwing, and an audit row rolled back with it would leave a
   * log of successes only. See `StorageAuditPort`.
   */
  private service(db: Db, principal: Principal): UploadService {
    return new UploadService(
      new UploadRepository(db),
      new StorageAuditRecorder(this.pool, {
        customerId: principal.customerId,
        role: principal.role,
        ...(principal.userId === undefined ? {} : { userId: principal.userId }),
      }),
      objectStorageFor(this.config),
    );
  }
}

function actorOf(principal: Principal) {
  return { customerId: principal.customerId, userId: principal.userId };
}

/** Parse, or refuse with the field paths — never the values. */
function parse<T>(schema: ZodType<T>, body: unknown, what: string): T {
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;

  const fields = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
  throw new AppError(
    "validation",
    `invalid ${what}: ${fields}`,
    "Die Eingaben sind nicht gültig. Bitte prüfen Sie die markierten Felder.",
  );
}
