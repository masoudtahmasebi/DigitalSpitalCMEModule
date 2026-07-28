/**
 * Injects the per-request tenant-scoped `Db` into a handler (P1-05).
 *
 * Deliberately **not** implemented via NestJS request scope. A request-scoped
 * provider bubbles request-scope to every consumer up to and including the
 * controller, and Nest resolves that entire subtree while binding the route
 * handler — which happens before guards run. That resolves the repository
 * before `TenantTransactionInterceptor` has opened the transaction and set
 * `request.db`, which is a request-scope/guard-ordering conflict, not
 * something request scope was designed to prevent.
 *
 * The fix is to not fight the framework: repositories and services here are
 * plain classes (see `CatalogRepository`, `CatalogService`), constructed
 * per-request by the controller from a `Db` obtained through this decorator,
 * exactly the way the unit tests already construct them from a fake. One
 * pattern, in tests and in production.
 */

import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import type { Db } from "./tenant-db.js";
import { AppError } from "../shared/problem-details.js";

export const TenantDb = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Db => {
    const request = ctx.switchToHttp().getRequest<Request>();

    if (request.db === undefined) {
      // Reaching a route that uses @TenantDb() without a principal is a wiring
      // bug (the route should have been @Public(), or the interceptor did not
      // run) — not a condition a client can trigger, since AuthGuard/RolesGuard
      // already reject an unauthenticated or ungranted request before this runs.
      throw new AppError(
        "internal",
        "TenantDb requested on a route with no open tenant transaction",
      );
    }

    return request.db;
  },
);
