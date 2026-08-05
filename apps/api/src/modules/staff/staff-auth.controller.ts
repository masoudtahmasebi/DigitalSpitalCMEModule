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

import { Body, Controller, Get, Post, Req, Res } from "@nestjs/common";
import type { CookieOptions, Request, Response } from "express";
import { z } from "zod";
import { checkPassword } from "@ds/domain";
import { Public } from "../../auth/public.decorator.js";
import { AppError } from "../../shared/problem-details.js";
import type { StaffService } from "./staff.service.js";

export const SESSION_COOKIE = "ds_staff_session";
export const CSRF_HEADER = "x-ds-csrf";

const LoginBody = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(512),
});

const RedeemBody = z.object({
  token: z.string().min(1).max(512),
  password: z.string().min(1).max(512),
});

export interface StaffAuthConfig {
  /** `.cme.example.de` — omitted in development, where hosts are bare. */
  readonly cookieDomain: string;
  readonly secureCookies: boolean;
}

@Controller("admin/auth")
export class StaffAuthController {
  constructor(
    private readonly service: StaffService,
    private readonly config: StaffAuthConfig,
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
  @Get("session")
  session(@Req() request: Request): unknown {
    const profile = request.staffProfile;
    if (profile === undefined) throw AppError.unauthenticated("no staff session");
    return { profile };
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
