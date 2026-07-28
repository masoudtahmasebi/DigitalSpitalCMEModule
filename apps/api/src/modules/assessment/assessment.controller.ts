/**
 * Assessment HTTP surface (P4). Interface layer — ADR-0006.
 *
 * Note there is no "score this for me" input anywhere: the request carries
 * which options were selected, and the response carries a verdict the server
 * reached. The client cannot assert a score, and cannot read the answer key
 * from any response shape this controller can return.
 */

import { Body, Controller, Get, HttpCode, Param, Post } from "@nestjs/common";
import { Roles } from "../../auth/roles.decorator.js";
import { CurrentPrincipal } from "../../auth/current-principal.decorator.js";
import type { Principal } from "../../auth/principal.js";
import { AppError } from "../../shared/problem-details.js";
import { TenantDb } from "../../db/tenant-db.decorator.js";
import type { Db } from "../../db/tenant-db.js";
import { AssessmentService } from "./assessment.service.js";
import { quizSubmissionSchema } from "./assessment.dto.js";

const LEARNER_ROLES = [
  "learner",
  "department_admin",
  "customer_admin",
  "super_admin",
] as const;

@Controller("courses/:slug/contents/:contentId/quiz")
export class AssessmentController {
  @Get()
  @Roles(...LEARNER_ROLES)
  async getQuiz(
    @Param("slug") slug: string,
    @Param("contentId") contentId: string,
    @CurrentPrincipal() principal: Principal,
    @TenantDb() db: Db,
  ) {
    return AssessmentService.fromDb(db).getQuiz(slug, contentId, {
      customerId: principal.customerId,
      userId: principal.userId,
    });
  }

  @Post()
  @HttpCode(200)
  @Roles(...LEARNER_ROLES)
  async submit(
    @Param("slug") slug: string,
    @Param("contentId") contentId: string,
    @Body() body: unknown,
    @CurrentPrincipal() principal: Principal,
    @TenantDb() db: Db,
  ) {
    const parsed = quizSubmissionSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError(
        "validation",
        `invalid quiz submission: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`,
        "Die übermittelten Antworten sind nicht im erwarteten Format.",
      );
    }

    return AssessmentService.fromDb(db).submit(slug, contentId, parsed.data, {
      customerId: principal.customerId,
      userId: principal.userId,
    });
  }
}
