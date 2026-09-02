/**
 * Liveness, readiness and metrics. Public: a load balancer cannot present a
 * bearer token, and none of these touch tenant data, so `@Public()` is the
 * correct, explicit opt-out from the deny-by-default rule (P1-04).
 *
 * ## Why liveness and readiness are different endpoints (P25-01)
 *
 * There was one `/health`, and it returned `degraded` when the database was
 * unreachable — with a **200**. Both halves of that are wrong for an
 * orchestrator:
 *
 * - **Liveness** answers "is this process wedged, should it be killed?" It must
 *   *not* depend on Postgres. A database outage that made liveness fail would
 *   restart every API container in a loop, turning a recoverable dependency
 *   failure into a self-inflicted outage that continues after the database
 *   comes back.
 * - **Readiness** answers "should traffic be sent here?" It must depend on
 *   Postgres, and it must answer with a **503**, because a 200 saying
 *   "degraded" in the body is a 200 to every load balancer ever written.
 *
 * `/health` stays, unchanged, because the deploy script and the compose
 * healthcheck already use it and breaking those to tidy a URL would be a poor
 * trade.
 */

import { Controller, Get, Header, HttpCode, Inject, Res } from "@nestjs/common";
import type { Response } from "express";
import { Public } from "../../auth/public.decorator.js";
import { Metrics } from "../../observability/metrics.js";
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

  /**
   * Is the process alive? Deliberately answers without touching anything.
   *
   * No database, no Redis, no object storage. If this responds, the event loop
   * is turning and the process should not be killed — which is the only
   * question a liveness probe is entitled to ask.
   */
  @Public()
  @Get("live")
  live(): { status: "ok" } {
    return { status: "ok" };
  }

  /**
   * Should this instance receive traffic?
   *
   * 503 when the database is unreachable, because a load balancer reads the
   * status code and nothing else. The body says which dependency failed, for
   * the human who follows.
   */
  @Public()
  @Get("ready")
  async ready(@Res({ passthrough: true }) response: Response): Promise<HealthStatus> {
    const status = await this.health.check();
    if (status.status !== "ok") response.status(503);
    return status;
  }
}

/**
 * The Prometheus scrape endpoint.
 *
 * Its own controller because it is not health: a scraper polls it every fifteen
 * seconds and it must never be confused with a probe.
 *
 * **Public, and that is a decision.** It exposes request counts by route and
 * status, and no tenant data, no identifier and nothing personal — see
 * `metrics.ts` for why route labels are bounded templates rather than paths.
 * On this deployment it is reachable only from inside the Docker network:
 * `infra/deploy/Caddyfile` refuses `/metrics` at the edge with a 404, so an
 * external scraper needs an SSH tunnel. That is the right default for a single
 * host; a fleet would want an allow-list instead.
 *
 * Until P113-02 that sentence was wrong. The API site block ended in a bare
 * `reverse_proxy`, a catch-all over every path, so this endpoint answered the
 * internet — including `ds_build_info{commit="…"}`, which `metrics.ts` added
 * on the strength of this very claim. The matcher exists now, and
 * `deploy-vars.test.sh` goes red if it is removed.
 */
@Controller("metrics")
export class MetricsController {
  constructor(@Inject(Metrics) private readonly metrics: Metrics) {}

  @Public()
  @Get()
  @HttpCode(200)
  @Header("content-type", "text/plain; version=0.0.4; charset=utf-8")
  scrape(): string {
    return this.metrics.render();
  }
}
