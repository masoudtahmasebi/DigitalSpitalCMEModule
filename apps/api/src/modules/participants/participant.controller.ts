/**
 * Participant administration (P21-04). Interface layer — ADR-0006.
 *
 * ## Why this is a module and not four more routes on `ModerationController`
 *
 * P21-04 originally said "reuses P12-05's moderation screens". It does not,
 * and the reason is that the two answer different questions. Moderation is
 * about **enrolments** — a row per person per course, with a watch percentage
 * and an EIV stage — and it can only ever show somebody who has already started
 * something. This is about **people**: creating one, resetting a password,
 * stopping an account. A participant an administrator created five seconds ago
 * has no enrolment and appears on no moderation screen at all, which makes
 * moderation exactly the wrong place to create them from.
 *
 * ## What creating a participant costs, and why it is still not self-service
 *
 * `CLAUDE.md` §3 defers self-service signup, and this does not undo that: an
 * account is created by a member of staff who is already authenticated and
 * already scoped to one customer. Anyone who can create an account on a CME
 * platform can create a CME record, and that stays a deliberate act by a named
 * operator.
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import { Roles } from "../../auth/roles.decorator.js";
import { CurrentPrincipal } from "../../auth/current-principal.decorator.js";
import type { Principal } from "../../auth/principal.js";
import { TenantDb } from "../../db/tenant-db.decorator.js";
import type { Db } from "../../db/tenant-db.js";
import { PG_POOL } from "../../db/tokens.js";
import { RateLimit } from "../../shared/rate-limit.guard.js";
import { AppError } from "../../shared/problem-details.js";
import { ParticipantRepository } from "./participant.repository.js";
import { ParticipantService } from "./participant.service.js";

/**
 * Who may administer participants.
 *
 * `department_admin` is included, and that is a decision rather than an
 * oversight: `staff-identity.ts` gives the role `learner_record`, and running a
 * department without being able to enrol the people in it is not running a
 * department. What they cannot do is reach another department's customer, which
 * `resolveTenantContext` decides before this controller is entered.
 */
const PARTICIPANT_ROLES = ["department_admin", "customer_admin", "super_admin"] as const;

const createSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  // Both required. A Teilnahmebescheinigung prints a name, and
  // `missingCertificateFields` refuses to issue one without it — so a
  // participant created without a name is a participant who reaches the end of
  // a course and cannot be given the point they earned.
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
});

const disableSchema = z.object({ disabled: z.boolean() });

/**
 * Who may merge two credentials onto one person.
 *
 * `super_admin` alone — see the route's own comment. Deliberately *not*
 * `PARTICIPANT_ROLES`: a merge routinely spans two customers, and a
 * customer-scoped administrator is correctly unable to see the other side.
 */
const MERGE_ROLES = ["super_admin"] as const;

const mergeSchema = z.object({
  sourceUserId: z.uuid(),
  targetUserId: z.uuid(),
});

@Controller("admin/participants")
export class ParticipantController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Get()
  @Roles(...PARTICIPANT_ROLES)
  list(@Query("q") search: string | undefined, @TenantDb() db: Db) {
    return this.service(db).list(search === "" ? undefined : search);
  }

  /**
   * Create a participant, and return the one and only copy of their password.
   *
   * `customerId` comes from the principal, never from the body. Accepting it
   * would let a customer admin create a participant inside another tenant with
   * one edited request — the tenant is resolved by the guard for exactly this
   * reason.
   */
  @Post()
  @Roles(...PARTICIPANT_ROLES)
  @RateLimit("participantCreate")
  async create(
    @Body() body: unknown,
    @CurrentPrincipal() principal: Principal,
    @TenantDb() db: Db,
  ) {
    const input = parse(createSchema, body);
    return this.service(db).create({ ...input, customerId: principal.customerId });
  }

  /** A fresh temporary password, shown once, with every session ended. */
  @Post(":userId/reset-password")
  @Roles(...PARTICIPANT_ROLES)
  @RateLimit("participantCreate")
  async resetPassword(@Param("userId") userId: string, @TenantDb() db: Db) {
    return this.service(db).resetPassword(userId);
  }

  @Post(":userId/disabled")
  @Roles(...PARTICIPANT_ROLES)
  @HttpCode(204)
  async setDisabled(
    @Param("userId") userId: string,
    @Body() body: unknown,
    @Req() request: Request,
    @TenantDb() db: Db,
  ): Promise<void> {
    const input = parse(disableSchema, body);
    await this.service(db).setDisabled(
      userId,
      input.disabled,
      // `request.staffProfile`, set by `AuthGuard` from a validated staff
      // session — not anything the caller sent. It is null when a super admin
      // acts through a learner token, which is why `disabled_by` is nullable:
      // the column is a breadcrumb, not an authorisation, and refusing the
      // operation for want of one would be the wrong trade.
      request.staffProfile?.id ?? null,
    );
  }

  /**
   * What a merge would do (P21-05). Reads only.
   *
   * Always called before `merge`, and the reason it is a separate route rather
   * than a flag: the operation is irreversible, and an operator has to be shown
   * both sides — which credentials, which courses, whether an EFN is in play —
   * before confirming. A single endpoint that merged and then reported would
   * make "what would this do?" a question with no answer.
   */
  @Post("merge/preview")
  @Roles(...MERGE_ROLES)
  async previewMerge(@Body() body: unknown, @TenantDb() db: Db) {
    const input = parse(mergeSchema, body);
    return this.service(db).previewMerge(input.sourceUserId, input.targetUserId);
  }

  /**
   * Merge two credentials onto one person. **Irreversible.**
   *
   * ## Why `super_admin` and not the participant roles
   *
   * The whole purpose is a physician who exists in two places, and those two
   * places are frequently two customers — a MEDICE learner given a DS portal
   * login is the case P21-05 was written for. A customer-scoped administrator
   * cannot be shown the other side, because RLS correctly hides it from them,
   * so they would be confirming a merge against a record they cannot see.
   *
   * Being above every tenant is the only position from which both sides are
   * visible, so it is the only position from which this is a considered act
   * rather than a leap.
   *
   * `confirm` is required and must name the target. A DELETE-shaped mistake on
   * an irreversible operation should take two decisions, and typing the id back
   * is the cheapest second one that cannot be made by a mis-click.
   */
  @Post("merge")
  @Roles(...MERGE_ROLES)
  @HttpCode(204)
  @RateLimit("participantCreate")
  async merge(
    @Body() body: unknown,
    @Req() request: Request,
    @TenantDb() db: Db,
  ): Promise<void> {
    const input = parse(mergeSchema.extend({ confirm: z.string() }), body);
    if (input.confirm !== input.targetUserId) {
      throw AppError.badRequest("merge confirmation does not name the target");
    }

    await this.service(db).merge({
      sourceId: input.sourceUserId,
      targetId: input.targetUserId,
      // From the validated staff session, never from the body. Null when a
      // super admin acts through a learner token — the audit row records what
      // is known rather than refusing for want of a name.
      actorId: request.staffProfile?.id ?? null,
      actorEmail: request.staffProfile?.email ?? null,
    });
  }

  private service(db: Db): ParticipantService {
    return new ParticipantService(new ParticipantRepository(db, this.pool));
  }
}

/**
 * Parse, and turn a failure into a problem document rather than a 500.
 *
 * Zod's own message names the field, which is right for a form and is safe
 * here: these are an administrator's own inputs, not a credential.
 */
function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw AppError.badRequest(
      `invalid participant payload: ${result.error.issues.map((i) => i.path.join(".")).join(", ")}`,
    );
  }
  return result.data;
}
