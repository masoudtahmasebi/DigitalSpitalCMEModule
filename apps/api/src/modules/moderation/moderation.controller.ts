/**
 * Learner-record and certificate moderation endpoints (P12-05). Interface layer.
 *
 * ## `@Roles`, not `@StaffCapability`
 *
 * Unlike the customer registry, these act *inside* one tenant: an enrolment
 * belongs to a customer, and the request carries `X-DS-Project` to say which.
 * So the check is the ordinary tenant role check, and `AuthGuard` has already
 * resolved a `Principal` — which since ADR-0012 may be a staff account or a
 * learner-plane administrator, and carries `identity` to say which.
 *
 * `customer_admin` and `super_admin` only. A `department_admin` may run a
 * department and a `course_editor` may write courses; neither has business
 * correcting a physician's name or erasing a subject, and the capability model
 * says so (`learner_record` is not in their set).
 *
 * ## What no response here contains
 *
 * A full EFN. `listLearners` masks at the repository boundary, so there is no
 * shape this controller could serialise that would leak one (ADR-0004).
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
import { z } from "zod";
import { Roles } from "../../auth/roles.decorator.js";
import { RateLimit } from "../../shared/rate-limit.guard.js";
import { CurrentPrincipal } from "../../auth/current-principal.decorator.js";
import type { Principal } from "../../auth/principal.js";
import { TenantDb } from "../../db/tenant-db.decorator.js";
import type { Db } from "../../db/tenant-db.js";
import { PG_POOL } from "../../db/tokens.js";
import type { Pool } from "pg";
import { AuditService } from "../../audit/audit.service.js";
import {
  ModerationRepository,
  SubjectErasureRepository,
} from "./moderation.repository.js";
import { ModerationService, type ModeratorContext } from "./moderation.service.js";

const MODERATOR_ROLES = ["customer_admin", "super_admin"] as const;

const NameCorrection = z.object({
  name: z.string().trim().min(1).max(300),
});

const Erasure = z.object({
  /**
   * Why, for the audit trail. Free text and deliberately short — it is written
   * by an operator about a *process* ("Löschantrag vom 12.03."), never about
   * the person, and `erase_subject` truncates it to 200 characters.
   */
  reason: z.string().trim().min(1).max(200),
});

@Controller("admin")
export class ModerationController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Get("learners")
  @Roles(...MODERATOR_ROLES)
  listLearners(@Query("course") course: string | undefined, @TenantDb() db: Db) {
    return this.service(db).listLearners(emptyToUndefined(course));
  }

  @Get("certificates")
  @Roles(...MODERATOR_ROLES)
  listCertificates(@Query("course") course: string | undefined, @TenantDb() db: Db) {
    return this.service(db).listCertificates(emptyToUndefined(course));
  }

  /** Correct the name a certificate will carry (S4). Refused after submission. */
  @Patch("learners/:enrolmentId/name")
  @Roles(...MODERATOR_ROLES)
  @HttpCode(204)
  async correctName(
    @Param("enrolmentId") enrolmentId: string,
    @Body() body: unknown,
    @CurrentPrincipal() principal: Principal,
    @TenantDb() db: Db,
  ): Promise<void> {
    const input = NameCorrection.parse(body);
    await this.service(db).correctName(enrolmentId, input.name, context(principal));
  }

  /**
   * Erase a subject (GDPR Art. 17).
   *
   * `DELETE`, because it is one. Rate-limited hard: this is irreversible and
   * cross-tenant, and there is no version of "erase fifty subjects quickly"
   * that is not either a mistake or an attack.
   */
  @Delete("learners/:enrolmentId")
  @Roles(...MODERATOR_ROLES)
  @RateLimit("subjectErasure")
  async erase(
    @Param("enrolmentId") enrolmentId: string,
    @Body() body: unknown,
    @CurrentPrincipal() principal: Principal,
    @TenantDb() db: Db,
  ) {
    const input = Erasure.parse(body);
    return this.service(db).eraseSubject(enrolmentId, input.reason, context(principal));
  }

  @Post("certificates/:id/regenerate")
  @Roles(...MODERATOR_ROLES)
  @HttpCode(204)
  async regenerate(
    @Param("id") id: string,
    @CurrentPrincipal() principal: Principal,
    @TenantDb() db: Db,
  ): Promise<void> {
    await this.service(db).actOnCertificate(id, "regenerate", context(principal));
  }

  @Post("certificates/:id/resend")
  @Roles(...MODERATOR_ROLES)
  @HttpCode(204)
  async resend(
    @Param("id") id: string,
    @CurrentPrincipal() principal: Principal,
    @TenantDb() db: Db,
  ): Promise<void> {
    await this.service(db).actOnCertificate(id, "resend", context(principal));
  }

  @Post("certificates/:id/revoke")
  @Roles(...MODERATOR_ROLES)
  @HttpCode(204)
  async revoke(
    @Param("id") id: string,
    @CurrentPrincipal() principal: Principal,
    @TenantDb() db: Db,
  ): Promise<void> {
    await this.service(db).actOnCertificate(id, "revoke", context(principal));
  }

  /**
   * Built per request from the tenant `Db`, which only exists once the
   * interceptor has opened the RLS transaction — see CONTRIBUTING.md. The
   * erasure repository takes the raw pool instead, because a subject spans
   * tenants and `erase_subject` cannot run inside one.
   */
  private service(db: Db): ModerationService {
    return new ModerationService(
      new ModerationRepository(db),
      new SubjectErasureRepository(this.pool),
      new AuditService(this.pool),
    );
  }
}

function context(principal: Principal): ModeratorContext {
  return { customerId: principal.customerId, staffUserId: principal.userId };
}

/** A `?course=` with nothing after it means "all courses", not "the empty slug". */
function emptyToUndefined(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === "" ? undefined : value;
}
