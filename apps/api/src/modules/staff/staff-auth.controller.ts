/**
 * The staff sign-in endpoints (P12-03). Interface layer — ADR-0006.
 *
 * Holds every decision about *how the credential travels*, which is the part
 * the service must not know: cookie attributes, CSRF, and what a failure is
 * allowed to say.
 *
 * ## The cookie
 *
 * `httpOnly` so no script in the console's origin can read the session, which
 * is the whole reason this is a cookie rather than a token in memory.
 * `Secure` outside development. `SameSite=Lax` plus a `Domain` of the parent
 * name, so `verwaltung.…` and `api.…` are same-site and the browser attaches
 * it — `Strict` would drop it on the redirect back from an external link, and
 * `None` would attach it to genuinely cross-site requests, which is what CSRF
 * needs.
 *
 * ## Why there is a CSRF token as well
 *
 * `SameSite=Lax` is a strong mitigation and not a complete one: it still sends
 * the cookie on top-level `GET` navigations, and it is a browser behaviour
 * rather than a server check. The double-submit token is the server's own
 * check — the console reads it from the login response, echoes it in a header,
 * and the API compares it against the hash stored beside the session. An
 * attacker on another origin can cause a request but cannot read that value.
 *
 * ## What a failure may say
 *
 * "Invalid credentials" for an unknown address, a wrong password, a disabled
 * account and an account with no grants — all four. The audit log records
 * which; the response does not, because the difference is an account
 * enumeration oracle.
 *
 * A lockout is the one exception and is told plainly, with the time it lifts.
 * Concealing it would leave somebody retrying a correct password against a
 * locked account with no idea why it fails.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Post,
  Put,
  Req,
  Res,
} from "@nestjs/common";
import type { CookieOptions, Request, Response } from "express";
import { z } from "zod";
import { checkPassword } from "@ds/domain";
import { Public } from "../../auth/public.decorator.js";
import { StaffOnly } from "../../auth/staff-only.decorator.js";
import { AppError } from "../../shared/problem-details.js";
import { StaffService } from "./staff.service.js";

export const SESSION_COOKIE = "ds_staff_session";
export const CSRF_HEADER = "x-ds-csrf";

const LoginBody = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(512),
});

const TotpEnrolBody = z.object({
  challenge: z.string().min(1).max(512),
});

const TotpVerifyBody = z.object({
  challenge: z.string().min(1).max(512),
  // Exactly six digits. A looser schema would send whitespace and dashes — both
  // of which authenticator apps display — into the comparison, where they
  // would fail with no indication why.
  code: z.string().regex(/^\d{6}$/, "six digits"),
});

const RedeemBody = z.object({
  token: z.string().min(1).max(512),
  password: z.string().min(1).max(512),
});

const SecondFactorPolicyBody = z.object({
  /**
   * `null` names the platform itself — the scope a super administrator belongs
   * to. It is spelled as an explicit null rather than an absent field so that
   * "set the platform policy" cannot be what a malformed request accidentally
   * means (P22-02).
   */
  customerId: z.string().uuid().nullable(),
  policy: z.enum(["disabled", "optional", "required"]),
});

export interface StaffAuthConfig {
  /** `.cme.example.de` — omitted in development, where hosts are bare. */
  readonly cookieDomain: string;
  readonly secureCookies: boolean;
}

/**
 * Nest constructs controllers itself, so its configuration cannot be supplied
 * by a provider factory over the controller class — that provider is simply
 * ignored, and the controller is built with an unresolvable first argument.
 * A token is the way in.
 */
export const STAFF_AUTH_CONFIG = Symbol("STAFF_AUTH_CONFIG");

@Controller("admin/auth")
export class StaffAuthController {
  constructor(
    // `@Inject` even though the type alone would do under `tsc`.
    // `emitDecoratorMetadata` is a TypeScript-compiler feature that esbuild does
    // not implement, and `pnpm dev` runs this app through `tsx`, which is
    // esbuild — so type-based injection resolves to `undefined` there and the
    // process will not start. Every other controller in this codebase names its
    // token explicitly for the same reason; this one was the exception.
    @Inject(StaffService) private readonly service: StaffService,
    @Inject(STAFF_AUTH_CONFIG) private readonly config: StaffAuthConfig,
  ) {}

