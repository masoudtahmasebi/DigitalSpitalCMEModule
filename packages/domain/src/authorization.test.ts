import { describe, expect, it } from "vitest";
import { resolveTenantContext, type RoleGrant } from "./authorization.js";

const MEDICE = "11111111-1111-1111-1111-111111111111";
const TROMMSDORF = "22222222-2222-2222-2222-222222222222";
const ADHS_DEPT = "33333333-3333-3333-3333-333333333333";

describe("resolveTenantContext", () => {
  it("fails closed when no customer is requested", () => {
    const grants: RoleGrant[] = [
      { role: "learner", customerId: MEDICE, departmentId: null },
    ];

    expect(resolveTenantContext(grants, undefined)).toEqual({
      ok: false,
      reason: "customer_required",
    });
  });

  it("fails closed on an empty string customer id", () => {
    expect(resolveTenantContext([], "")).toEqual({
      ok: false,
      reason: "customer_required",
    });
  });

  it("resolves a learner against their own customer", () => {
    const grants: RoleGrant[] = [
      { role: "learner", customerId: MEDICE, departmentId: null },
    ];

    expect(resolveTenantContext(grants, MEDICE)).toEqual({
      ok: true,
      context: { customerId: MEDICE, role: "learner" },
    });
  });

  it("denies a learner requesting a customer they hold no grant for", () => {
    // The security property this whole function exists for: a crafted
    // request naming another customer must not be honoured just because a
    // grant exists for SOME customer.
    const grants: RoleGrant[] = [
      { role: "learner", customerId: MEDICE, departmentId: null },
    ];

    expect(resolveTenantContext(grants, TROMMSDORF)).toEqual({
      ok: false,
      reason: "no_grant_for_customer",
    });
  });

  it("denies a request with no grants at all", () => {
    expect(resolveTenantContext([], MEDICE)).toEqual({
      ok: false,
      reason: "no_grant_for_customer",
    });
  });

  it("carries the department through for a department_admin grant", () => {
    const grants: RoleGrant[] = [
      { role: "department_admin", customerId: MEDICE, departmentId: ADHS_DEPT },
    ];

    expect(resolveTenantContext(grants, MEDICE)).toEqual({
      ok: true,
      context: { customerId: MEDICE, role: "department_admin", departmentId: ADHS_DEPT },
    });
  });

  it("lets a super_admin's global grant reach any explicitly named customer", () => {
    // Deliberately not a bypass: it still requires the customer to be named.
    // There is no "act as everyone" result — see the customer_required case.
    const grants: RoleGrant[] = [
      { role: "super_admin", customerId: null, departmentId: null },
    ];

    expect(resolveTenantContext(grants, TROMMSDORF)).toEqual({
      ok: true,
      context: { customerId: TROMMSDORF, role: "super_admin" },
    });
  });

  it("does not let a customer-scoped super_admin grant reach a different customer", () => {
    // A super_admin grant scoped to one customer (customerId set, not null) is
    // not global — only customerId: null is global.
    const grants: RoleGrant[] = [
      { role: "super_admin", customerId: MEDICE, departmentId: null },
    ];

    expect(resolveTenantContext(grants, TROMMSDORF)).toEqual({
      ok: false,
      reason: "no_grant_for_customer",
    });
  });

  it("picks the highest-ranked grant when several match the same customer", () => {
    const grants: RoleGrant[] = [
      { role: "learner", customerId: MEDICE, departmentId: null },
      { role: "department_admin", customerId: MEDICE, departmentId: ADHS_DEPT },
    ];

    expect(resolveTenantContext(grants, MEDICE)).toEqual({
      ok: true,
      context: { customerId: MEDICE, role: "department_admin", departmentId: ADHS_DEPT },
    });
  });

  it("never lets a narrower grant downgrade a broader one, regardless of array order", () => {
    const broadFirst: RoleGrant[] = [
      { role: "customer_admin", customerId: MEDICE, departmentId: null },
      { role: "learner", customerId: MEDICE, departmentId: null },
    ];
    const narrowFirst: RoleGrant[] = [...broadFirst].reverse();

    expect(resolveTenantContext(broadFirst, MEDICE)).toEqual(
      resolveTenantContext(narrowFirst, MEDICE),
    );
    expect(resolveTenantContext(broadFirst, MEDICE)).toMatchObject({
      context: { role: "customer_admin" },
    });
  });

  it("is indifferent to grants for other customers mixed into the list", () => {
    const grants: RoleGrant[] = [
      { role: "customer_admin", customerId: TROMMSDORF, departmentId: null },
      { role: "learner", customerId: MEDICE, departmentId: null },
    ];

    expect(resolveTenantContext(grants, MEDICE)).toEqual({
      ok: true,
      context: { customerId: MEDICE, role: "learner" },
    });
  });

  it("ranks super_admin above customer_admin above department_admin above learner", () => {
    const order = [
      "learner",
      "department_admin",
      "customer_admin",
      "super_admin",
    ] as const;

    for (let i = 0; i < order.length; i++) {
      for (let j = 0; j < order.length; j++) {
        const grants: RoleGrant[] = [
          { role: order[i]!, customerId: MEDICE, departmentId: null },
          { role: order[j]!, customerId: MEDICE, departmentId: null },
        ];
        const winner = i >= j ? order[i]! : order[j]!;

        expect(resolveTenantContext(grants, MEDICE)).toMatchObject({
          context: { role: winner },
        });
      }
    }
  });

  it("is pure — identical input yields identical output", () => {
    const grants: RoleGrant[] = [
      { role: "customer_admin", customerId: MEDICE, departmentId: null },
    ];

    expect(resolveTenantContext(grants, MEDICE)).toEqual(
      resolveTenantContext(grants, MEDICE),
    );
  });
});
