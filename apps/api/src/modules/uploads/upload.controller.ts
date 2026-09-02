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

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import type { Pool } from "pg";
import { Roles } from "../../auth/roles.decorator.js";
import { CurrentPrincipal } from "../../auth/current-principal.decorator.js";
import type { Principal } from "../../auth/principal.js";
import { RateLimit } from "../../shared/rate-limit.guard.js";
import { AppError } from "../../shared/problem-details.js";
import { TenantDb } from "../../db/tenant-db.decorator.js";
import type { Db } from "../../db/tenant-db.js";
import { APP_CONFIG, PG_POOL, PG_SIDE_POOL } from "../../db/tokens.js";
import type { AppConfig } from "../../config/config.js";
import { objectStorageFor } from "../../shared/object-storage.factory.js";
import {
  NoAmbientTransaction,
  TenantRun,
  type TenantRunner,
} from "../../db/tenant-runner.js";
import {
  mediaDescribeSchema,
  mediaListSchema,
  multipartBeginSchema,
  multipartCompleteSchema,
  multipartSignSchema,
  uploadBeginSchema,
  uploadCompleteSchema,
  uploadViewSchema,
} from "./upload.dto.js";
import {
  RunnerUploadRepository,
  StorageAuditRecorder,
  UploadRepository,
} from "./upload.repository.js";
import { UploadService } from "./upload.service.js";
import type { ZodType } from "zod";

const AUTHOR_ROLES = ["customer_admin", "super_admin"] as const;