  @Public()
  @Post("login")
  async login(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const input = LoginBody.parse(body);

    const outcome = await this.service.login({
      email: input.email,
      password: input.password,
      userAgent: headerOrNull(request, "user-agent"),
      ip: request.ip ?? null,
    });

    switch (outcome.kind) {
      case "signed_in":
        response.cookie(SESSION_COOKIE, outcome.sessionToken, this.cookieOptions());
        // The CSRF token is returned in the body, not a cookie: the console
        // must be able to read it, and a readable cookie is one more thing to
        // get the attributes wrong on.
        return {
          status: "signed_in",
          csrfToken: outcome.csrfToken,
          profile: outcome.profile,
        };

      case "totp_required":
      case "totp_enrolment_required":
        return { status: outcome.kind, challenge: outcome.challenge };

      case "locked":
        throw AppError.unauthenticated(
          `account locked until ${outcome.until.toISOString()}`,
        );

      case "invalid_credentials":
      default:
        throw AppError.unauthenticated("invalid credentials");
    }
  }

  @StaffOnly()
  @Post("logout")
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ status: string }> {
    const sessionId = request.staffSessionId;
    if (sessionId !== undefined) await this.service.logout(sessionId);

    // Cleared with the same attributes it was set with, or the browser keeps
    // it: a `Domain` mismatch leaves the original cookie in place and the
    // learner appears signed in until it expires.
    response.clearCookie(SESSION_COOKIE, this.cookieOptions());
    return { status: "signed_out" };
  }

  /**
   * Who am I — the call the console makes on load to decide whether to show
   * the login form or the application.
   */
  @StaffOnly()
  @Get("session")
  session(@Req() request: Request): unknown {
    const profile = request.staffProfile;
    if (profile === undefined) throw AppError.unauthenticated("no staff session");
    return { profile };
  }

  /**
   * Show the operator a secret to scan (P12-03).
   *
   * Public because the caller has no session yet — the challenge from `login`
   * is the credential, and it authorises nothing except this and
   * `/totp/verify`. The secret is returned exactly once; there is no endpoint
   * that can produce it again, so an operator who loses it re-enrols.
   */
  @Public()
  @Post("totp/enrol")
  async enrolTotp(@Body() body: unknown): Promise<{ otpauthUri: string }> {
    const input = TotpEnrolBody.parse(body);
    const outcome = await this.service.beginTotpEnrolment(input.challenge);

    // One answer for an expired challenge, an unknown one and an account that
    // is already enrolled. Distinguishing them would tell somebody holding a
    // stale challenge which of those it was.
    if (outcome.kind === "rejected") {
      throw AppError.unauthenticated("this sign-in attempt is no longer valid");
    }
    return { otpauthUri: outcome.otpauthUri };
  }

  /**
   * Finish a sign-in by presenting a code (P12-03).
   *
   * Serves both the first code after enrolment and every code after that. On
   * success this is where the real session cookie is issued — the challenge
   * never was one (migration 0022).
   */
  @Public()
  @Post("totp/verify")
  async verifyTotp(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const input = TotpVerifyBody.parse(body);

    const outcome = await this.service.verifyTotp({
      challengeToken: input.challenge,
      code: input.code,
      userAgent: headerOrNull(request, "user-agent"),
      ip: request.ip ?? null,
    });

    if (outcome.kind !== "signed_in") {
      // A wrong code, a spent challenge and a disabled account are one answer.
      // The audit log records which.
      throw AppError.unauthenticated("invalid credentials");
    }

    response.cookie(SESSION_COOKIE, outcome.sessionToken, this.cookieOptions());
    return {
      status: "signed_in",
      csrfToken: outcome.csrfToken,
      profile: outcome.profile,
    };
  }

  /**
   * Accept an invitation or complete a password reset.
   *
   * Public because the caller has no session yet — the token *is* the
   * credential. Every existing session for the account is revoked on success:
   * a reset is what somebody does when they think they are compromised.
   */
  @Public()
  @Post("credentials")
  async redeem(@Body() body: unknown): Promise<{ status: string }> {
    const input = RedeemBody.parse(body);

    // Policy is checked before the token is spent, so a rejected password does
    // not consume a single-use link and strand the invitee.
    const verdict = checkPassword(input.password, { identifiers: [] });
    if (!verdict.ok) {
      throw AppError.badRequest(`password rejected: ${verdict.reason}`);
    }

    const passwordHash = await this.service.hashPassword(input.password);
    const ok = await this.service.redeemCredentialToken({
      token: input.token,
      passwordHash,
    });

    // The same answer for an expired token, a spent one and one that never
    // existed. A distinguishable "already used" would confirm to somebody
    // holding a forwarded invitation that it was real.
    if (!ok) throw AppError.badRequest("this link is no longer valid");
    return { status: "password_set" };
  }

  // --- the second factor, as a policy (P22-02) -----------------------------

  /**
   * The policies in force, for the console's security screen.
   *
   * `@StaffOnly()` without a capability: every operator may see the rules they
   * are subject to. Which of them they may *change* is `setSecondFactorPolicy`'s
   * business, and it is checked there rather than by hiding the screen — a
   * hidden control is a convenience, and the refusal is the security boundary.
   */
  @StaffOnly()
  @Get("second-factor/policy")
  async secondFactorPolicy(@Req() request: Request): Promise<unknown> {
    const profile = request.staffProfile;
    if (profile === undefined) throw AppError.unauthenticated("no staff session");

    const { platform, perCustomer } = await this.service.readSecondFactorPolicies();
    return {
      platform,
      customers: [...perCustomer].map(([customerId, policy]) => ({
        customerId,
        policy,
      })),
    };
  }

  /**
   * Turn the second factor off, make it optional, or make it mandatory.
   *
   * The scope check is the service's, not a decorator's, because it depends on
   * *which* scope the body names: only a super administrator may set the
   * platform's, and a customer administrator may set their own customer's and
   * no other. A capability decorator cannot see the body.
   */
  @StaffOnly()
  @Put("second-factor/policy")
  async setSecondFactorPolicy(
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<{ status: string }> {
    const profile = request.staffProfile;
    if (profile === undefined) throw AppError.unauthenticated("no staff session");

    const input = SecondFactorPolicyBody.parse(body);
    const outcome = await this.service.setSecondFactorPolicy({
      actor: profile,
      customerId: input.customerId,
      policy: input.policy,
    });

    if (!outcome.ok) throw AppError.forbidden(outcome.reason ?? "refused");
    return { status: "saved" };
  }

  /**
   * Take your own second factor off.
   *
   * Refused when the policy governing your account is `required`, which is what
   * makes "mandatory" mean something. An administrator clearing *somebody
   * else's* is a different operation with different rules — see
   * `POST /admin/staff/:id/second-factor/reset`.
   */
  @StaffOnly()
  @Delete("second-factor")
  async removeOwnSecondFactor(@Req() request: Request): Promise<{ status: string }> {
    const profile = request.staffProfile;
    if (profile === undefined) throw AppError.unauthenticated("no staff session");

    const outcome = await this.service.removeOwnSecondFactor({
      accountId: profile.id,
      grants: profile.grants,
    });

    if (!outcome.ok) throw AppError.forbidden(outcome.reason ?? "refused");
    return { status: "removed" };
  }

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.secureCookies,
      sameSite: "lax",
      path: "/",
      ...(this.config.cookieDomain === "" ? {} : { domain: this.config.cookieDomain }),
    };
  }
}

function headerOrNull(request: Request, name: string): string | null {
  const value = request.headers[name];
  return typeof value === "string" ? value : null;
}
