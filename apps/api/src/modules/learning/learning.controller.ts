/**
 * Learning HTTP surface (P3). Interface layer — ADR-0006.
 *
 * Parse, delegate, return. The tenant and the learner identity come from
 * `request.principal`, which only `AuthGuard` writes — never from a path,
 * query or body field, so a client cannot act as another learner by asking to
 * (ADR-0002).
 */

import { Body, Controller, Get, HttpCode, Param, Post, Put } from "@nestjs/common";
import { Roles } from "../../auth/roles.decorator.js";
import { CurrentPrincipal } from "../../auth/current-principal.decorator.js";
import type { Principal } from "../../auth/principal.js";
import { AppError } from "../../shared/problem-details.js";
import { RateLimit } from "../../shared/rate-limit.guard.js";
import { TenantDb } from "../../db/tenant-db.decorator.js";
import type { Db } from "../../db/tenant-db.js";
import { LearningService } from "./learning.service.js";
import { progressReportSchema } from "./learning.dto.js";

@Controller("courses/:slug")
export class LearningController {
  @Put("enrolment")
  @Roles("learner", "department_admin", "customer_admin", "super_admin")
  async enrol(
    @Param("slug") slug: string,
    @CurrentPrincipal() principal: Principal,
    @TenantDb() db: Db,
  ) {
    return LearningService.fromDb(db).enrol(slug, {
      customerId: principal.customerId,
      userId: principal.userId,
    });
  }

  @Get("enrolment")
  @Roles("learner", "department_admin", "customer_admin", "super_admin")
  async getEnrolment(
    @Param("slug") slug: string,
    @CurrentPrincipal() principal: Principal,
    @TenantDb() db: Db,
  ) {
    return LearningService.fromDb(db).getState(slug, {
      customerId: principal.customerId,
      userId: principal.userId,
    });
  }

  /**
   * The lesson payload, behind the sequence gate.
   *
   * Deliberately not part of `GET /courses/{slug}` — see `getLesson`. A
   * padlock the client is merely asked to honour is not a gate.
   */
  @Get("contents/:contentId")
  @Roles("learner", "department_admin", "customer_admin", "super_admin")
  async getLesson(
    @Param("slug") slug: string,
    @Param("contentId") contentId: string,
    @CurrentPrincipal() principal: Principal,
    @TenantDb() db: Db,
  ) {
    return LearningService.fromDb(db).getLesson(slug, contentId, {
      customerId: principal.customerId,
      userId: principal.userId,
    });
  }

  @Get("materials")
  @Roles("learner", "department_admin", "customer_admin", "super_admin")
  async getMaterials(
    @Param("slug") slug: string,
    @CurrentPrincipal() principal: Principal,
    @TenantDb() db: Db,
  ) {
    return LearningService.fromDb(db).getMaterials(slug, {
      customerId: principal.customerId,
      userId: principal.userId,
    });
  }

  // 200, not Nest's default 201: reporting progress does not create a resource
  // at a new URL, and `contracts/openapi.yaml` is the authority on the status.
  @Post("contents/:contentId/progress")
  @HttpCode(200)
  @RateLimit("progress")
  @Roles("learner", "department_admin", "customer_admin", "super_admin")
  async recordProgress(
    @Param("slug") slug: string,
    @Param("contentId") contentId: string,
    @Body() body: unknown,
    @CurrentPrincipal() principal: Principal,
    @TenantDb() db: Db,
  ) {
    const parsed = progressReportSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError(
        "validation",
        `invalid progress report: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`,
        "The reported playback data is not in the expected format.",
      );
    }

    // The clock is read here, at the edge, and passed inward — `@ds/domain`
    // never reads a clock of its own (CLAUDE.md §4 invariant 4).
    return LearningService.fromDb(db).recordProgress(
      slug,
      contentId,
      parsed.data,
      { customerId: principal.customerId, userId: principal.userId },
      new Date(),
    );
  }
}
