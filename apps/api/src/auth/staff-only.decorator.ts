import { SetMetadata } from "@nestjs/common";

export const STAFF_ONLY_KEY = "ds:staff_only";

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
