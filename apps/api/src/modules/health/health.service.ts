/**
 * Health check use case. Application layer — ADR-0006.
 *
 * Kept separate from the controller so the controller stays free of any
 * database import, consistent with every other feature in this codebase.
 */

import { Injectable, Inject } from "@nestjs/common";
import type { Pool } from "pg";
import type { Redis } from "ioredis";
import { PG_POOL, REDIS_CLIENT } from "../../db/tokens.js";

export interface HealthStatus {
  readonly status: "ok" | "degraded";
  readonly database: boolean;
  /**
   * Whether Redis answered (P52-01).
   *
   * It was not checked at all until a QA pass stopped Redis and watched this
   * endpoint go on returning `{"status":"ok"}`. That is not a cosmetic gap:
   * `deploy.sh` waits on `/health` and treats a 200 as a successful release,
   * so a deployment whose Redis never came up reported success and went green.
   * A gate that cannot go red is not a gate (CLAUDE.md §9.1).
   *
   * Redis is not incidental here — it holds the JWKS cache, the rate-limit
   * counters and the queues. Without it, token validation falls back to
   * fetching JWKS per request and the rate limiter has nowhere to count.
   */
  readonly redis: boolean;
  /**
   * The commit this process was built from (P46-01).
   *
   * Read once at module construction, not per request: it cannot change while
   * the process lives, and a value re-read on a public endpoint's hot path is
   * a syscall per probe for an answer that is already known.
   *
   * `"unknown"` rather than omitted when `DS_COMMIT` is unset — a local
   * `pnpm dev` or a container started by hand. An absent field renders as an
   * old build in a footer; "unknown" says which question could not be
   * answered, which is a different fact (CLAUDE.md §9.4).
   */
  readonly commit: string;
  /**
   * The release number, which increases with every deploy of new work
   * (P47-01). Same reasoning as `commit` for the `"unknown"` fallback: this is
   * a fact about the deployment, not a knob, so an unset value must not be a
   * boot failure.
   */
  readonly version: string;
}

@Injectable()
export class HealthService {
  /**
   * Not from `AppConfig`. `DS_COMMIT` is a fact about the *image*, not a knob
   * anybody sets to change behaviour, and adding it to the validated schema
   * would make an unset value a boot failure — which is exactly wrong for the
   * one field whose job is to answer "I do not know".
   */
  private readonly commit = process.env["DS_COMMIT"] ?? "unknown";
  private readonly version = process.env["DS_VERSION"] ?? "unknown";

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async check(): Promise<HealthStatus> {
    /*
     * Both probed, and in parallel: this endpoint is polled by the deploy's
     * wait loop and by whatever watches the host, so two sequential round
     * trips would double the latency of the thing measuring latency.
     *
     * Each failure is caught separately. One shared `catch` would report a
     * dead Redis as a dead database, which sends whoever is reading this at
     * 22:00 to the wrong container.
     */
    const [database, redis] = await Promise.all([
      this.pool
        .query("SELECT 1")
        .then(() => true)
        .catch(() => false),
      this.redis
        .ping()
        .then(() => true)
        .catch(() => false),
    ]);

    return {
      // `degraded` if *either* is down. The endpoint's job is to answer "can
      // this process do its work", and it cannot do all of it without both.
      status: database && redis ? "ok" : "degraded",
      database,
      redis,
      commit: this.commit,
      version: this.version,
    };
  }
}
