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
  HttpCode,
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
import { RateLimit } from "../../shared/rate-limit.guard.js";
import { AppError } from "../../shared/problem-details.js";
import { StaffService } from "./staff.service.js";

export const SESSION_COOKIE = "ds_staff_session";

/**
 * The CSRF token, in a cookie the console's JavaScript **can** read (P22-04).
 *
 * ## Why this exists
 *
 * The console held its CSRF token in a module variable, set by `login` and
 * `verify` and by nothing else. The session cookie is httpOnly and survives a
 * page reload; the variable does not. So after any reload — or a second tab, or
 * a restored browser session — the console could read everything and write
 * nothing: every unsafe method came back
 *
 *     403 Forbidden   missing or invalid CSRF token
 *
 * with no `detail`, which reads as "you are not allowed to do this" and was in
 * fact "this tab has forgotten a token it never had a way to recover".
 * Reported from the live console trying to create the first customer.
 *
 * ## Why a readable cookie is the right shape and not a weakening
 *
 * This is the textbook double-submit pattern. The protection does not come from
 * the token being secret from *the page* — the page has to send it — it comes
 * from a cross-origin attacker being unable to **read** it. A foreign origin
 * cannot read this cookie and cannot read a response carrying it, so it cannot
 * populate the header, and the request is refused.
 *
 * What must stay true, and does:
 *
 *   * `httpOnly: false` here and `httpOnly: true` on the session cookie. The
 *     session token remains unreadable from JavaScript, which is the property
 *     that actually matters — a stolen CSRF token alone authenticates nothing.
 *   * `sameSite: "lax"` and `secure` exactly as the session cookie, so the two
 *     travel together and neither is sent from a cross-site POST.
 *   * The server still compares the header against `csrf_token_hash`. Nothing
 *     about verification changes; only where the client keeps its copy.
 */
export const CSRF_COOKIE = "ds_staff_csrf";
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

/**
 * "I forgot my password" (P40-02).
 *
 * `consoleUrl` is **not** taken from the body. An attacker who could name the
 * link's origin could have a real reset token delivered to a real inbox
 * pointing at a page they control — the classic host-header/redirect variant of
 * a reset flow, and the one that turns a correct token into a stolen one. The
 * origin comes from the request, checked against the same allow-list CORS uses.
 */
const PasswordResetBody = z.object({
  email: z.string().trim().min(3).max(320),
});

/**
 * The platform's own sender (P40-01).
 *
 * `password` is three-valued on purpose, exactly as the project SMTP form is:
 * absent keeps what is stored, `null` clears it, a string replaces it. An
 * operator editing the sender name must not silently wipe the credential.
 */
