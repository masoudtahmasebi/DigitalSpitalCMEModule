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
import type { AppRole } from "@ds/domain";
import { AppError } from "../shared/problem-details.js";
import { IS_PUBLIC_KEY } from "./public.decorator.js";
import { ROLES_KEY } from "./roles.decorator.js";
import { STAFF_ONLY_KEY } from "./staff-only.decorator.js";

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

    // Above the tenant: a valid staff session is the whole requirement, because
    // there is no customer to resolve a role within. AuthGuard has already
    // established the session; without one there is no `staffProfile`.
    const staffOnly = this.reflector.getAllAndOverride<boolean>(STAFF_ONLY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (staffOnly === true) {
      if (request.staffProfile === undefined) {
        throw AppError.unauthenticated("no staff session");
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
      // AuthGuard runs first; reaching here without a principal means the
      // guard order was misconfigured. Fail closed rather than assume public.
      throw AppError.unauthenticated("no principal resolved before RolesGuard");
    }

    if (!required.includes(principal.role)) {
      throw AppError.forbidden(`role=${principal.role} not in [${required.join(", ")}]`);
    }

    return true;
  }
}
