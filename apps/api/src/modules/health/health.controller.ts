/**
 * Liveness/readiness probe. Public: a load balancer cannot present a bearer
 * token, and this endpoint touches no tenant data, so `@Public()` is the
 * correct, explicit opt-out from the deny-by-default rule (P1-04).
 */

import { Controller, Get, Inject } from "@nestjs/common";
import { Public } from "../../auth/public.decorator.js";
import { HealthService, type HealthStatus } from "./health.service.js";

@Controller("health")
export class HealthController {
  // Explicit @Inject: see roles.guard.ts for why implicit type-based DI is
  // not used anywhere in this codebase.
  constructor(@Inject(HealthService) private readonly health: HealthService) {}

  @Public()
  @Get()
  async check(): Promise<HealthStatus> {
    return this.health.check();
  }
}
