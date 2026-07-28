import { Module } from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";
import { DbModule } from "./db/db.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { TenantTransactionInterceptor } from "./db/tenant-transaction.interceptor.js";
import { ProblemDetailsFilter } from "./shared/problem-details.filter.js";
import { CatalogModule } from "./modules/catalog/catalog.module.js";
import { HealthModule } from "./modules/health/health.module.js";

@Module({
  imports: [DbModule, AuthModule, HealthModule, CatalogModule],
  providers: [
    // Runs after AuthGuard/RolesGuard (guards execute before interceptors in
    // Nest's pipeline), so request.principal is already set when this opens
    // the RLS transaction.
    { provide: APP_INTERCEPTOR, useClass: TenantTransactionInterceptor },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
})
export class AppModule {}
