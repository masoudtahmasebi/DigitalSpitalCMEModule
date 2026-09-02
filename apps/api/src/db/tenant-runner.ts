/**
 * For handlers that talk to somebody else's server (P145-01).
 *
 * ## The problem this exists for
 *
 * `TenantTransactionInterceptor` opens the RLS transaction around the **whole**
 * request. That is what makes `request.db` always tenant-scoped and what makes
 * it impossible for a handler to forget `runInTenant`, and it is the right
 * default for the ninety per cent of routes that read and write and nothing
 * else.
 *
 * It is the wrong default for a handler that calls a **third party** in the
 * middle. The upload routes ask the object store to verify an object, to open a
 * multipart upload, to list its parts, to assemble it — and while any of that
 * is in flight, the transaction is open, `wait_event = ClientRead`, and one of
 * ten pooled connections is doing nothing but waiting for a bucket.
 *
 * P144 put a deadline on those calls, which bounds the damage. **A bound is not
 * a fix.** A 15-second stall of the whole API because a bucket is slow is a
 * defect that was designed in, and answering "but it is only fifteen seconds"
 * is the same answer as "a pool of one would deadlock" — technically true, and
 * the reason nobody looked again (§9.10a).
 *
 * ## What this does instead
 *
 * A route marked `@NoAmbientTransaction()` gets no open transaction. It gets
 * this: a function that opens one, runs a **database segment**, and closes it.
 * The shape of every upload handler is already
 *
 *     read some rows → talk to the bucket → write one row
 *
 * so the connection is held for the first and the last, and released for the
 * middle — which is the part that can take a second, or for ever if nobody put
 * a deadline on it.
 *
 * ## What it costs, stated plainly
 *
 * The request is no longer one atomic transaction. For these routes nothing
 * spans the gap that a transaction was protecting: by the time the last write
 * happens the object is already in the bucket, and no invariant relates the
 * mint that was read to the asset row that is written. A route where that is
 * not true must keep the ambient transaction — which is why this is opt-in per
 * route and not a new default.
 */

import { SetMetadata, createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import type { Pool } from "pg";
import { runInTenant, type Db } from "./tenant-db.js";
import { AppError } from "../shared/problem-details.js";

/** Runs one database segment inside its own tenant transaction. */
export type TenantRunner = <T>(work: (db: Db) => Promise<T>) => Promise<T>;

export const NO_AMBIENT_TRANSACTION = "ds:no-ambient-transaction";

/**
 * Marks a route as managing its own transactions.
 *
 * It is not an escape hatch from tenant scoping: the runner below opens the
 * same `runInTenant` with the same principal, so RLS applies exactly as before.
 * The only thing that changes is **how long** a connection is held.
 */
export const NoAmbientTransaction = (): MethodDecorator =>
  SetMetadata(NO_AMBIENT_TRANSACTION, true);

/**
 * Injects the runner. Only valid on a `@NoAmbientTransaction()` route — asking
 * for one where a transaction is already open would nest a second checkout on
 * the same pool, which is P142 exactly, and `guardReentry` would refuse it.
 */
export const TenantRun = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): TenantRunner => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const principal = request.principal;

    if (principal === undefined) {
      throw new AppError("internal", "TenantRun requested on a route with no principal");
    }

    if (request.db !== undefined) {
      // Would deadlock under concurrency (P142-01), and silently, if the guard
      // were ever removed. Refused here so the wiring mistake is a boot-time
      // shape rather than a production incident.
      throw new AppError(
        "internal",
        "TenantRun requested on a route that already has an open transaction — add @NoAmbientTransaction()",
      );
    }

    const pool = request.tenantPool;
    if (pool === undefined) {
      throw new AppError("internal", "TenantRun requested before the interceptor ran");
    }

    return <T>(work: (db: Db) => Promise<T>): Promise<T> =>
      runInTenant(
        pool,
        {
          customerId: principal.customerId,
          role: principal.role,
          ...(principal.userId === undefined ? {} : { userId: principal.userId }),
        },
        work,
      );
  },
);

declare module "express-serve-static-core" {
  interface Request {
    /**
     * The pool the interceptor would have opened a transaction on.
     *
     * Exposed so `TenantRun` opens its segments on the *same* pool the rest of
     * the request path uses, rather than reaching for a module-level singleton
     * and getting it wrong in a test.
     */
    tenantPool?: Pool;
  }
}
