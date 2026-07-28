import { SetMetadata } from "@nestjs/common";
import type { AppRole } from "@ds/domain";

/**
 * Declares which roles may reach a route.
 *
 * Deny by default (P1-04): `RolesGuard` rejects any non-public route that
 * carries no `@Roles(...)` at all, so a handler is never reachable purely by
 * forgetting to restrict it.
 */
export const ROLES_KEY = "roles";
export const Roles = (...roles: readonly AppRole[]) => SetMetadata(ROLES_KEY, roles);
