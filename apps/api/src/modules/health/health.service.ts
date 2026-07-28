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
}

@Injectable()
export class HealthService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async check(): Promise<HealthStatus> {
    const database = await this.pool
      .query("SELECT 1")
      .then(() => true)
      .catch(() => false);

    return { status: database ? "ok" : "degraded", database };
  }
}
