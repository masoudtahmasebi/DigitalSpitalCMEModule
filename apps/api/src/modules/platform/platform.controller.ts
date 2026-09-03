/**
 * Installation-wide settings, from the console (P180-01). Interface layer.
 *
 * ## Why `@StaffCapability("platform")` and not `@Roles(...)`
 *
 * The same reason the customer registry uses a capability: `@Roles` resolves a
 * role *within a tenant*, and this setting has no tenant. There is no
 * `X-DS-Project` header on these requests and therefore no `principal` — only a
 * `staffProfile` (ADR-0012).
 *
 * `platform` is held by `super_admin` alone. A customer administrator runs
 * their own courses and participants; deciding which register the whole
 * installation files statutory Punktemeldungen to is an authority over every
 * tenant at once, including ones they have never heard of.
 *
 * ## Why the operator id comes from the session
 *
 * `staffProfile.id` is set by `AuthGuard` from a validated session, and it is
 * what gets written into `eiv_live_confirmed_by`. Accepting it from the body
 * would let a caller put somebody else's name against consent to file against
 * the live Ärztekammer register — which is precisely the field whose value is
 * "who agreed to this".
 */

import { Body, Controller, Get, Inject, Patch, Req } from "@nestjs/common";
import type { Request } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import { StaffCapability } from "../../auth/staff-only.decorator.js";
import { AppError } from "../../shared/problem-details.js";
import { AuditService } from "../../audit/audit.service.js";
import { APP_CONFIG, PG_SIDE_POOL } from "../../db/tokens.js";
import type { AppConfig } from "../../config/config.js";
import { PlatformSettingsRepository } from "./platform-settings.repository.js";
import {
  PlatformSettingsService,
  type EivPlatformSettings,
} from "./platform-settings.service.js";

/**
 * A word, never a URL (P180-01).
 *
 * The console picks which register receives Punktemeldungen; the platform owns
 * what each word resolves to. A `z.string().url()` here would be a text box in
 * which somebody types the production register — or somebody else's host.
 */
const EivSettings = z.object({
  workerEnabled: z.boolean().optional(),
  endpoint: z.enum(["mock", "test", "live"]).optional(),
  /**
   * Present and true only when the operator ticked the box in this request.
   *
   * Deliberately not a field that can be sent as `false` to *withdraw* consent:
   * consent is cleared by changing the endpoint, which is the act that makes it
   * meaningless. A "consented: false" that left the endpoint alone would be a
   * second way to reach a state the worker's own guard already covers.
   */
  confirmLive: z.literal(true).optional(),
});

@Controller("admin/platform")
@StaffCapability("platform")
export class PlatformController {
  constructor(
    /**
     * The **side** pool, for the same reason the audit service takes it
     * (P142-01): this controller has no tenant transaction of its own, and a
     * second checkout from `PG_POOL` while a request holds the first is the
     * deadlock shape that suite exists to catch.
     */
    @Inject(PG_SIDE_POOL) private readonly sidePool: Pool,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get("eiv")
  async readEiv(): Promise<EivPlatformSettings> {
    return this.service().read();
  }

  @Patch("eiv")
  async updateEiv(
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<EivPlatformSettings> {
    const input = EivSettings.parse(body);
    return this.service().update(input, { staffUserId: operator(request) }, new Date());
  }

  private service(): PlatformSettingsService {
    return new PlatformSettingsService(
      new PlatformSettingsRepository(this.sidePool),
      new AuditService(this.sidePool),
      this.config.EIV_MOCK_BASE_URL,
    );
  }
}

function operator(request: Request): string {
  const profile = request.staffProfile;
  if (profile === undefined) {
    // The guard has already refused a request without a staff session, so
    // reaching here means the guard order is misconfigured. It throws rather
    // than defaulting: this id is written into `eiv_live_confirmed_by`, and a
    // consent row attributed to nobody answers "when" without answering "who".
    throw AppError.unauthenticated("no staff session on a platform route");
  }
  return profile.id;
}
