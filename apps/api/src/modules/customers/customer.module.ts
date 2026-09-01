/**
 * Wiring for the customer registry (P12-04).
 *
 * Unlike the authoring and admin modules, this one has real providers rather
 * than per-request construction from a tenant `Db`. It has to: these routes
 * carry no tenant, so there is no `request.db` to build a service from. The
 * repository takes the raw pool and opens its own tenant context per operation
 * (see `customer.repository.ts`), which is the same reason `AuthModule`'s
 * providers work on the pool.
 *
 * `useFactory` with an explicit `inject` array rather than type-based
 * injection: `emitDecoratorMetadata` is a TypeScript-compiler feature esbuild
 * does not implement, and `pnpm dev` runs this app through `tsx`.
 */

import { Module } from "@nestjs/common";
import type { Pool } from "pg";
import { PG_SIDE_POOL } from "../../db/tokens.js";
import { AuditService } from "../../audit/audit.service.js";
import { CustomerController } from "./customer.controller.js";
import { CustomerRepository } from "./customer.repository.js";
import { CustomerService } from "./customer.service.js";

@Module({
  controllers: [CustomerController],
  providers: [
    {
      provide: CustomerRepository,
      /*
       * The side pool (P142-01). This repository enters a **different** tenant
       * than the request's — the customer being administered — so it cannot
       * reuse the request's transaction, and taking a second connection from
       * the request's own pool is what deadlocked the API.
       */
      useFactory: (pool: Pool) => new CustomerRepository(pool),
      inject: [PG_SIDE_POOL],
    },
    {
      provide: AuditService,
      useFactory: (pool: Pool) => new AuditService(pool),
      inject: [PG_SIDE_POOL],
    },
    {
      provide: CustomerService,
      useFactory: (repository: CustomerRepository, audit: AuditService) =>
        new CustomerService(repository, audit),
      inject: [CustomerRepository, AuditService],
    },
  ],
})
export class CustomerModule {}
