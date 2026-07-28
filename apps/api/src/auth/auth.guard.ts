/**
 * The global authentication + tenant resolution guard (P1-01, P1-04, P1-05),
 * implementing ADR-0003 and ADR-0002.
 *
 * Runs before every route except those marked `@Public()`. On success it
 * attaches a `Principal` to the request — the one and only place identity and
 * tenant context are decided (`CurrentPrincipal` only reads it).
 *
 * The sequence, and why it is in this order:
 *
 * 1. Extract the bearer token. No token, no further work — cheapest rejection
 *    first.
 * 2. Resolve the project binding from the `X-DS-Project` header (ADR-0007
 *    `HostContext`). This is what tells us *which Keycloak realm* to validate
 *    against — we cannot verify a token without knowing that first.
 * 3. Verify the token against that realm's JWKS: signature, issuer, audience,
 *    expiry (ADR-0003). Issuer and audience come from the resolved binding,
 *    never from the token itself — a validly-signed token minted for another
 *    project or realm is rejected here.
 * 4. Resolve the local user (provisioning on first sight) and their **locally
 *    assigned** roles — never roles claimed by the token (P1-04).
 * 5. Resolve the tenant context via the pure `resolveTenantContext` — the
 *    project binding pins the customer, so this either confirms the caller
 *    holds a grant reaching it, or denies.
 *
 * Every rejection path returns the same generic 401. The *reason* — bad
 * signature, unknown project, no grant — is never disclosed to the client and
 * is available only via the internal `reason`/`AppError.reason` for logs.
 */

import { Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { resolveTenantContext } from "@ds/domain";
import type { AuditServicePort } from "../audit/audit.service.js";
import type { UserService } from "../modules/users/user.service.js";
import type { ProjectBindingRepositoryPort } from "../modules/projects/project-binding.repository.js";
import { AppError } from "../shared/problem-details.js";
import { IS_PUBLIC_KEY } from "./public.decorator.js";
import { TokenInvalidError, verifyToken } from "./token-verifier.js";
import type { JwksRegistry } from "./jwks-registry.js";

const PROJECT_HEADER = "x-ds-project";

export interface AuthGuardDeps {
  readonly reflector: Reflector;
  readonly jwksRegistry: JwksRegistry;
  readonly projectBindings: ProjectBindingRepositoryPort;
  readonly userService: UserService;
  readonly audit: AuditServicePort;
  readonly clockToleranceSec: number;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly deps: AuthGuardDeps) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.deps.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic === true) return true;

    const request = context.switchToHttp().getRequest<Request>();

    const token = extractBearer(request.headers.authorization);
    if (token === undefined) {
      throw AppError.unauthenticated("no bearer token presented");
    }

    const projectSlug = request.headers[PROJECT_HEADER];
    if (typeof projectSlug !== "string" || projectSlug === "") {
      throw AppError.unauthenticated("no X-DS-Project header presented");
    }

    const binding = await this.deps.projectBindings.resolve(projectSlug);
    if (binding === undefined) {
      await this.deps.audit.recordSystem({
        action: "auth.unknown_project",
        subject: projectSlug,
      });
      throw AppError.unauthenticated(`unknown or unbound project slug=${projectSlug}`);
    }

    const jwks = this.deps.jwksRegistry.forIssuer(binding.keycloakIssuer);

    let identity;
    try {
      identity = await verifyToken(token, await jwks.resolver(), {
        issuer: binding.keycloakIssuer,
        audience: binding.keycloakAudience,
        clockToleranceSec: this.deps.clockToleranceSec,
      });
    } catch (error) {
      const reason = error instanceof TokenInvalidError ? error.reason : "unknown";
      await this.deps.audit.recordForCustomer(binding.customerId, {
        action: "auth.token_rejected",
        detail: { reason, projectSlug },
      });
      throw AppError.unauthenticated(`token rejected: ${reason}`);
    }

    const user = await this.deps.userService.syncFromToken(
      binding.keycloakIssuer,
      identity,
    );
    const grants = await this.deps.userService.rolesFor(user.id);

    const resolution = resolveTenantContext(grants, binding.customerId);
    if (!resolution.ok) {
      await this.deps.audit.recordForCustomer(binding.customerId, {
        actorId: user.id,
        action: "auth.no_grant_for_customer",
        detail: { reason: resolution.reason, projectSlug },
      });
      throw AppError.forbidden(
        `user=${user.id} holds no grant reaching customer=${binding.customerId}`,
      );
    }

    // Super admin acting on a tenant is audited every time, per ADR-0002 — it
    // is deliberately not a silent bypass.
    if (resolution.context.role === "super_admin") {
      await this.deps.audit.recordForCustomer(binding.customerId, {
        actorId: user.id,
        action: "auth.super_admin_acted_as_customer",
        detail: { projectSlug },
      });
    }

    request.principal = {
      userId: user.id,
      keycloakSub: user.keycloakSub,
      ...(user.email === null ? {} : { email: user.email }),
      ...(user.firstName === null ? {} : { firstName: user.firstName }),
      ...(user.lastName === null ? {} : { lastName: user.lastName }),
      customerId: resolution.context.customerId,
      ...(resolution.context.departmentId === undefined
        ? {}
        : { departmentId: resolution.context.departmentId }),
      role: resolution.context.role,
    };

    return true;
  }
}

function extractBearer(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || token === undefined || token === "") {
    return undefined;
  }
  return token;
}
