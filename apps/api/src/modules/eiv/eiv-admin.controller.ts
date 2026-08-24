/**
 * Operator-facing EIV endpoints (P31-02). Interface layer. **Human review
 * gate.**
 *
 * ## Why these are not on `ModerationController`
 *
 * Everything here talks to a third party over the network on the request path.
 * That is a different risk profile from correcting a name in our own database:
 * it can hang, it can rate-limit, and it can create or destroy a legally
 * meaningful CME record at an Ärztekammer. Keeping it in one file means the
 * timeout, the 502 mapping and the rate limits are in one place rather than
 * mixed in among local writes.
 *
 * ## `customer_admin` and above, and rate-limited
 *
 * The same roles as the rest of learner-record moderation: a `course_editor`
 * writes courses and has no business withdrawing a physician's points. The
 * write paths are rate-limited because each one is an outbound call somebody
 * else pays for, and a withdrawal is irreversible inside a window measured in
 * days.
 *
 * ## What no response here contains
 *
 * A full EFN — the reconciliation masks to four digits at the service boundary
 * (ADR-0004) — and no credential, ever. `AppError`'s client detail is written
 * by hand for exactly that reason; the authority's raw message goes to the log,
 * not to the browser.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import type { Pool } from "pg";
import { z } from "zod";
import { Roles } from "../../auth/roles.decorator.js";
import { CurrentPrincipal } from "../../auth/current-principal.decorator.js";
import type { Principal } from "../../auth/principal.js";
import { AppError } from "../../shared/problem-details.js";
import { TenantDb } from "../../db/tenant-db.decorator.js";
import type { Db } from "../../db/tenant-db.js";
import { APP_CONFIG, PG_POOL } from "../../db/tokens.js";
import { AuditService } from "../../audit/audit.service.js";
import { createSecretCipher } from "../../shared/secret-cipher.js";
import type { AppConfig } from "../../config/config.js";
import { pluginRegistry } from "../../plugins.js";
import { EivAdminRepository } from "./eiv-admin.repository.js";
import { listEivSubmissionsQuerySchema } from "./eiv-admin.dto.js";
import { EivAdminService, type EivOperatorContext } from "./eiv-admin.service.js";

const MODERATOR_ROLES = ["customer_admin", "super_admin"] as const;

const Withdrawal = z.object({
  /**
   * Why, for the audit trail. About the *process* — "Widerruf auf Wunsch der
   * Teilnehmerin, Ticket 4711" — never about the person.
   */
  reason: z.string().trim().min(1).max(200),
});

/**
 * The connection check's body (P103-01).
 *
 * `vnrPassword` optional: absent means "use the one already stored", which is
 * the ordinary case once a course is configured. Present means an operator is
 * proving a credential *before* saving it — the order somebody actually works
 * in, since otherwise the only way to test a new password is to overwrite the
 * working one.
 *
 * Not trimmed. A password is bytes the Ärztekammer issued, and silently
 * removing a leading space would make this check disagree with the worker,
 * which sends what is stored. `.max()` only so an unbounded body cannot become
 * an unbounded header.
 */
const eivCheckSchema = z.object({
  vnrPassword: z.string().min(1).max(200).optional(),
});

@Controller("admin")
export class EivAdminController {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * The Punktemeldung queue (P110-01).
   *
   * Two routes have taken a submission id since P31-02 — requeue and withdraw —
   * and nothing listed them, so the console offered actions on rows an operator
   * had no way to find. §9.2 in its second form: not a control that cannot
   * work, but a control that cannot be reached.
   *
   * Dates cross as ISO strings because that is what the contract says and what
   * every other admin route does; the console formats them in German local
   * time, which is a presentation concern (§5).
   */
  @Get("eiv/submissions")
  @Roles(...MODERATOR_ROLES)
  async listEivSubmissions(
    @Query() rawQuery: Record<string, unknown>,
    @TenantDb() db: Db,
  ) {
    const parsed = listEivSubmissionsQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      throw new AppError(
        "validation",
        `invalid EIV submission query: ${parsed.error.message}`,
        "Einer der Filter ist ungültig.",
      );
    }
    const query = parsed.data;

    const page = await this.service(db).listSubmissions({
      ...(query.status === undefined ? {} : { status: query.status }),
      page: query.page,
      perPage: query.perPage,
      now: new Date(),
    });

