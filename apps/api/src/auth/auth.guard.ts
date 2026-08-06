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
import { capabilitiesOf, resolveTenantContext } from "@ds/domain";
import { SYSTEM_ACTOR, type AuditServicePort } from "../audit/audit.service.js";
import type { UserService } from "../modules/users/user.service.js";
import type { ProjectBindingRepositoryPort } from "../modules/projects/project-binding.repository.js";
import { AppError } from "../shared/problem-details.js";
import type { StaffProfile } from "./principal.js";
import { IS_PUBLIC_KEY } from "./public.decorator.js";
import { authenticateStaff, CSRF_HEADER } from "./staff-session.js";
import type {
  ResolvedStaffSession,
  StaffService,
} from "../modules/staff/staff.service.js";
import { broadestRole, staffTenantContext } from "../modules/staff/staff.service.js";
import { TokenInvalidError } from "./token-verifier.js";
import {
  IdentityProviderRegistry,
  UnknownIdentityProviderError,
  type IdentityProviderName,
} from "./identity-provider.js";

const PROJECT_HEADER = "x-ds-project";

export interface AuthGuardDeps {
  readonly reflector: Reflector;
  readonly identityProviders: IdentityProviderRegistry;
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
        actor: SYSTEM_ACTOR,
        action: "auth.unknown_project",
        subject: projectSlug,
      });
      throw AppError.unauthenticated(`unknown or unbound project slug=${projectSlug}`);
    }

    let identity;
    // Which implementation verifies this project's tokens is the project's own
    // configuration (ADR-0012). An unknown name is a refusal, never a fallback:
    // falling back to Keycloak would let a typo in one row authenticate
    // learners against the wrong realm, which is indistinguishable from working
    // until somebody audits who signed in.
    //
    // The provider's *own* `name` — not `binding.identityProvider`, which is an
    // unvalidated column value — is what the credential is then stored under.
    // The registry has already refused anything it does not implement, so this
    // is the one spelling that is known to be real (P21-01).
    let provider: IdentityProviderName;
    try {
      const implementation = this.deps.identityProviders.forBinding(binding);
      provider = implementation.name;
      identity = await implementation.verify(token, binding);
    } catch (error) {
      const reason =
        error instanceof TokenInvalidError
          ? error.reason
          : error instanceof UnknownIdentityProviderError
            ? "unknown_identity_provider"
            : "unknown";
      await this.deps.audit.recordForCustomer(binding.customerId, {
        actor: SYSTEM_ACTOR,
        action: "auth.token_rejected",
        detail: { reason, projectSlug },
      });
      throw AppError.unauthenticated(`token rejected: ${reason}`);
    }

    const user = await this.deps.userService.syncFromToken(
      provider,
      binding.keycloakIssuer,
      identity,
    );
    const grants = await this.deps.userService.rolesFor(user.id);

    const resolution = resolveTenantContext(grants, binding.customerId);
    if (!resolution.ok) {
      await this.deps.audit.recordForCustomer(binding.customerId, {
        actor: { identity: "learner", id: user.id },
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
        actor: { identity: "learner", id: user.id },
        action: "auth.super_admin_acted_as_customer",
        detail: { projectSlug },
      });
    }

    request.principal = {
      userId: user.id,
      identity: "learner",
      subject: identity.subject,
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
      actor: SYSTEM_ACTOR,
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
  // Built once, before the two exits below, because the two used to build it
  // separately and a field added to one would have been missing from the other.
  request.staffProfile = staffProfileOf(session);

  const projectSlug = request.headers[PROJECT_HEADER];
  if (typeof projectSlug !== "string" || projectSlug === "") {
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
      actor: { identity: "staff", id: session.account.id },
      action: "staff.no_grant_for_customer",
      detail: { reason: resolution.reason, projectSlug },
    });
    throw AppError.forbidden(
      `staff=${session.account.id} holds no grant reaching customer=${binding.customerId}`,
    );
  }

  request.principal = {
    // The staff account id, not a learner `users` row — they are separate
    // populations (ADR-0012), which is exactly what `identity` records.
    userId: session.account.id,
    identity: "staff",
    // The staff plane has no external IdP: the account *is* the subject. This
    // used to synthesise `staff:<uuid>` to fill a field named `keycloakSub`,
    // which was a lie dressed as a value.
    subject: session.account.id,
    email: session.account.email,
    customerId: resolution.context.customerId,
    ...(resolution.context.departmentId === undefined
      ? {}
      : { departmentId: resolution.context.departmentId }),
    role: resolution.context.role,
  };

  return true;
}

/**
 * The staff identity a request carries above any tenant.
 *
 * `role` is the broadest grant held. It is resolved here rather than at each
 * call site because `RolesGuard` reads it to decide whether the operator holds
 * the capability a route requires, and a route's reachability must not depend
 * on which handler happens to recompute it.
 *
 * `broadestRole` returning `undefined` cannot reach here: an account with no
 * grants is refused at login (`staff.login_no_grants`) and disabling an account
 * revokes its sessions. The fallback exists so a race between the two produces
 * the narrowest role rather than a crash — failing closed, not open.
 */
function staffProfileOf(session: ResolvedStaffSession): StaffProfile {
  const role = broadestRole(session.grants) ?? "course_editor";
  return {
    id: session.account.id,
    email: session.account.email,
    displayName: session.account.displayName,
    role,
    capabilities: capabilitiesOf(role),
    grants: session.grants,
  };
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
