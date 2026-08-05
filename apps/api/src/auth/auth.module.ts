/**
 * Wires the authentication and authorization guards as global guards.
 *
 * Registration order matters: `AuthGuard` must run before `RolesGuard`, since
 * the latter reads `request.principal`, which only the former sets. NestJS
 * runs multiple `APP_GUARD` providers in registration order, so the array
 * order below is not cosmetic.
 *
 * Every dependency here (`JwksRegistry`, `ProjectBindingRepository`,
 * `UserRepository`, `AuditService`) operates on the **raw pool**, never a
 * tenant-scoped `Db` — resolving identity is a precondition for opening the
 * tenant transaction, so it cannot itself run inside one (see
 * `db/migrations/0002_project_binding_lookup.sql`).
 */

import { Module } from "@nestjs/common";
import { APP_GUARD, Reflector } from "@nestjs/core";
import type { Pool } from "pg";
import type { Redis } from "ioredis";
import { APP_CONFIG, PG_POOL, REDIS_CLIENT } from "../db/tokens.js";
import type { AppConfig } from "../config/config.js";
import { AuditService } from "../audit/audit.service.js";
import { ProjectBindingRepository } from "../modules/projects/project-binding.repository.js";
import { UserRepository } from "../modules/users/user.repository.js";
import { UserService } from "../modules/users/user.service.js";
import { AuthGuard } from "./auth.guard.js";
import { RolesGuard } from "./roles.guard.js";
import { JwksRegistry } from "./jwks-registry.js";
import { RedisJwksCache } from "./jwks-cache.redis.js";
import { RateLimitGuard } from "../shared/rate-limit.guard.js";
import { StaffModule } from "../modules/staff/staff.module.js";
import { StaffService } from "../modules/staff/staff.service.js";

@Module({
  imports: [StaffModule],
  providers: [
    {
      provide: JwksRegistry,
      useFactory: (redis: Redis, config: AppConfig) =>
        new JwksRegistry(new RedisJwksCache(redis), {
          cacheTtlSec: config.JWKS_CACHE_TTL_SEC,
        }),
      inject: [REDIS_CLIENT, APP_CONFIG],
    },
    {
      provide: ProjectBindingRepository,
      useFactory: (pool: Pool) => new ProjectBindingRepository(pool),
      inject: [PG_POOL],
    },
    {
      provide: UserRepository,
      useFactory: (pool: Pool) => new UserRepository(pool),
      inject: [PG_POOL],
    },
    {
      provide: UserService,
      useFactory: (repository: UserRepository) => new UserService(repository),
      inject: [UserRepository],
    },
    {
      provide: AuditService,
      useFactory: (pool: Pool) => new AuditService(pool),
      inject: [PG_POOL],
    },
    {
      provide: AuthGuard,
      useFactory: (
        reflector: Reflector,
        jwksRegistry: JwksRegistry,
        projectBindings: ProjectBindingRepository,
        userService: UserService,
        audit: AuditService,
        config: AppConfig,
        staffService: StaffService,
      ) =>
        new AuthGuard({
          reflector,
          jwksRegistry,
          projectBindings,
          userService,
          audit,
          clockToleranceSec: config.AUTH_CLOCK_TOLERANCE_SEC,
          staffService,
        }),
      inject: [
        Reflector,
        JwksRegistry,
        ProjectBindingRepository,
        UserService,
        AuditService,
        APP_CONFIG,
        StaffService,
      ],
    },
    RolesGuard,
    RateLimitGuard,
    { provide: APP_GUARD, useExisting: AuthGuard },
    { provide: APP_GUARD, useExisting: RolesGuard },
    // Last: keyed on request.principal.userId, which AuthGuard sets.
    { provide: APP_GUARD, useExisting: RateLimitGuard },
  ],
  exports: [UserService, AuditService],
})
export class AuthModule {}
