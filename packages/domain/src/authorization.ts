/**
 * Tenant resolution from role grants (P1-04), implementing ADR-0002.
 *
 * "Which customer may this request act within, and with what role" is a
 * compliance decision — get it wrong and a department admin reads another
 * customer's data — so it is a pure function here rather than logic embedded in
 * a guard. `CLAUDE.md` §4 invariant 4: everything that decides a compliance
 * outcome lives in this package and is unit-tested exhaustively.
 *
 * The rule: a role is checked against **local assignment** (the `grants`
 * argument), never taken from a token claim. A token can claim anything; only a
 * grant this function was given counts. That is what makes a crafted token
 * claim unable to escalate privilege.
 */

export type AppRole = "super_admin" | "customer_admin" | "department_admin" | "learner";

export interface RoleGrant {
  readonly role: AppRole;
  /** `null` only for a super_admin's global grant. */
  readonly customerId: string | null;
  readonly departmentId: string | null;
}

export interface TenantResolution {
  readonly customerId: string;
  readonly role: AppRole;
  readonly departmentId?: string;
}

export type TenantDenialReason =
  /** No request can proceed without naming which customer it acts within. */
  | "customer_required"
  /** The caller holds no grant reaching this customer at all. */
  | "no_grant_for_customer";

export type TenantResolutionResult =
  | { readonly ok: true; readonly context: TenantResolution }
  | { readonly ok: false; readonly reason: TenantDenialReason };

const ROLE_RANK: Readonly<Record<AppRole, number>> = {
  learner: 0,
  department_admin: 1,
  customer_admin: 2,
  super_admin: 3,
};

/**
 * Resolve the tenant context for a request.
 *
 * Super admin is deliberately not a bypass (ADR-0002): it holds a `customerId:
 * null` grant, but that grant only matches once a specific customer has been
 * requested — there is no "all customers" result. The caller (the guard) is
 * responsible for auditing which customer a super_admin acted as; this function
 * only computes whether the grant permits it.
 *
 * When a user holds multiple grants for the same customer (e.g. both a
 * department_admin grant and, via a global super_admin grant, elevated access),
 * the highest-ranked role wins — never the reverse, which would let a narrower
 * grant silently downgrade a session below what the user is actually entitled
 * to expect.
 */
export function resolveTenantContext(
  grants: readonly RoleGrant[],
  requestedCustomerId: string | undefined,
): TenantResolutionResult {
  if (requestedCustomerId === undefined || requestedCustomerId === "") {
    return { ok: false, reason: "customer_required" };
  }

  const candidates = grants.filter(
    (grant) =>
      grant.customerId === requestedCustomerId ||
      (grant.role === "super_admin" && grant.customerId === null),
  );

  if (candidates.length === 0) {
    return { ok: false, reason: "no_grant_for_customer" };
  }

  const best = candidates.reduce((highest, candidate) =>
    ROLE_RANK[candidate.role] > ROLE_RANK[highest.role] ? candidate : highest,
  );

  return {
    ok: true,
    context: {
      customerId: requestedCustomerId,
      role: best.role,
      ...(best.departmentId === null ? {} : { departmentId: best.departmentId }),
    },
  };
}
