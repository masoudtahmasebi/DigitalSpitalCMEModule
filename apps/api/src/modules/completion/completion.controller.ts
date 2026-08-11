/**
 * Completion HTTP surface (P6, P1-06, P7). Interface layer — ADR-0006.
 *
 * The EFN routes live here rather than on a course, because an EFN belongs to
 * the physician, not to a participation (ADR-0004). Read and write are both
 * strictly self-service — the subject is always the authenticated principal
 * and never a path parameter (P54-02).
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
   * The caller's own EFN, or `{"efn": null}` (P54-02).
   *
   * This route reverses the "write-only" rule that stood until P54; the
   * reasoning for both directions is on `CompletionService.getEfn` and in
   * ADR-0004's amendment, and the one line that matters is here: **the subject
   * is the principal, never a parameter.** Adding a `:userId` to this path
   * would turn a self-service field into an EFN lookup service, which is the
   * thing the old rule was protecting.
   *
   * Rate-limited on its own bucket, not the write's (P57-01): the completion
   * screen asks on every mount, and sharing the write's ten-per-minute budget
   * meant a physician reloading while correcting a typo was refused in the
   * middle of the correction. Still metered — a route touching `efn_profiles`
   * should not be the one unlimited path into that table.
   */
  @Get("profile/efn")
  @RateLimit("efnRead")
  @Roles(...LEARNER_ROLES)
  async getEfn(
    @CurrentPrincipal() principal: Principal,
    @TenantDb() db: Db,
  ): Promise<{ efn: string | null; required: boolean }> {
    return CompletionService.fromDb(db).getEfn(context(principal));
  }

  /**
   * Store or correct the EFN. 204 with no body — the value the caller just
   * sent is not echoed, and `GET profile/efn` above is the way to read it back.
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
