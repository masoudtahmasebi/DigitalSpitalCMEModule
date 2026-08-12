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
import { checkPassword, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@ds/domain";
import { Public } from "../../auth/public.decorator.js";
import { Roles } from "../../auth/roles.decorator.js";
import { PARTICIPANT_COOKIE } from "../../auth/participant-cookie.js";
import { readCookie } from "../../auth/staff-session.js";
import { CurrentPrincipal } from "../../auth/current-principal.decorator.js";
import type { Principal } from "../../auth/principal.js";
import { RateLimit } from "../../shared/rate-limit.guard.js";
import { createSecretCipher } from "../../shared/secret-cipher.js";
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

const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(MAX_PASSWORD_LENGTH),
  // Bounded here as well as by `checkPassword`, so a megabyte never reaches
  // Argon2 even if the policy call is ever moved or removed.
  newPassword: z.string().min(1).max(MAX_PASSWORD_LENGTH),
});

const resetRequestSchema = z.object({
  email: z.string().trim().min(3).max(320),
});

const resetConfirmSchema = z.object({
  token: z.string().min(1).max(512),
  newPassword: z.string().min(1).max(MAX_PASSWORD_LENGTH),
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

  /**
   * Ask for a reset link (P40-03).
   *
   * 202 for an unknown address, a federated project, a project with no SMTP
   * settings, and a link that went out. Asking whether a physician is enrolled
   * with a named pharmaceutical company is close enough to health-adjacent
   * information about a named person that the form must not answer it.
   *
   * The link points at the tenant's own path — `/<slug>#passwort-neu?token=…`
   * — built from the origin the request already came from, never from the body.
   */
  @Public()
  @Post("password-reset")
  @HttpCode(202)
  @RateLimit("staffPasswordReset")
  async requestPasswordReset(
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<{ status: string }> {
    const parsed = resetRequestSchema.safeParse(body);
    // A malformed body is answered exactly like a well-formed one: telling
    // somebody their probe was at least the right shape is information.
    if (!parsed.success) return { status: "accepted" };

    const slug = request.header("x-ds-project") ?? "";
    const origin = this.portalOrigin(request);

    await this.service().beginPasswordReset({
      projectSlug: slug,
      email: parsed.data.email,
      resetUrl: (token) =>
        `${origin}/${encodeURIComponent(slug)}#passwort-neu?token=${encodeURIComponent(token)}`,
    });

    return { status: "accepted" };
  }

  /**
   * Spend the link and set the password.
   *
   * Public, because the token *is* the credential — the person holding it has
   * by definition no session. The policy is checked before the token is spent,
   * so a rejected password does not consume a single-use link and strand
   * somebody.
   */
  @Public()
  @Post("password-reset/confirm")
  @HttpCode(204)
  @RateLimit("participantPasswordChange")
  async confirmPasswordReset(@Body() body: unknown): Promise<void> {
    const parsed = resetConfirmSchema.safeParse(body);
    if (!parsed.success) throw AppError.badRequest("invalid reset");

    const verdict = checkPassword(parsed.data.newPassword, { identifiers: [] });
    if (!verdict.ok) throw AppError.badRequest(`password rejected: ${verdict.reason}`);

    const result = await this.service().completePasswordReset({
      token: parsed.data.token,
      newPassword: parsed.data.newPassword,
      now: new Date(),
    });

    // One answer for expired, spent and never-existed alike (P39-01).
    if (!result.ok) throw AppError.badRequest("this link is no longer valid");
  }

  /**
   * The origin a reset link may point at.
   *
   * The request's own when the deployment allows it, the first configured
   * origin otherwise — never a value from the body. A reset flow that lets the
   * caller name the host delivers a real token to a real inbox pointing at a
   * page the attacker controls.
   */
  private portalOrigin(request: Request): string {
    const origin = request.header("origin");
    if (origin !== undefined && this.config.ALLOWED_ORIGINS.includes(origin)) {
      return origin;
    }
    return this.config.ALLOWED_ORIGINS[0] ?? "";
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
  async me(@CurrentPrincipal() principal: Principal) {
    /*
     * `mustChangePassword` is here and not only on the sign-in response, and
     * that is the difference between a requirement and a suggestion.
     *
     * The portal asks this on every page load. If the flag lived only in the
     * sign-in answer, a participant who is shown the change screen could press
     * F5 and land in the catalogue — the session is already valid, so nothing
     * would stop them. The requirement has to be re-derived from the database
     * on every load, or it is advice.
     *
     * Absent for a federated participant: there is no local password to
     * change, so the field is omitted rather than sent as `false`, which would
     * imply one exists and is fine.
     */
    const credential = await this.service().credentialState(principal.userId);

    /*
     * `email` and `subject` are here because the person reading the screen has
     * no other way to answer "which account am I signed in as" (P54-01).
     *
     * The portal draws a header for a physician who may hold accounts at more
     * than one customer and, on the Keycloak plane, may have been signed in by
     * WordPress without ever seeing a form on our side. `userId` is ours and
     * means nothing to them; the address they typed is the thing they
     * recognise.
     *
     * Both are the caller's own and cannot be anything else: they come off the
     * validated principal, not from a parameter, so there is nothing to point
     * at somebody else's account. `subject` is the identity provider's `sub`,
     * which is what a support conversation about a broken federated login
     * needs — it is the only value that ties a session here to a user in
     * MEDICE's realm.
     *
     * `email` is optional on the principal: a Keycloak realm need not release
     * the claim. Omitted rather than sent as `null`, for the same reason
     * `mustChangePassword` is omitted below — an empty field reads as "we hold
     * nothing", and a missing one reads as "this plane does not have that".
     */
    return {
      userId: principal.userId,
      subject: principal.subject,
      ...(principal.email === undefined ? {} : { email: principal.email }),
      customerId: principal.customerId,
      role: principal.role,
      ...(credential === undefined ? {} : { mustChangePassword: credential.mustChange }),
    };
  }

  /**
   * A participant changing their own password (P21-04).
   *
   * ## Why this route has to exist
   *
   * `learner_credentials.must_change` defaults to true, and every account an
   * administrator creates carries it — correctly, because a password somebody
   * else chose is a password somebody else knows. Until now that flag pointed
   * nowhere: the sign-in reported it and the portal had nothing to offer, so
   * the honest thing was to seed accounts with it *off*. This is the screen
   * that makes it mean something, and the seed can stop lying.
   *
   * ## The policy is the domain's, not a second one
   *
   * `checkPassword` is what the staff plane uses (`staff-identity.ts`): twelve
   * code points, not in the account's own identifiers, bounded above so Argon2
   * cannot be handed a megabyte. A learner-specific copy would drift, and the
   * weaker of two copies is always the one that ends up in front of the larger
   * population.
   */
  @Post("password")
  @Roles("learner", "department_admin", "customer_admin", "super_admin")
  @HttpCode(204)
  @RateLimit("participantPasswordChange")
  async changePassword(
    @Body() body: unknown,
    @CurrentPrincipal() principal: Principal,
  ): Promise<void> {
    const parsed = passwordChangeSchema.safeParse(body);
    if (!parsed.success) throw this.weakPassword();

    const policy = checkPassword(parsed.data.newPassword, {
      identifiers: [
        principal.email ?? "",
        principal.firstName ?? "",
        principal.lastName ?? "",
      ].filter((value) => value !== ""),
    });
    if (!policy.ok) throw this.weakPassword(policy.reason);

    const result = await this.service().changePassword({
      userId: principal.userId,
      currentPassword: parsed.data.currentPassword,
      newPassword: parsed.data.newPassword,
    });

    // One refusal for a wrong current password and for a federated or disabled
    // account alike. The caller is already authenticated, so this is not an
    // enumeration surface — it is simply that none of the three is something
    // the client can usefully act on differently.
    if (!result.ok) {
      throw new AppError(
        "unauthenticated",
        "participant password change refused",
        "Das aktuelle Passwort ist nicht korrekt.",
      );
    }
  }

  /**
   * Why a proposed password was refused, in German the person can act on.
   *
   * Naming the reason is safe and useful here — it is the caller's *own*
   * proposed password, so nothing is disclosed about anybody else, and "too
   * short" versus "contains your name" is the difference between fixing it and
   * guessing.
   */
  private weakPassword(reason?: string): AppError {
    const detail =
      reason === "contains_identifier"
        ? "Das Passwort darf Ihren Namen oder Ihre E-Mail-Adresse nicht enthalten."
        : reason === "too_common"
          ? "Dieses Passwort ist zu häufig. Bitte wählen Sie ein anderes."
          : `Das Passwort muss mindestens ${String(MIN_PASSWORD_LENGTH)} Zeichen lang sein.`;
    return new AppError("validation", `weak password: ${reason ?? "malformed"}`, detail);
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
      // The same cipher the rest of the application uses: the project's stored
      // SMTP password is a secret at rest (CLAUDE.md §4 invariant 7).
      createSecretCipher(this.config.NODE_ENV, this.config.SECRETS_KMS_KEY),
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