@Controller("admin")
export class UploadController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PG_POOL) private readonly pool: Pool,
    // The storage audit log's own connection — see PG_SIDE_POOL (P142-01).
    @Inject(PG_SIDE_POOL) private readonly sidePool: Pool,
  ) {}

  /**
   * The customer's media library (P81-02).
   *
   * `/admin/media`, flat — the one upload route that is deliberately **not**
   * under a course, because the thing being asked for is precisely the set of
   * files that outlives any one course. The comment at the top of this file
   * explains why the others are course-scoped and that reasoning still holds
   * for them: a course is half the key and the authorization boundary for a
   * *write*. This is a read of the customer's own index, bounded by RLS.
   *
   * GET with the filter in the query, unlike `view`: a kind and a page size are
   * not a physician's material, and a URL that can be linked and cached is the
   * right shape for a list.
   */
  @Get("media")
  @RateLimit("mediaUpload")
  @Roles(...AUTHOR_ROLES)
  async media(
    @Query() query: unknown,
    @CurrentPrincipal() principal: Principal,
    @TenantDb() db: Db,
  ) {
    return this.service(db, principal).list(parse(mediaListSchema, query, "media"));
  }

  /** A human title and the alt text a screen reader announces (P81-03). */
  @Patch("media/:id")
  @RateLimit("mediaUpload")
  @Roles(...AUTHOR_ROLES)
  async describeMedia(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentPrincipal() principal: Principal,
    @TenantDb() db: Db,
  ) {
    return this.service(db, principal).describe(
      id,
      parse(mediaDescribeSchema, body, "media"),
      actorOf(principal),
    );
  }

  /**
   * A short-lived read URL for a library entry (P88-01).
   *
   * POST rather than GET, matching `view`: it *mints a capability* and writes
   * an audit row, so it is not a cacheable read however much it looks like one.
   * No body — the entry's id is the whole question, and it is a uuid this
   * tenant can see or cannot.
   */
  @Post("media/:id/view")
  @RateLimit("mediaUpload")
  @Roles(...AUTHOR_ROLES)
  async viewMedia(
    @Param("id") id: string,
    @CurrentPrincipal() principal: Principal,
    @TenantDb() db: Db,
  ) {
    return this.service(db, principal).viewAsset(id, actorOf(principal), new Date());
  }

  /**
   * Forget a file (P81-03).
   *
   * 204: there is nothing to return, and the console re-reads the list. The
   * object in the bucket is untouched — see `UploadService.forget` for why a
   * convenience screen is not a second path to destroying course material.
   */
  @Delete("media/:id")
  @HttpCode(204)
  @RateLimit("mediaUpload")
  @Roles(...AUTHOR_ROLES)
  async forgetMedia(
    @Param("id") id: string,
    @CurrentPrincipal() principal: Principal,
    @TenantDb() db: Db,
  ) {
    await this.service(db, principal).forget(id, actorOf(principal));
  }

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

  @NoAmbientTransaction()
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
    @TenantRun() run: TenantRunner,
  ) {
    return this.runnerService(run, principal).complete(
      slug,
      parse(uploadCompleteSchema, body, "upload"),
      actorOf(principal),
      new Date(),
    );
  }

  /*
   * Multipart (P129-04). Three routes, all rate-limited as uploads.
   *
   * `signParts` is called repeatedly for one upload — every 32 parts — so it
   * carries the same limiter as the others rather than being treated as a cheap
   * read. It mints signatures, and a route that mints capabilities in a loop is
   * the one that most wants a ceiling on how fast it can be asked.
   */
  @NoAmbientTransaction()
  @Post("courses/:slug/uploads/multipart")
  @RateLimit("mediaUpload")
  @Roles(...AUTHOR_ROLES)
  async beginMultipart(
    @Param("slug") slug: string,
    @Body() body: unknown,
    @CurrentPrincipal() principal: Principal,
    @TenantRun() run: TenantRunner,
  ) {
    return this.runnerService(run, principal).beginMultipart(
      slug,
      parse(multipartBeginSchema, body, "upload"),
      actorOf(principal),
      new Date(),
    );
  }

  // 200: the upload already exists; this hands back URLs for part of it.
  @Post("courses/:slug/uploads/multipart/sign")
  @HttpCode(200)
  @RateLimit("mediaUpload")
  @Roles(...AUTHOR_ROLES)
  async signParts(
    @Param("slug") slug: string,
    @Body() body: unknown,
    @CurrentPrincipal() principal: Principal,
    @TenantDb() db: Db,
  ) {
    return this.service(db, principal).signParts(
      slug,
      parse(multipartSignSchema, body, "upload"),
      actorOf(principal),
      new Date(),
    );
  }

  @NoAmbientTransaction()
  @Post("courses/:slug/uploads/multipart/complete")
  @HttpCode(200)
  @RateLimit("mediaUpload")
  @Roles(...AUTHOR_ROLES)
  async completeMultipart(
    @Param("slug") slug: string,
    @Body() body: unknown,
    @CurrentPrincipal() principal: Principal,
    @TenantRun() run: TenantRunner,
  ) {
    return this.runnerService(run, principal).completeMultipart(
      slug,
      parse(multipartCompleteSchema, body, "upload"),
      actorOf(principal),
      new Date(),
    );
  }

  /**
   * A short-lived read URL for an object this course owns (P74-02).
   *
   * POST rather than GET, and the reference in the body rather than the query,
   * for the same reason `complete` takes a key in a body: a reference in a
   * query string is written to every access log between here and the browser,
   * and one of the things this route exists to make readable is a physician's
   * course material.
   *
   * 200 rather than 201: nothing is created. The object already exists and this
   * hands back a way to look at it.
   */
  @Post("courses/:slug/uploads/view")
  @HttpCode(200)
  @RateLimit("mediaUpload")
  @Roles(...AUTHOR_ROLES)
  async view(
    @Param("slug") slug: string,
    @Body() body: unknown,
    @CurrentPrincipal() principal: Principal,
    @TenantDb() db: Db,
  ) {
    return this.service(db, principal).view(
      slug,
      parse(uploadViewSchema, body, "upload"),
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
      new StorageAuditRecorder(this.sidePool, {
        customerId: principal.customerId,
        role: principal.role,
        ...(principal.userId === undefined ? {} : { userId: principal.userId }),
      }),
      objectStorageFor(this.config),
    );
  }

  /**
   * The same service, for a route that holds no open transaction (P145-01).
   *
   * The five routes below call the object store in the middle of their work.
   * Under the ambient transaction that call occupies a pooled connection for as
   * long as the bucket takes — so a slow or unreachable bucket degrades the
   * whole API rather than uploads alone. `RunnerUploadRepository` opens a short
   * transaction per query instead, leaving nothing held while the bucket is
   * thinking. See `db/tenant-runner.ts` for what that gives up.
   */
  private runnerService(run: TenantRunner, principal: Principal): UploadService {
    return new UploadService(
      new RunnerUploadRepository(run),
      new StorageAuditRecorder(this.sidePool, {
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
