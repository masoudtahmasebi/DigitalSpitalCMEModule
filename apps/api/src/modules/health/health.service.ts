/**
 * Health check use case. Application layer — ADR-0006.
 *
 * Kept separate from the controller so the controller stays free of any
 * database import, consistent with every other feature in this codebase.
 */

import { Injectable, Inject } from "@nestjs/common";
import type { Pool } from "pg";
import { PG_POOL } from "../../db/tokens.js";

export interface HealthStatus {
  readonly status: "ok" | "degraded";
  readonly database: boolean;
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

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async check(): Promise<HealthStatus> {
    const database = await this.pool
      .query("SELECT 1")
      .then(() => true)
      .catch(() => false);

    return {
      status: database ? "ok" : "degraded",
      database,
      commit: this.commit,
      version: this.version,
    };
  }
}
