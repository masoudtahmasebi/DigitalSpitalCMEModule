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
import { authenticateStaff, CSRF_HEADER } from "./staff-session.js";
import type { StaffService } from "../modules/staff/staff.service.js";
import { staffTenantContext } from "../modules/staff/staff.service.js";
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
  /**
   * The staff plane (ADR-0012). Optional so a deployment that runs only the
   * learner API — or a test that only exercises it — needs no staff wiring.
   */
  readonly staffService?: StaffService | undefined;
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

    /*
     * The staff plane is tried first, and only when a cookie is actually
     * present.
     *
     * Order matters and so does the "actually present" part. A staff member's
     * browser may carry both credentials — the console and the portal can share
     * a parent domain — and the cookie is the one that names *them* rather than
     * a learner. But a request with no cookie must fall straight through: were
     * an absent cookie treated as a failed staff attempt, every learner request
     * would 401 the moment this was wired in.
     */
    if (await authenticateStaffPlane(this.deps, request)) return true;

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

/**
 * Resolve a staff session onto `request.principal`, or report that this was not
 * a staff request.
 *
 * Ends at the same `resolveTenantContext` the learner path uses, so the two
 * authentication paths cannot diverge on *authorization* even though they are
 * deliberately separate on authentication.
 */
async function authenticateStaffPlane(
  deps: AuthGuardDeps,
  request: Request,
): Promise<boolean> {
  const service = deps.staffService;
  if (service === undefined) return false;

  const result = await authenticateStaff({
    method: request.method,
    cookieHeader: request.headers.cookie,
    csrfHeader: headerValue(request, CSRF_HEADER),
    resolve: (value) => service.resolveSession(value),
  });

  if (result.kind === "none") return false;

  if (result.kind === "rejected") {
    await deps.audit.recordSystem({
      action: "staff.request_rejected",
      detail: { reason: result.reason },
    });
    throw result.reason === "csrf"
      ? AppError.forbidden("missing or invalid CSRF token")
      : AppError.unauthenticated(`staff session ${result.reason}`);
  }

  const { session } = result;
  request.staffSessionId = session.sessionId;

  /*
   * Which customer this request acts within.
   *
   * A staff request names it with the same `X-DS-Project` header a learner
   * uses, so one endpoint serves both. A super admin with no project header is
   * the one exception — the console's own screens (the customer list, their own
   * profile) are above any single tenant — and those endpoints resolve their
   * own scope rather than relying on `principal.customerId`.
   */
  const projectSlug = request.headers[PROJECT_HEADER];
  if (typeof projectSlug !== "string" || projectSlug === "") {
    request.staffProfile = {
      id: session.account.id,
      email: session.account.email,
      displayName: session.account.displayName,
      grants: session.grants,
    };
    // No tenant context, so no `principal`. Endpoints needing one refuse via
    // RolesGuard; endpoints above the tenant read `staffProfile`.
    return true;
  }

  const binding = await deps.projectBindings.resolve(projectSlug);
  if (binding === undefined) {
    throw AppError.unauthenticated(`unknown or unbound project slug=${projectSlug}`);
  }

  const resolution = staffTenantContext(session.grants, binding.customerId);
  if (!resolution.ok) {
    await deps.audit.recordForCustomer(binding.customerId, {
      action: "staff.no_grant_for_customer",
      detail: { reason: resolution.reason, projectSlug },
    });
    throw AppError.forbidden(
      `staff=${session.account.id} holds no grant reaching customer=${binding.customerId}`,
    );
  }

  request.staffProfile = {
    id: session.account.id,
    email: session.account.email,
    displayName: session.account.displayName,
    grants: session.grants,
  };

  request.principal = {
    // The staff account id, not a learner `users` row — they are separate
    // populations (ADR-0012) and an audit entry has to say which.
    userId: session.account.id,
    keycloakSub: `staff:${session.account.id}`,
    email: session.account.email,
    customerId: resolution.context.customerId,
    ...(resolution.context.departmentId === undefined
      ? {}
      : { departmentId: resolution.context.departmentId }),
    role: resolution.context.role,
  };

  return true;
}

function headerValue(request: Request, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === "string" ? value : undefined;
}

function extractBearer(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || token === undefined || token === "") {
    return undefined;
  }
  return token;
}
