/**
 * Sign-in for participants whose credential is local (P25-02). Interface — ADR-0006.
 *
 * ## Why this is public, and what that costs
 *
 * `@Public()` — a sign-in endpoint cannot require a session. That makes it the
 * one learner-plane route an unauthenticated caller can reach, so it carries
 * every mitigation the staff sign-in does: a rate limit, a persisted lockout,
 * one message for every failure, and a constant-ish cost whether or not the
 * account exists.
 *
 * ## Which project
 *
 * The `X-DS-Project` header, as everywhere. A session is minted **for that
 * project**, and `LocalIdentityProvider` refuses it against any other — so a
 * participant of two customers signs in twice and neither session can read the
 * other's courses.
 *
 * A project whose `identity_provider` is `keycloak` is refused here outright:
 * its participants sign in at the customer's realm, and offering them a
 * password box that can never work is worse than not offering one.
 *
 * ## Why a cookie and not a bearer token in the body
 *
 * The portal is a browser. An `httpOnly` cookie cannot be read by script, so a
 * cross-site scripting bug on the portal cannot exfiltrate the session — which
 * a token in `localStorage` very much can. `SameSite=Lax` covers CSRF for the
 * shape of request this API takes; the widget embedded in WordPress is
 * cross-origin and keeps using a bearer token from the customer's Keycloak,
 * which is a different plane and unaffected.
 */

import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from "@nestjs/common";
import type { CookieOptions, Request, Response } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import { Public } from "../../auth/public.decorator.js";
import { Roles } from "../../auth/roles.decorator.js";
import { PARTICIPANT_COOKIE } from "../../auth/participant-cookie.js";
import { readCookie } from "../../auth/staff-session.js";
import { CurrentPrincipal } from "../../auth/current-principal.decorator.js";
import type { Principal } from "../../auth/principal.js";
import { RateLimit } from "../../shared/rate-limit.guard.js";
import { AppError } from "../../shared/problem-details.js";
import { APP_CONFIG, PG_POOL } from "../../db/tokens.js";
import type { AppConfig } from "../../config/config.js";
import { LearnerSessionRepository } from "../../auth/learner-session.repository.js";
import { ParticipantAuthService } from "./participant-auth.service.js";
import { ParticipantAuthRepository } from "./participant-auth.repository.js";

const signInSchema = z.object({
  email: z.string().trim().toLowerCase().min(3).max(320),
  password: z.string().min(1).max(1024),
});

@Controller("auth/participant")
export class ParticipantAuthController {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Post("sign-in")
  @HttpCode(200)
  // Tighter than any other route. This is the only unauthenticated write on the
  // learner plane, and an online guessing attack is what it is for.
  @RateLimit("participantSignIn")
  async signIn(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const parsed = signInSchema.safeParse(body);
    if (!parsed.success) {
      // Deliberately the same refusal as a wrong password. A distinct
      // "malformed" answer tells somebody probing that the address they tried
      // was at least well-formed.
      throw this.refuse();
    }

    const result = await this.service().signIn({
      projectSlug: request.header("x-ds-project") ?? "",
      email: parsed.data.email,
      password: parsed.data.password,
      ip: request.ip ?? "",
      userAgent: request.header("user-agent") ?? null,
      now: new Date(),
    });

    if (!result.ok) throw this.refuse();

    response.cookie(
      PARTICIPANT_COOKIE,
      result.token,
      this.cookieOptions(result.expiresAt),
    );
    return { mustChangePassword: result.mustChangePassword };
  }

  @Public()
  @Post("sign-out")
  @HttpCode(204)
  async signOut(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    // `readCookie`, not `request.cookies` — this API deliberately does not run
    // `cookie-parser` (see `staff-session.ts`), so `request.cookies` is always
    // undefined and a sign-out through it would silently revoke nothing while
    // returning 204.
    const token = readCookie(request.headers.cookie, PARTICIPANT_COOKIE);
    if (token !== undefined && token !== "") {
      await this.service().signOut(token);
    }
    // Cleared whether or not a session was found: a client asking to sign out
    // should end up signed out, not told that it was already.
    response.clearCookie(PARTICIPANT_COOKIE, this.cookieOptions(new Date(0)));
  }

  /**
   * Who the caller is. The portal's "am I still signed in?" on load.
   *
   * The session cookie is `httpOnly`, so the portal genuinely cannot answer
   * this for itself — a round trip is the only way, and this is the cheapest
   * one that means anything.
   *
   * `@Roles` is not optional decoration: `RolesGuard` fails closed, refusing
   * any authenticated route that declares none. Omitting it here produced a
   * **403 after a successful sign-in** — the cookie was minted, sent and
   * verified, and the portal still showed the login form, because the one
   * route it asks about was the one route nobody could reach. The guard was
   * right and the log said so verbatim; no unit test would have, since none
   * boots the guard chain.
   *
   * Every authenticated role, not just `learner`: a customer admin looking at
   * their own tenant's portal is signed in too, and telling them they are not
   * would be a lie the rest of the page then contradicts.
   */
  @Get("me")
  @Roles("learner", "department_admin", "customer_admin", "super_admin")
  me(@CurrentPrincipal() principal: Principal) {
    return {
      userId: principal.userId,
      customerId: principal.customerId,
      role: principal.role,
    };
  }

  private service(): ParticipantAuthService {
    return new ParticipantAuthService(
      new ParticipantAuthRepository(this.pool),
      new LearnerSessionRepository(this.pool),
      // The salt for `ip_hash`, and the same one the staff plane uses
      // (`staff.module.ts`). It must be a secret and it must be stable: a
      // random-per-boot salt would make every restart produce a different hash
      // for the same address, and the column exists precisely to answer "was
      // this the same client?" across restarts.
      this.config.SECRETS_KMS_KEY,
    );
  }

  private cookieOptions(expires: Date): CookieOptions {
    return {
      httpOnly: true,
      // Never over plain HTTP in production. In development the portal is
      // http://localhost and a `secure` cookie would simply never be stored,
      // which presents as "sign-in does nothing".
      secure: this.config.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      expires,
      ...(this.config.STAFF_COOKIE_DOMAIN === ""
        ? {}
        : { domain: this.config.STAFF_COOKIE_DOMAIN }),
    };
  }

  /**
   * One refusal, for everything.
   *
   * Wrong address, wrong password, locked account, a project that uses
   * Keycloak, a malformed body — all the same 401 and the same German message.
   * Any distinction is an oracle: "this address exists" is the first thing a
   * credential-stuffing run wants to learn, and it is a list of physicians.
   */
  private refuse(): AppError {
    return new AppError(
      "unauthenticated",
      "participant sign-in refused",
      "E-Mail-Adresse oder Passwort ist nicht korrekt.",
    );
  }
}
