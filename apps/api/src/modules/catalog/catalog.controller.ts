/**
 * Catalog HTTP surface (P2-05). Interface layer — ADR-0006.
 *
 * Parses, authorises, delegates. No compliance decisions — those live further
 * in (`catalog.service.ts`, `packages/domain`).
 *
 * `CatalogService`/`CatalogRepository` are plain classes, constructed here
 * per request from the tenant-scoped `Db` the `@TenantDb()` decorator supplies
 * — see `db/tenant-db.decorator.ts` for why this is deliberately not NestJS
 * request-scoped DI. `CatalogController` itself stays an ordinary singleton.
 */

import { Controller, Get, Param, Query } from "@nestjs/common";
import { Roles } from "../../auth/roles.decorator.js";
import { AppError } from "../../shared/problem-details.js";
import { TenantDb } from "../../db/tenant-db.decorator.js";
import type { Db } from "../../db/tenant-db.js";
import { CatalogService } from "./catalog.service.js";
import { courseListQuerySchema } from "./catalog.dto.js";

const ANY_AUTHENTICATED_ROLE = [
  "learner",
  "department_admin",
  "customer_admin",
  "super_admin",
] as const;

@Controller("courses")
export class CatalogController {
  @Get()
  @Roles(...ANY_AUTHENTICATED_ROLE)
  async list(@Query() query: Record<string, unknown>, @TenantDb() db: Db) {
    const parsed = courseListQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new AppError(
        "validation",
        `invalid course list query: ${parsed.error.message}`,
        "One or more query parameters are invalid.",
      );
    }
    return CatalogService.fromDb(db).listCourses(parsed.data);
  }

  @Get(":slug")
  @Roles(...ANY_AUTHENTICATED_ROLE)
  async detail(@Param("slug") slug: string, @TenantDb() db: Db) {
    return CatalogService.fromDb(db).getCourseBySlug(slug);
  }
}
