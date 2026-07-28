/**
 * The resolved identity and tenant context for one request (P1-04, P1-05).
 *
 * Everything downstream — RLS session variables, role checks, audit entries —
 * derives from this and nothing else. It is constructed exactly once, by
 * `AuthGuard`, from a validated token and local role assignment. No controller,
 * service or repository may build one from a request parameter: that is the
 * entire point of ADR-0002 — the client's word about who it is is never trusted.
 */

export type AppRole = "super_admin" | "customer_admin" | "department_admin" | "learner";

export interface Principal {
  readonly userId: string;
  readonly keycloakSub: string;
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
  }
}
