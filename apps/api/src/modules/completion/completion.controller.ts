/**
 * Completion HTTP surface (P6, P1-06, P7). Interface layer — ADR-0006.
 *
 * The EFN route lives here rather than on a course, because an EFN belongs to
 * the physician, not to a participation (ADR-0004). It is write-only: there is
 * deliberately no GET.
 */

import { Body, Controller, Get, HttpCode, Param, Post, Put } from "@nestjs/common";
import { Roles } from "../../auth/roles.decorator.js";
import { CurrentPrincipal } from "../../auth/current-principal.decorator.js";
import type { Principal } from "../../auth/principal.js";
import { AppError } from "../../shared/problem-details.js";
import { RateLimit } from "../../shared/rate-limit.guard.js";
import { TenantDb } from "../../db/tenant-db.decorator.js";
import type { Db } from "../../db/tenant-db.js";
import { CompletionService } from "./completion.service.js";
import {
  completionInputSchema,
  efnInputSchema,
  evaluationSubmissionSchema,
} from "./completion.dto.js";

const LEARNER_ROLES = [
  "learner",
  "department_admin",
  "customer_admin",
  "super_admin",
] as const;

@Controller()
export class CompletionController {
  @Get("courses/:slug/evaluation")
  @Roles(...LEARNER_ROLES)
  async getEvaluation(
    @Param("slug") slug: string,
    @CurrentPrincipal() principal: Principal,
    @TenantDb() db: Db,
  ) {
    return CompletionService.fromDb(db).getEvaluation(slug, context(principal));
  }

  @Post("courses/:slug/evaluation")
  @HttpCode(200)
  @Roles(...LEARNER_ROLES)
  async submitEvaluation(
    @Param("slug") slug: string,
    @Body() body: unknown,
    @CurrentPrincipal() principal: Principal,
    @TenantDb() db: Db,
  ) {
    const parsed = evaluationSubmissionSchema.safeParse(body);
    if (!parsed.success) {
      // The issue paths are field names, never the submitted values — an
      // evaluation answer is personal data (ADR-0004).
      throw new AppError(
        "validation",
        `invalid evaluation submission: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`,
        "Die Evaluation ist nicht im erwarteten Format.",
      );
    }

    return CompletionService.fromDb(db).submitEvaluation(
      slug,
      parsed.data,
      context(principal),
    );
  }

  /**
   * Write-only by design: 204 with no body, and no GET counterpart. Once
   * stored the EFN is reported to the Ärztekammer and never read back out
   * through the API (ADR-0004).
   */
  @Put("profile/efn")
  @HttpCode(204)
  @RateLimit("efnWrite")
  @Roles(...LEARNER_ROLES)
  async setEfn(
    @Body() body: unknown,
    @CurrentPrincipal() principal: Principal,
    @TenantDb() db: Db,
  ): Promise<void> {
    const parsed = efnInputSchema.safeParse(body);
    if (!parsed.success) {
      // Deliberately does not echo the rejected value back.
      throw new AppError(
        "validation",
        "EFN failed schema validation",
        "Die EFN muss aus genau 15 Ziffern bestehen.",
      );
    }

    await CompletionService.fromDb(db).setEfn(parsed.data.efn, context(principal));
  }

  @Post("courses/:slug/completion")
  @HttpCode(200)
  @RateLimit("completion")
  @Roles(...LEARNER_ROLES)
  async complete(
    @Param("slug") slug: string,
    @Body() body: unknown,
    @CurrentPrincipal() principal: Principal,
    @TenantDb() db: Db,
  ) {
    // The body is optional — a client that sends nothing completes with the
    // profile name — so an absent body parses as `{}` rather than failing.
    const parsed = completionInputSchema.safeParse(body ?? {});
    if (!parsed.success) {
      // A name is personal data; the message names the field, never the value.
      throw new AppError(
        "validation",
        "completion input failed schema validation",
        "Bitte geben Sie einen Namen für die Teilnahmebescheinigung an (höchstens 200 Zeichen).",
      );
    }

    // The clock is read at the edge and passed inward; the deadline arithmetic
    // in `@ds/domain` never reads one of its own.
    return CompletionService.fromDb(db).complete(
      slug,
      parsed.data,
      context(principal),
      new Date(),
    );
  }
}

function context(principal: Principal) {
  return { customerId: principal.customerId, userId: principal.userId };
}
