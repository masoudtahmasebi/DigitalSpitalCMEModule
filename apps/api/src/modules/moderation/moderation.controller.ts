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
 * **Corrections** are `customer_admin` and `super_admin` only. A
 * `department_admin` may run a department and a `course_editor` may write
 * courses; neither has business correcting a physician's name, erasing a
 * subject or withdrawing a Teilnahmebescheinigung.
 *
 * **Reads** also accept `department_admin` (P41-02). This paragraph used to say
 * `learner_record` "is not in their set", which was simply false — the matrix
 * grants them `learner_record` and `certificate`, on the reasoning that they
 * run a department and the people in it. The console believed the matrix and
 * drew both screens; the API believed this comment and refused them. A comment
 * that disagrees with the code it describes is how a screen comes to exist that
 * nobody can open.
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
import { APP_CONFIG, PG_POOL, PG_SIDE_POOL } from "../../db/tokens.js";
import type { Pool } from "pg";
import { AuditService } from "../../audit/audit.service.js";
import type { AppConfig } from "../../config/config.js";
import { JsonLogger } from "../../observability/logger.js";
import {
  objectErasureFor,
  ObjectErasureService,
} from "../certificate/object-erasure.service.js";
import {
  ModerationRepository,
  SubjectErasureRepository,
} from "./moderation.repository.js";
import { ModerationService, type ModeratorContext } from "./moderation.service.js";

const MODERATOR_ROLES = ["customer_admin", "super_admin"] as const;

/**
 * Who may **read** a department's participation records (P41-02).
 *
 * `department_admin` is added here and to nothing below it, and the split is
 * the point.
 *
 * The domain's capability matrix grants them `learner_record` and
 * `certificate` — deliberately, and its own comment says why: they run "one
 * department: projects and courses within it, **and the people who take
 * them**". The console draws Teilnehmende and Bescheinigungen on that basis.
 * These two reads refused them, so both screens could only ever render an
 * error, which is the third instance of that shape this week (P38-02) and the
 * reason `scripts/role-matrix.mjs` now exists.
 *
 * The corrections stay `MODERATOR_ROLES`. Changing a physician's name,
 * erasing a subject and withdrawing a Teilnahmebescheinigung are acts against
 * a CME record with a chamber on the other end of it, and the header's
 * reasoning holds for those even though it was wrong about the matrix: a
 * department administrator has no business doing them, and now cannot.
 */
const RECORD_READERS = ["department_admin", ...MODERATOR_ROLES] as const;

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
  /**
   * Built once from configuration; `undefined` without object storage, in
   * which case nothing was ever archived and there is nothing to delete.
   */
  private readonly objectErasure: ObjectErasureService | undefined;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    /**
     * Both second-connection users on this screen take the side pool
     * (P142-01): the audit log because its row must outlive the rollback of
     * what it audits, and `SubjectErasureRepository` because a subject spans
     * tenants and cannot run inside the request's. Taken from `PG_POOL` these
     * are checkout number two while the request holds number one, and enough
     * concurrent erasures would deadlock it.
     */
    @Inject(PG_SIDE_POOL) private readonly sidePool: Pool,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.objectErasure = objectErasureFor(pool, config, new JsonLogger("info"));
  }

  @Get("learners")
  @Roles(...RECORD_READERS)
  listLearners(@Query("course") course: string | undefined, @TenantDb() db: Db) {
    return this.service(db).listLearners(emptyToUndefined(course));
  }

  @Get("certificates")
  @Roles(...RECORD_READERS)
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
      new SubjectErasureRepository(this.sidePool),
      new AuditService(this.sidePool),
      this.objectErasure,
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
