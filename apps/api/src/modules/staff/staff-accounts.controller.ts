/**
 * Operator account management (P12-05). Interface layer — ADR-0006.
 *
 * Above any tenant, like the customer registry: an operator account belongs to
 * DigitalSpital, not to a customer, and a super administrator belongs to no
 * customer at all. So these carry no `X-DS-Project` and are authorised by the
 * `staff_user` capability rather than a tenant role.
 *
 * ## The capability is necessary and not sufficient
 *
 * `@StaffCapability("staff_user")` gets a `customer_admin` or a `super_admin`
 * through the door. What they may then *do* is decided per request by
 * `canGrant` in `@ds/domain` — capability, then rank, then self-escalation,
 * then scope — because "may manage staff" and "may manage *this* staff member"
 * are different questions and only the second one keeps a customer
 * administrator away from a super administrator's account.
 *
 * ## Why an invitation token comes back in the response
 *
 * Because it is not emailed yet, and saying so is better than a mail path that
 * silently drops invitations. The operator passes the link on themselves. The
 * token is single-use, revokes any earlier outstanding one, and until it is
 * redeemed the account has no password at all — so an un-redeemed invitation
 * is not a credential.
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import type { StaffRole, StaffScope } from "@ds/domain";
import { StaffCapability } from "../../auth/staff-only.decorator.js";
import { APP_CONFIG } from "../../db/tokens.js";
import type { AppConfig } from "../../config/config.js";
import { AppError } from "../../shared/problem-details.js";
import { RateLimit } from "../../shared/rate-limit.guard.js";
import { StaffService } from "./staff.service.js";

const ROLE = z.enum([
  "course_editor",
  "department_admin",
  "customer_admin",
  "super_admin",
]);

const Scope = z.object({
  role: ROLE,
  /** `null` only for `super_admin`; the database CHECK enforces the pairing. */
  customerId: z.string().uuid().nullable(),
  departmentId: z.string().uuid().nullable(),
});

const Invitation = Scope.extend({
  email: z.string().email().max(320),
  displayName: z.string().trim().min(1).max(200),
});

const Disabled = z.object({ disabled: z.boolean() });

@Controller("admin/staff")
@StaffCapability("staff_user")
export class StaffAccountsController {
  constructor(
    @Inject(StaffService) private readonly service: StaffService,
    // For `ALLOWED_ORIGINS`, which is where an invitation link may point.
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get()
  list(@Req() request: Request) {
    return this.service.listAccounts(actorScope(request));
  }

  @Post()
  // Nobody invites operators in bulk, and a loop that did would fill the
  // console's account list with rows somebody then has to disable one by one.
  @RateLimit("customerCreate")
  async invite(@Body() body: unknown, @Req() request: Request) {
    const input = Invitation.parse(body);
    const actor = actorScope(request);

    const outcome = await this.service.inviteAccount(
      {
        email: input.email,
        displayName: input.displayName,
        role: input.role,
        customerId: input.customerId,
        departmentId: input.departmentId,
      },
      actor,
      // The link the invitation mail carries, built from an origin this API
      // already trusts — never from the request body (P40-05). Same rule as the
      // reset flow, and for the same reason: a caller who could name the host
      // would have a real token delivered to a real inbox pointing at a page
      // they control.
      (token) =>
        `${trustedOrigin(request, this.config)}/#passwort-neu?token=${encodeURIComponent(token)}`,
    );

    if (outcome.kind === "refused") throw refusal(outcome.reason);
    // `delivered` so the console can stop telling somebody to hand over a link
    // that is already in the invitee's inbox. The token comes back either way:
    // an invitation must not be lost because a mail server was down.
    return { status: "invited", token: outcome.token, delivered: outcome.delivered };
  }

  @Post(":id/scope")
  @HttpCode(204)
  async setScope(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<void> {
    const input = Scope.parse(body);
    const result = await this.service.setScope(id, input, actorScope(request));
    if (!result.ok) throw refusal(result.reason);
  }

  @Post(":id/disabled")
  @HttpCode(204)
  async setDisabled(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<void> {
    const input = Disabled.parse(body);
    const result = await this.service.setAccountDisabled(
      id,
      input.disabled,
      actorScope(request),
    );
    if (!result.ok) throw refusal(result.reason);
  }

  /**
   * Clear an operator's second factor so they can enrol a new device (P22-02).
   *
   * The lost-phone button, and until now there was none: an enrolled operator
   * whose authenticator was gone was locked out permanently, with no reset
   * anywhere in the product. For a super administrator — the one role that was
   * *forced* to enrol — a lost device could end the platform's only
   * unrestricted account.
   *
   * It does not sign them in and does not relax their policy: under a
   * `required` policy their next sign-in goes to enrolment. Every session they
   * hold is revoked at the same time, because an account whose second factor
   * just became recoverable should not carry a session minted under the old
   * one.
   */
  @Post(":id/second-factor/reset")
  @HttpCode(204)
  async resetSecondFactor(
    @Param("id") id: string,
    @Req() request: Request,
  ): Promise<void> {
    const profile = request.staffProfile;
    if (profile === undefined) {
      throw AppError.unauthenticated("no staff session on a staff-account route");
    }

    const result = await this.service.resetSecondFactorOf({
      actor: profile,
      targetId: id,
    });
    if (!result.ok) throw refusal(result.reason ?? "refused");
  }

  /** Revoke every session an account holds — the "somebody lost a laptop" button. */
  @Post(":id/sign-out-everywhere")
  @HttpCode(204)
  async signOutEverywhere(
    @Param("id") id: string,
    @Req() request: Request,
  ): Promise<void> {
    await this.service.signOutEverywhere(id, actorScope(request));
  }
}

/**
 * The acting operator's own scope, from the session `AuthGuard` resolved.
 *
 * Read from `staffProfile` and never from the body: accepting a claimed role
 * would make every check here decorative.
 */
function actorScope(request: Request): StaffScope & { id: string } {
  const profile = request.staffProfile;
  if (profile === undefined) {
    throw AppError.unauthenticated("no staff session on a staff-account route");
  }

  // The broadest grant is what the operator acts with, matching `broadestRole`.
  const broadest = profile.grants[0];
  return {
    id: profile.id,
    role: profile.role as StaffRole,
    customerId: broadest?.customerId ?? null,
    departmentId: broadest?.departmentId ?? null,
  };
}

/**
 * One status per refusal reason.
 *
 * `not_found` is a 404 and everything else a 403, and the wording never says
 * which rule fired — "you may not grant that role" and "you may not reach that
 * customer" together describe the shape of the grant table to somebody probing
 * it.
 */
function refusal(reason: string): AppError {
  if (reason === "not_found") return AppError.notFound("no such staff account");
  return new AppError(
    "forbidden",
    `staff account change refused: ${reason}`,
    "Sie sind nicht berechtigt, dieses Konto zu ändern.",
  );
}

/**
 * The origin a link in an outbound mail may point at.
 *
 * The request's own when the deployment allows it, the first configured origin
 * otherwise. Duplicated from `staff-auth.controller.ts` rather than shared,
 * because the two controllers are wired with different configuration objects
 * and threading one through to reach four lines would be more machinery than
 * the four lines.
 */
function trustedOrigin(request: Request, config: AppConfig): string {
  const origin = request.header("origin");
  if (origin !== undefined && config.ALLOWED_ORIGINS.includes(origin)) return origin;
  return config.ALLOWED_ORIGINS[0] ?? "";
}