    return {
      items: page.items.map((row) => ({
        enrolmentId: row.enrolmentId,
        efnMasked: row.efnMasked,
        courseSlug: row.courseSlug,
        courseTitle: row.courseTitle,
        vnr: row.vnr,
        status: row.status,
        attemptCount: row.attemptCount,
        eventEndAt: row.eventEndAt.toISOString(),
        reportDueAt: row.reportDueAt.toISOString(),
        nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null,
        firstSubmittedAt: row.firstSubmittedAt?.toISOString() ?? null,
        externalReference: row.externalReference,
        lastError: row.lastError,
        dueNow: row.dueNow,
      })),
      total: page.total,
      page: query.page,
      perPage: query.perPage,
      dueNow: page.dueNow,
    };
  }

  /**
   * Read-only, so no rate limit beyond the global one: an operator refreshing
   * this costs one authenticated GET at EIV and creates nothing.
   */
  @Get("courses/:slug/eiv/event")
  @Roles(...MODERATOR_ROLES)
  async describeEvent(@Param("slug") slug: string, @TenantDb() db: Db) {
    const event = await this.service(db).describeEvent(slug);

    // Explicit nulls rather than absent keys: the console renders "—" for a
    // field the authority did not send, and `undefined` would disappear
    // through JSON and become indistinguishable from a field we forgot.
    return {
      title: event.title ?? null,
      validFrom: event.validFrom ?? null,
      validUntil: event.validUntil ?? null,
      category: event.category ?? null,
      attendancePoints: event.attendancePoints ?? null,
      assessmentPoints: event.assessmentPoints ?? null,
      locked: event.locked ?? null,
    };
  }

  /**
   * Prove the VNR and password reach EIV, before a physician's deadline
   * depends on it (P103-01).
   *
   * `POST` rather than `GET` because it carries a credential in the body and a
   * password must never land in a URL — a query string reaches the access log,
   * the browser history and any proxy in between.
   *
   * **This route cannot file a Punktemeldung.** It reaches
   * `EivAdminService.checkConnection`, which touches the two read-only
   * capabilities and never names `submit`. That is a property of the code
   * rather than of this comment; see the service for why it is drawn there.
   *
   * `customer_admin` and above, matching every other operation on this
   * controller: the VNR password is the customer's credential with the
   * Ärztekammer, and proving it is an act on their accreditation.
   */
  @Post("courses/:slug/eiv/check")
  @Roles(...MODERATOR_ROLES)
  async checkConnection(
    @Param("slug") slug: string,
    @Body() body: unknown,
    @CurrentPrincipal() principal: Principal,
    @TenantDb() db: Db,
  ) {
    const parsed = eivCheckSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new AppError(
        "validation",
        `invalid eiv check body: ${parsed.error.message}`,
        // Names the field, never the value — the value here is a password
        // (§9.5).
        "Das angegebene VNR-Passwort ist ungültig.",
      );
    }

    return this.service(db).checkConnection(
      slug,
      parsed.data.vnrPassword,
      context(principal),
    );
  }

  @Get("courses/:slug/eiv/reported")
  @Roles(...MODERATOR_ROLES)
  async reconcile(@Param("slug") slug: string, @TenantDb() db: Db) {
    return this.service(db).reconcile(slug);
  }

  @Post("learners/:enrolmentId/eiv")
  @Roles(...MODERATOR_ROLES)
  @HttpCode(204)
  async requeue(
    @Param("enrolmentId") enrolmentId: string,
    @CurrentPrincipal() principal: Principal,
    @TenantDb() db: Db,
  ): Promise<void> {
    await this.service(db).requeue(enrolmentId, context(principal), new Date());
  }

  /**
   * `DELETE`, because from the operator's side the Punktemeldung is being taken
   * back. EIV keeps the record with the points zeroed; nothing is deleted
   * anywhere, and the audit row says who and why.
   */
  @Delete("learners/:enrolmentId/eiv")
  @Roles(...MODERATOR_ROLES)
  @HttpCode(204)
  async withdraw(
    @Param("enrolmentId") enrolmentId: string,
    @Body() body: unknown,
    @CurrentPrincipal() principal: Principal,
    @TenantDb() db: Db,
  ): Promise<void> {
    const input = Withdrawal.parse(body);
    await this.service(db).withdraw(
      enrolmentId,
      input.reason,
      context(principal),
      new Date(),
    );
  }

  /**
   * Built per request from the tenant `Db`, which only exists once the
   * interceptor has opened the RLS transaction — see CONTRIBUTING.md.
   */
  private service(db: Db): EivAdminService {
    return new EivAdminService(
      new EivAdminRepository(
        db,
        createSecretCipher(this.config.NODE_ENV, this.config.SECRETS_KMS_KEY),
      ),
      // The same registered reporter the worker uses (ADR-0010). Two
      // instances would be two places a second Ärztekammer had to be wired in.
      pluginRegistry().require("accreditationReporter"),
      new AuditService(this.pool),
      {
        baseUrl: this.config.EIV_BASE_URL,
        // The worker's own flag, so the screen reports the installation the
        // operator actually has rather than the one the code could support.
        submissionsEnabled: this.config.EIV_WORKER_ENABLED,
      },
    );
  }
}

function context(principal: Principal): EivOperatorContext {
  return { customerId: principal.customerId, staffUserId: principal.userId };
}