const PlatformSmtpBody = z.object({
  host: z.string().trim().max(300).nullable(),
  port: z.number().int().min(1).max(65_535).nullable(),
  username: z.string().trim().max(300).nullable(),
  password: z.string().max(300).nullable().optional(),
  secure: z.boolean(),
  fromAddress: z.string().trim().max(320).nullable(),
  fromName: z.string().trim().max(200).nullable(),
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
  /**
   * Where a password-reset link may point (P40-02).
   *
   * The same list CORS uses, and for the same reason: an origin nobody
   * configured must not be able to have a real token delivered to a real inbox
   * pointing at it.
   */
  readonly allowedOrigins: readonly string[];
  /** Used when the request carries no recognised origin of its own. */
  readonly consoleUrl: string;
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
        response.cookie(CSRF_COOKIE, outcome.csrfToken, this.csrfCookieOptions());
        // The CSRF token is returned in the body *and* set as a readable
        // cookie. The body is what the tab that just signed in uses; the cookie
        // is what a *reloaded* tab reads, and without it the console could read
        // everything and write nothing (P22-04).
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
    response.clearCookie(CSRF_COOKIE, this.csrfCookieOptions());
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
    // Both exits set both cookies. This one is the second factor's, and it is
    // the exit a `super_admin` always takes — so missing it here would have left
    // exactly the accounts that must use a second factor unable to write after
    // a reload (P22-04).
    response.cookie(CSRF_COOKIE, outcome.csrfToken, this.csrfCookieOptions());
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

  // --- Passwort vergessen (P40-02) -----------------------------------------

  /**
   * Ask for a reset link.
   *
   * ## Why the answer is always the same
   *
   * 202 for an unknown address, a disabled account, a platform with no sender
   * configured, and a link that went out. The console's operator accounts are
   * named after real people at a named company, so an endpoint that answered
   * differently for a known address would be a way to find out who works there.
   *
   * The service does the same thing on its side — it mints no token when there
   * is nowhere to send one — so there is no observable difference in work done
   * either.
   *
   * ## Where the link points
   *
   * At the request's own origin, not at anything in the body, and only if that
   * origin is one the deployment already allows. A reset flow that lets the
   * caller name the link's host delivers a real token to a real inbox pointing
   * at a page the attacker controls.
   */
  @Public()
  @RateLimit("staffPasswordReset")
  // 202, not Nest's default 201: nothing was created that the caller may know
  // about, and "accepted" is the only honest word for a request whose outcome
  // is deliberately not reported back.
  @HttpCode(202)
  @Post("password-reset")
  async requestPasswordReset(
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<{ status: string }> {
    const input = PasswordResetBody.parse(body);
    const origin = this.trustedOrigin(request);

    await this.service.beginPasswordReset(
      input.email,
      (token) => `${origin}/#passwort-neu?token=${encodeURIComponent(token)}`,
    );

    return { status: "accepted" };
  }

  /**
   * The origin a reset link may point at.
   *
   * The request's `Origin` header when the deployment allows it, and the
   * configured console URL otherwise — never a value from the body. An
   * unrecognised origin falls back rather than being refused, because the
   * refusal would only tell an attacker which origins are configured.
   */
  private trustedOrigin(request: Request): string {
    const origin = request.get("origin");
    if (origin !== undefined && this.config.allowedOrigins.includes(origin)) {
      return origin;
    }
    return this.config.consoleUrl;
  }

  // --- the platform's own sender (P40-01) ----------------------------------

  /**
   * Read it. Never the password — `hasPassword` is what an operator needs.
   *
   * `@StaffOnly()` without a capability, like the policy read below it: seeing
   * that mail is configured is not a privilege, and the write is where the
   * boundary is.
   */
  @StaffOnly()
  @Get("platform-smtp")
  async platformSmtp(@Req() request: Request): Promise<unknown> {
    if (request.staffProfile === undefined) {
      throw AppError.unauthenticated("no staff session");
    }
    return this.service.readPlatformSender();
  }

  /**
   * Change it. Super administrators only.
   *
   * Not a `@StaffCapability` — this is not one customer's setting, it is the
   * address the platform's own mail comes from, and a customer administrator
   * redirecting it would be redirecting mail about accounts that are not
   * theirs.
   */
  @StaffOnly()
  @Put("platform-smtp")
  async setPlatformSmtp(
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<{ status: string }> {
    const profile = request.staffProfile;
    if (profile === undefined) throw AppError.unauthenticated("no staff session");
    if (profile.role !== "super_admin") {
      throw AppError.forbidden(
        "only a super administrator may change the platform sender",
      );
    }

    const input = PlatformSmtpBody.parse(body);
    // Spread the optional key rather than passing it through: under
    // `exactOptionalPropertyTypes` an explicit `password: undefined` is a
    // different thing from an absent one, and the difference here is "keep the
    // stored credential" versus a type error.
    await this.service.writePlatformSender(
      {
        host: input.host,
        port: input.port,
        username: input.username,
        secure: input.secure,
        fromAddress: input.fromAddress,
        fromName: input.fromName,
        ...(input.password === undefined ? {} : { password: input.password }),
      },
      { id: profile.id },
    );
    return { status: "saved" };
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
      // Which of those rows is this caller's, answered here because only here
      // are their grants known (P74-01).
      own: await this.service.ownSecondFactorScopes(profile),
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

  /**
   * The CSRF cookie's options: the session cookie's, minus `httpOnly`.
   *
   * Derived from `cookieOptions()` rather than written out, so a change to the
   * domain or the `secure` flag cannot apply to one cookie and not the other —
   * two cookies that disagree about their scope is how one of them silently
   * stops arriving.
   */
  private csrfCookieOptions(): CookieOptions {
    return { ...this.cookieOptions(), httpOnly: false };
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
