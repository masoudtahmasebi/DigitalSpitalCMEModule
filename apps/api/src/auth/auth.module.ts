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
import { APP_CONFIG, PG_POOL, PG_SIDE_POOL, REDIS_CLIENT } from "../db/tokens.js";
import type { AppConfig } from "../config/config.js";
import { AuditService } from "../audit/audit.service.js";
import { ProjectBindingRepository } from "../modules/projects/project-binding.repository.js";
import { UserRepository } from "../modules/users/user.repository.js";
import { UserService } from "../modules/users/user.service.js";
import { AuthGuard } from "./auth.guard.js";
import { RolesGuard } from "./roles.guard.js";
import { JwksRegistry } from "./jwks-registry.js";
import {
  IdentityProviderRegistry,
  KeycloakIdentityProvider,
} from "./identity-provider.js";
import { IdentityProviderBootCheck } from "./identity-provider.boot-check.js";
import { LocalIdentityProvider } from "./local-identity-provider.js";
import { LearnerSessionRepository } from "./learner-session.repository.js";
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
      provide: IdentityProviderRegistry,
      useFactory: (jwksRegistry: JwksRegistry, config: AppConfig, pool: Pool) =>
        // Two entries. Which one runs is `projects.identity_provider`, and
        // adding the second changed nothing in the guard, the interceptor or
        // any route — which is the property P12-02 was built for.
        new IdentityProviderRegistry([
          new KeycloakIdentityProvider(jwksRegistry, config.AUTH_CLOCK_TOLERANCE_SEC),
          new LocalIdentityProvider(new LearnerSessionRepository(pool)),
        ]),
      inject: [JwksRegistry, APP_CONFIG, PG_POOL],
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
      /*
       * The side pool (P142-01). Most of this module runs in the guard, before
       * the interceptor opens the request transaction, so it is not nested
       * today — but `AuditService` is handed to services that are, and one rule
       * for every audit writer is what stops the next one being wrong.
       */
      useFactory: (pool: Pool) => new AuditService(pool),
      inject: [PG_SIDE_POOL],
    },
    {
      provide: AuthGuard,
      useFactory: (
        reflector: Reflector,
        identityProviders: IdentityProviderRegistry,
        projectBindings: ProjectBindingRepository,
        userService: UserService,
        audit: AuditService,
        config: AppConfig,
        staffService: StaffService,
      ) =>
        new AuthGuard({
          reflector,
          identityProviders,
          projectBindings,
          userService,
          audit,
          clockToleranceSec: config.AUTH_CLOCK_TOLERANCE_SEC,
          staffService,
        }),
      inject: [
        Reflector,
        IdentityProviderRegistry,
        ProjectBindingRepository,
        UserService,
        AuditService,
        APP_CONFIG,
        StaffService,
      ],
    },
    {
      // Refuses the boot when the schema permits a provider no class
      // implements. `inject` rather than type-based injection — see the note in
      // identity-provider.boot-check.ts about esbuild and decorator metadata.
      provide: IdentityProviderBootCheck,
      useFactory: (registry: IdentityProviderRegistry, pool: Pool) =>
        new IdentityProviderBootCheck(registry, pool),
      inject: [IdentityProviderRegistry, PG_POOL],
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
