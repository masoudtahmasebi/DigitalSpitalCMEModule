/**
 * Opens the per-request RLS transaction (P1-05), implementing ADR-0002.
 *
 * A thin RxJS↔Promise bridge over `runInTenant` — the transaction lifecycle
 * (BEGIN, `set_config(..., true)`, COMMIT, ROLLBACK, always-release) has
 * exactly one implementation, in `tenant-db.ts`, already covered by
 * `tenant-db.test.ts`. Reimplementing it here would be the second copy of a
 * rule that must never disagree with the first.
 *
 * `firstValueFrom(next.handle())` converts the route handler's Observable into
 * the Promise `runInTenant` expects to run inside its transaction, so the HTTP
 * response is not written until COMMIT has actually completed — a slow commit
 * racing a fast response write could otherwise tell a client "success" for a
 * transaction that had not yet durably landed.
 */

import {
  Injectable,
  Inject,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import type { Request } from "express";
import type { Pool } from "pg";
import { Reflector } from "@nestjs/core";
import { firstValueFrom, from, type Observable } from "rxjs";
import { runInTenant } from "./tenant-db.js";
import { PG_POOL } from "./tokens.js";
import { NO_AMBIENT_TRANSACTION } from "./tenant-runner.js";

@Injectable()
export class TenantTransactionInterceptor implements NestInterceptor {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const principal = request.principal;

    // Public routes (e.g. /health) have no tenant context and touch no data.
    if (principal === undefined) {
      return next.handle();
    }

    /*
     * A route that talks to a third party manages its own transactions
     * (P145-01). Holding one across a call to somebody else's server means a
     * pooled connection sits at `wait_event = ClientRead` for as long as that
     * server takes — which is how a slow bucket becomes a slow platform.
     *
     * The pool is still handed over, so `TenantRun` opens its segments on the
     * same one and `guardReentry` still applies to both.
     */
    if (
      this.reflector.get<boolean>(NO_AMBIENT_TRANSACTION, context.getHandler()) === true
    ) {
      request.tenantPool = this.pool;
      return next.handle();
    }

    return from(
      runInTenant(
        this.pool,
        {
          customerId: principal.customerId,
          role: principal.role,
          userId: principal.userId,
        },
        async (db) => {
          request.db = db;
          return firstValueFrom(next.handle(), { defaultValue: undefined });
        },
      ),
    );
  }
}
