/**
 * The staff plane's wiring (P12-03).
 *
 * Everything here operates on the **raw pool**, never a tenant-scoped `Db`, for
 * the same reason `AuthModule`'s providers do: resolving who somebody is has to
 * happen before the tenant transaction can be opened, so it cannot run inside
 * one.
 *
 * `StaffService` is exported because `AuthGuard` needs it, and `AuthModule`
 * imports this module rather than the reverse — the guard depends on the plane,
 * not the plane on the guard.
 */

import { Module } from "@nestjs/common";
import type { Pool } from "pg";
import { APP_CONFIG, PG_POOL, PG_SIDE_POOL } from "../../db/tokens.js";
import type { AppConfig } from "../../config/config.js";
import { AuditService } from "../../audit/audit.service.js";
import { createSecretCipher } from "../../shared/secret-cipher.js";
import { StaffRepository } from "./staff.repository.js";
import { StaffService } from "./staff.service.js";
import { StaffAccountsController } from "./staff-accounts.controller.js";
import {
  StaffAuthController,
  STAFF_AUTH_CONFIG,
  type StaffAuthConfig,
} from "./staff-auth.controller.js";

@Module({
  controllers: [StaffAuthController, StaffAccountsController],
  providers: [
    {
      provide: StaffRepository,
      useFactory: (pool: Pool) => new StaffRepository(pool),
      inject: [PG_POOL],
    },
    {
      provide: AuditService,
      // The audit log's own connection — see PG_SIDE_POOL (P142-01).
      useFactory: (pool: Pool) => new AuditService(pool),
      inject: [PG_SIDE_POOL],
    },
    {
      provide: StaffService,
      useFactory: (repository: StaffRepository, audit: AuditService, config: AppConfig) =>
        new StaffService({
          repository,
          audit,
          // The KMS key doubles as the IP-hash salt. Reusing it is deliberate:
          // an unsalted hash of an IPv4 address is reversible by enumerating
          // the whole space in seconds, and a second secret to provision would
          // be one more thing to get wrong for no additional protection.
          ipSalt: config.SECRETS_KMS_KEY,
          // The same cipher the rest of the application uses for secrets at
          // rest: a TOTP secret is one (CLAUDE.md §4 invariant 7).
          cipher: createSecretCipher(config.NODE_ENV, config.SECRETS_KMS_KEY),
          // What an authenticator app shows beside the code. Fixed rather than
          // per-customer: the account is a DigitalSpital operator account, and
          // labelling it with a customer's name would misdescribe who it
          // belongs to.
          totpIssuer: "DigitalSpital",
          now: () => new Date(),
        }),
      inject: [StaffRepository, AuditService, APP_CONFIG],
    },
    {
      provide: STAFF_AUTH_CONFIG,
      useFactory: (config: AppConfig): StaffAuthConfig => ({
        cookieDomain: config.STAFF_COOKIE_DOMAIN,
        // Secure cookies everywhere but development, where the console is
        // served over plain HTTP on localhost and a Secure cookie would simply
        // never be stored.
        secureCookies: config.NODE_ENV === "production",
        /*
         * Where a password-reset link may point (P40-02).
         *
         * The CORS list, reused rather than a second variable to keep in step:
         * the origins allowed to *call* the API are exactly the origins the
         * platform already trusts to be its own front ends. The first entry is
         * the fallback for a request that carries no recognised origin —
         * ordinarily the console, since it is listed first in every deployment
         * template. An installation with none configured gets an empty string,
         * which produces a relative link: wrong-looking in an email, and it
         * cannot point anywhere an attacker chose.
         */
        allowedOrigins: config.ALLOWED_ORIGINS,
        consoleUrl: config.ALLOWED_ORIGINS[0] ?? "",
      }),
      inject: [APP_CONFIG],
    },
  ],
  exports: [StaffService],
})
export class StaffModule {}
