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
import { PARTICIPANT_COOKIE } from "./participant-cookie.js";
import type { StaffProfile } from "./principal.js";
import { IS_PUBLIC_KEY } from "./public.decorator.js";
import { authenticateStaff, CSRF_HEADER, readCookie } from "./staff-session.js";
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
/** How an operator names a tenant that has no project yet (P22-03). */
const CUSTOMER_HEADER = "x-ds-customer";

/**
 * The shape `x-ds-customer` must have before its value reaches a query.
 *
 * Deliberately a format check and nothing more: whether the id *exists*, and
 * whether this operator may reach it, are `staffTenantContext`'s questions and
 * both answer 403 either way (see the header's own comment below). This only
 * stops a value PostgreSQL cannot cast from becoming a 500.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

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

    // A bearer token, or the portal's session cookie (P25-02).
    //
    // Both are "the learner's credential", and which one arrives depends on how
    // the customer authenticates rather than on the route: a federated project
    // sends a Keycloak JWT from the widget, a local one sends an httpOnly
    // cookie from the portal. The *provider* named by the project decides how
    // the value is verified, so the guard does not need to know which is which
    // — it needs one credential, from either place.
    //
    // Bearer first. A browser can hold both — a physician with a MEDICE
    // Keycloak token and a local session at another customer — and the explicit
    // header is the one the caller chose for this request.
    const token =
      extractBearer(request.headers.authorization) ??
      readCookie(request.headers.cookie, PARTICIPANT_COOKIE);

    if (token === undefined) {
      // Names both, because with two accepted forms "no bearer token" sends
      // somebody looking for a header that was never going to be there. The
      // first run of the portal produced exactly this 401 for a request that
      // *had* a valid cookie, and the message was the only thing to go on.
      throw AppError.unauthenticated("no learner credential presented");
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

    // The realm is the **provider's** answer, not the project's column.
    //
    // For Keycloak the two are the same value by construction: `verifyToken`
    // passes `binding.keycloak.issuer` to `jwtVerify` as a required claim, so a
    // token that reaches here cannot carry a different `iss`.
    //
    // For a local project there is no column to key on at all — `binding
    // .keycloak` is absent — while the credential lives under `LOCAL_REALM`.
    // Before the field was optional the row held a placeholder, and keying on
    // it looked up `(local, '<placeholder>', subject)`, missed the row the
    // sign-in had just authenticated, and let `provision_learner` helpfully
    // create a *second* person — one with no membership and no role, so the
    // participant signed in successfully and was then refused by
    // `resolveTenantContext` with a 403 naming a user id they have never had.
    const user = await this.deps.userService.syncFromToken(
      provider,
      identity.issuer,
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

  /*
   * `X-DS-Project` means this is a participant-plane request (P68-02).
   *
   * The console never sends it — it scopes itself with `X-DS-Customer`, or with
   * nothing at all on the platform screens. The portal and the widget send it
   * on every call, because the project *is* how a learner request names its
   * tenant. So the header is not a hint: it is the caller stating which plane
   * it is on, and the staff plane has no business answering.
   *
   * Without this, an operator with the console open in another tab was
   * *authenticated* on the portal. Both apps talk to the same API host, so
   * `ds_staff_session` rides along on the portal's requests; CSRF is not
   * checked on a GET, so `GET /auth/participant/me` succeeded and the portal —
   * whose only test for "am I signed in" that is — drew a signed-in catalogue
   * for somebody who could not enrol in anything on it. P66-01 fixed the same
   * collision for unsafe methods; this is the safe half, and it fails in the
   * more misleading direction.
   *
   * Deferring rather than refusing, and before the session is resolved: a
   * request that names a project is simply not this plane's, and the learner
   * path below will accept or refuse it on its own terms.
   *
   * Adding the header to a genuine console request can only turn a success into
   * a 401 — it grants nothing — so this cannot be turned into an escalation.
   */
  if (typeof request.headers[PROJECT_HEADER] === "string") return false;

  const result = await authenticateStaff({
    method: request.method,
    cookieHeader: request.headers.cookie,
    csrfHeader: headerValue(request, CSRF_HEADER),
    resolve: (value) => service.resolveSession(value),
  });

  if (result.kind === "none") return false;

  if (result.kind === "rejected") {
    /*
     * A staff cookie without a staff CSRF header is not always a staff request
     * (P66-01).
     *
     * Both apps call the **same API host**. An operator signed into the console
     * at `verwaltung.…` therefore sends `ds_staff_session` on every request the
     * *portal* makes at `fortbildung.…`, because the cookie belongs to
     * `api.…` and the browser attaches it to both. The portal is a participant
     * app: it has no staff CSRF token and never will.
     *
     * So this plane used to reject every unsafe method the portal sent — and
     * only the unsafe ones, because CSRF is checked on those alone. Reading a
     * course worked and enrolling in it answered 403, for any person who
     * happened to have the console open in another tab. Reported from
     * production as "enrolment fails while I am logged in".
     *
     * When there is another credential on the request, a failed staff CSRF
     * check means "this was not a staff request", and the right move is to
     * defer rather than to refuse. When there is not, it means what it always
     * meant and is refused exactly as before — so the protection is unchanged
     * for the requests it exists to protect.
     */
    const hasLearnerCredential =
      extractBearer(request.headers.authorization) !== undefined ||
      readCookie(request.headers.cookie, PARTICIPANT_COOKIE) !== undefined;

    if (result.reason === "csrf" && hasLearnerCredential) return false;

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

  /*
   * An operator may name the tenant two ways, and the second one exists
   * because the first had a hole (P22-03).
   *
   * `X-DS-Project` is the learner's way and works for an operator too. But
   * *creating a project* is a tenant-scoped write, so it needed a project
   * header — which needed a project. A customer with none had no way to get
   * one, and that is every customer on the day they are created. A fresh
   * installation was the same case and could not be set up at all through the
   * console it was set up with.
   *
   * `X-DS-Customer` closes it by naming the customer directly. It carries an
   * **id**, not a slug, and needs no lookup: `staffTenantContext` already
   * decides whether these grants reach that customer, and an id the operator
   * holds no grant for is a 403 whether or not it exists. So there is nothing
   * here to enumerate with — which is why this is a staff-plane header and has
   * no learner equivalent.
   */
  const customerHeader = request.headers[CUSTOMER_HEADER];
  if (typeof customerHeader === "string" && customerHeader !== "") {
    /*
     * Checked for shape before it reaches a query.
     *
     * It carries an id, and it was passed through unvalidated — so a caller
     * sending a **slug** (the obvious mistake, and the one the journey suite
     * made on its first run) got a 500 out of a repository, from
     * `invalid input syntax for type uuid`, four layers below anything that
     * knew what the header was.
     *
     * Three things were wrong with that. A malformed request is the client's
     * error and 500 says it is ours; the message that would have explained it
     * is correctly withheld from the response, so the caller has nothing to act
     * on; and any unauthenticated-shaped mistake could raise the 500 rate,
     * which is what the alerting watches.
     *
     * Refused as a 400 naming the header, before the value is used. `AppError`
     * carries the German the console shows.
     */
    if (!UUID_PATTERN.test(customerHeader)) {
      throw new AppError(
        "validation",
        `${CUSTOMER_HEADER} is not a uuid`,
        "Der gewählte Kunde ist ungültig. Bitte wählen Sie ihn erneut aus.",
      );
    }

    return resolveStaffTenant(deps, request, session, {
      customerId: customerHeader,
      // Audit entries name what the caller sent; for this header that is the
      // customer id, and there is no project to report.
      named: `customer=${customerHeader}`,
    });
  }

  const projectSlug = request.headers[PROJECT_HEADER];
  if (typeof projectSlug !== "string" || projectSlug === "") {
    // No tenant context, so no `principal`. Endpoints needing one refuse via
    // RolesGuard; endpoints above the tenant read `staffProfile`.
    return true;
  }

  /*
   * `resolveTenant`, not `resolve` (P22-01).
   *
   * `resolve` treats a project whose `keycloak_issuer` or `keycloak_audience`
   * is NULL as "not found" — which is right, because such a project cannot
   * authenticate a learner. It is wrong here: a staff session is local to the
   * platform and never touches an identity provider (ADR-0012), so the only
   * field this needs is the customer id.
   *
   * Sharing the lookup turned "Keycloak is not configured for this project"
   * into a 401 on every tenant-scoped console screen, for an operator whose
   * session was fine. Both ways of getting there are ordinary: a project
   * created through the console starts without a binding, and a fresh
   * installation has no project at all until somebody makes one — through the
   * screens that were refusing.
   */
  const tenant = await deps.projectBindings.resolveTenant(projectSlug);
  if (tenant === undefined) {
    // 404 rather than 401. The caller is authenticated and the platform knows
    // it, so "no such project" is both the honest answer and a safe one — it
    // is only on the learner plane that whether a slug exists is a fact an
    // anonymous caller should not learn. Answering 401 sent the console to its
    // login form, which is how a configuration problem came to look like a
    // broken sign-in.
    throw AppError.notFound(
      `no project with slug=${projectSlug}`,
      "Dieses Projekt existiert nicht. Bitte wählen Sie ein anderes aus.",
    );
  }

  return resolveStaffTenant(deps, request, session, {
    customerId: tenant.customerId,
    named: `projectSlug=${projectSlug}`,
  });
}

/**
 * Put a staff principal on the request for one customer.
 *
 * Both ways of naming a tenant end here, so `X-DS-Project` and `X-DS-Customer`
 * cannot drift apart on *authorization* — the difference between them is only
 * how the customer id was arrived at.
 */
async function resolveStaffTenant(
  deps: AuthGuardDeps,
  request: Request,
  session: ResolvedStaffSession,
  tenant: { customerId: string; named: string },
): Promise<boolean> {
  const resolution = staffTenantContext(session.grants, tenant.customerId);
  if (!resolution.ok) {
    await deps.audit.recordForCustomer(tenant.customerId, {
      actor: { identity: "staff", id: session.account.id },
      action: "staff.no_grant_for_customer",
      detail: { reason: resolution.reason, named: tenant.named },
    });
    throw AppError.forbidden(
      `staff=${session.account.id} holds no grant reaching customer=${tenant.customerId}`,
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
    // Read off the session's own account row, so the console's security screen
    // and the sign-in path cannot disagree about whether a factor exists
    // (P22-02).
    secondFactorEnrolled: session.account.totpEnrolledAt !== null,
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
