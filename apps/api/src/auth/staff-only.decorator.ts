import { SetMetadata } from "@nestjs/common";
import type { ManagedEntity } from "@ds/domain";

export const STAFF_ONLY_KEY = "ds:staff_only";
export const STAFF_CAPABILITY_KEY = "ds:staff_capability";

/**
 * "Any authenticated staff session, no tenant role required."
 *
 * `RolesGuard` is deny-by-default: an endpoint carrying no `@Roles()` returns
 * 403 rather than 200, which is the right default and the reason a forgotten
 * decorator fails closed. But a handful of staff endpoints sit *above* any
 * tenant — the console's own session lookup, sign-out, the customer list a
 * super admin picks from — and have no customer to resolve a role within.
 * There is no `principal` on those requests at all, only a `staffProfile`.
 *
 * This marker says so explicitly. It is not a weaker `@Public()`: the guard
 * still requires a valid, unexpired, unrevoked staff session, and a request
 * carrying only a learner bearer token is refused. What it drops is the
 * *tenant* role check, because there is no tenant.
 */
export const StaffOnly = (): MethodDecorator & ClassDecorator =>
  SetMetadata(STAFF_ONLY_KEY, true);

/**
 * "A staff session that may manage this kind of thing."
 *
 * `@StaffOnly()` alone means *any* operator, which is right for the session
 * lookup and sign-out and wrong for everything else above the tenant. Creating
 * a customer is the sharpest example: it mints a tenant boundary, so only
 * `super_admin` may do it, and a `@StaffOnly()` customer endpoint would be
 * reachable by every course editor in every customer.
 *
 * Scope and capability are different axes (P12-01b). A `department_admin` and a
 * `course_editor` can sit in the same department and still differ on what they
 * may create there, so the check is `canManage(role, entity)` and not a rank
 * comparison — ranking answers who outranks whom, not who may do what.
 *
 * Implies `@StaffOnly()`; there is no need to write both.
 */
export const StaffCapability = (
  entity: ManagedEntity,
): MethodDecorator & ClassDecorator => {
  const capability = SetMetadata(STAFF_CAPABILITY_KEY, entity);
  const staffOnly = SetMetadata(STAFF_ONLY_KEY, true);

  return ((target: object, key?: string | symbol, descriptor?: PropertyDescriptor) => {
    // Applied in this order so both metadata keys land on the same target,
    // whether that target is a method or a class.
    staffOnly(target as never, key as never, descriptor as never);
    return capability(target as never, key as never, descriptor as never);
  }) as MethodDecorator & ClassDecorator;
};
