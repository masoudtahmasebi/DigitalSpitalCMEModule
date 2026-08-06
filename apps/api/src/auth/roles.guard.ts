/**
 * Deny-by-default role enforcement (P1-04).
 *
 * `AuthGuard` establishes *who* the caller is; this guard establishes whether
 * that role may reach *this* route. A route carrying no `@Roles(...)` and no
 * `@Public()` is unreachable — the acceptance criterion is literally "an
 * endpoint without an explicit role decorator returns 403, not 200", so the
 * absence of a decorator must fail closed, not open.
 */

import {
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { canManage, type AppRole, type ManagedEntity } from "@ds/domain";
import { AppError } from "../shared/problem-details.js";
import { IS_PUBLIC_KEY } from "./public.decorator.js";
import { ROLES_KEY } from "./roles.decorator.js";
import { STAFF_CAPABILITY_KEY, STAFF_ONLY_KEY } from "./staff-only.decorator.js";

@Injectable()
export class RolesGuard implements CanActivate {
  // Explicit @Inject(Reflector), not implicit type-based DI: Nest's implicit
  // constructor-parameter injection depends on TypeScript's `design:paramtypes`
  // decorator metadata, which `tsc` emits but esbuild-based tools (this repo's
  // `tsx` dev runner included) silently do not. @Inject supplies the token
  // directly, so this resolves correctly under every toolchain this project
  // runs on, dev and production alike.
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic === true) return true;

    const request = context.switchToHttp().getRequest<Request>();

    // Above the tenant: there is no customer to resolve a role within, so the
    // requirement is a valid staff session plus — where the route declares one
    // — the capability to manage that kind of thing. AuthGuard has already
    // established the session; without one there is no `staffProfile`.
    const staffOnly = this.reflector.getAllAndOverride<boolean>(STAFF_ONLY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (staffOnly === true) {
      const profile = request.staffProfile;
      if (profile === undefined) {
        throw AppError.unauthenticated("no staff session");
      }

      const capability = this.reflector.getAllAndOverride<ManagedEntity>(
        STAFF_CAPABILITY_KEY,
        [context.getHandler(), context.getClass()],
      );

      // No capability declared means "any operator", which is deliberate for
      // the session lookup and sign-out and is the reason `@StaffOnly()` still
      // exists separately from `@StaffCapability()`.
      if (capability !== undefined && !canManage(profile.role, capability)) {
        throw AppError.forbidden(
          `staff role=${profile.role} may not manage ${capability}`,
        );
      }
      return true;
    }

    const required = this.reflector.getAllAndOverride<readonly AppRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No decorator at all: fail closed rather than assume "any authenticated
    // role" was intended.
    if (required === undefined || required.length === 0) {
      throw AppError.forbidden(
        `route ${context.getClass().name}.${context.getHandler().name} declares no @Roles`,
      );
    }

    const principal = request.principal;

    if (principal === undefined) {
      // Two very different situations used to share one message and one 401,
      // and the message named the rarer of the two (P22-01).
      //
      // A valid staff session with no `X-DS-Project` header is by far the
      // common case: this route is tenant-scoped and the console has not told
      // the API which customer to act within. That is a missing *selection*,
      // not a missing *credential*, and answering 401 sent the console to its
      // login form — so "pick a customer" presented as "you have been logged
      // out", which is exactly how it was reported.
      if (request.staffProfile !== undefined) {
        throw AppError.badRequest(
          "this route is tenant-scoped and no X-DS-Project header was sent",
        );
      }

      // No staff profile either, so nothing established an identity: AuthGuard
      // runs first, and reaching here means the guard order was misconfigured.
      // Fail closed rather than assume public.
      throw AppError.unauthenticated("no principal resolved before RolesGuard");
    }

    if (!required.includes(principal.role)) {
      throw AppError.forbidden(`role=${principal.role} not in [${required.join(", ")}]`);
    }

    return true;
  }
}
