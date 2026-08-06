/**
 * The resolved identity and tenant context for one request (P1-04, P1-05).
 *
 * Everything downstream — RLS session variables, role checks, audit entries —
 * derives from this and nothing else. It is constructed exactly once, by
 * `AuthGuard`, from a validated token and local role assignment. No controller,
 * service or repository may build one from a request parameter: that is the
 * entire point of ADR-0002 — the client's word about who it is is never trusted.
 */

/**
 * Re-exported from `@ds/domain` rather than restated.
 *
 * It was a second declaration of the same union, and the two drifted the moment
 * `course_editor` was added — the compiler caught it, which is the only reason
 * this is a footnote rather than a role silently failing every check.
 */
export type { AppRole } from "@ds/domain";
import type { AppRole, ManagedEntity, StaffRole } from "@ds/domain";

/**
 * Who a staff request is, above and beyond any one tenant (ADR-0012).
 *
 * Separate from `Principal` because it exists on requests that have no tenant
 * at all — the customer list, the operator's own profile — where a
 * `customerId` would have to be invented. `role` is the broadest grant held,
 * which is what capability checks and the console's menu both read.
 *
 * Typed rather than `unknown`: it was `unknown`, and the cost was that
 * `RolesGuard` could only ask whether it existed, which made every staff route
 * equally reachable by every operator.
 */
export interface StaffProfile {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: StaffRole;
  /**
   * Whether this operator has a second factor set up (P22-02).
   *
   * A boolean, deliberately — not the secret, not the enrolment date. The
   * console needs to know whether to offer "remove mine"; neither of the other
   * two is its business, and one of them is a credential.
   */
  readonly secondFactorEnrolled: boolean;
  readonly capabilities: readonly ManagedEntity[];
  readonly grants: readonly {
    readonly role: StaffRole;
    readonly customerId: string | null;
    readonly departmentId: string | null;
  }[];
}

export interface Principal {
  readonly userId: string;
  /**
   * Which population `userId` names (ADR-0012).
   *
   * `userId` is a uuid from one of two disjoint tables — `users` for learners,
   * `admin_users` for operators — and nothing about the value says which. Every
   * audit entry needs the answer, so it is carried rather than inferred.
   */
  readonly identity: "learner" | "staff";
  /**
   * The identity provider's own subject claim.
   *
   * Called `keycloakSub` until P12-02, which was wrong in two directions: the
   * learner plane is no longer necessarily Keycloak (see `IdentityProvider`),
   * and the staff plane never was — it was filling the field with a synthesised
   * `staff:<uuid>` string to satisfy the type.
   */
  readonly subject: string;
  readonly email?: string;
  readonly firstName?: string;
  readonly lastName?: string;
  /** The customer this request acts within. Set even for super_admin — see ADR-0002. */
  readonly customerId: string;
  readonly departmentId?: string;
  readonly role: AppRole;
}

declare module "express-serve-static-core" {
  interface Request {
    principal?: Principal;
    /** Set when the request arrived on the staff plane (ADR-0012). */
    staffSessionId?: string;
    staffProfile?: StaffProfile;
  }
}
