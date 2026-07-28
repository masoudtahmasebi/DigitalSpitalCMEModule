/**
 * Project binding lookup (P1-05). Infrastructure layer — ADR-0006.
 *
 * Runs on the raw pool, outside any tenant transaction, because resolving which
 * customer a request belongs to is a prerequisite for opening that transaction
 * — it cannot depend on RLS already being scoped. See
 * `db/migrations/0002_project_binding_lookup.sql` for why this is safe: the
 * function returns routing metadata only, never tenant data, and the resolved
 * customer id is not trusted until the caller's token validates against the
 * returned Keycloak issuer and audience.
 */

import type { Pool } from "pg";

export interface ProjectBinding {
  readonly projectId: string;
  readonly customerId: string;
  readonly keycloakIssuer: string;
  readonly keycloakAudience: string;
}

export interface ProjectBindingRepositoryPort {
  resolve(slug: string): Promise<ProjectBinding | undefined>;
}

interface BindingRow {
  project_id: string;
  customer_id: string;
  keycloak_issuer: string | null;
  keycloak_audience: string | null;
}

export class ProjectBindingRepository implements ProjectBindingRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async resolve(slug: string): Promise<ProjectBinding | undefined> {
    const result = await this.pool.query<BindingRow>(
      "SELECT * FROM resolve_project_binding($1)",
      [slug],
    );

    const row = result.rows[0];
    if (row === undefined) return undefined;

    // A project with no Keycloak binding configured cannot authenticate
    // anyone; treat it the same as "not found" rather than crashing on a null
    // issuer downstream.
    if (row.keycloak_issuer === null || row.keycloak_audience === null) {
      return undefined;
    }

    return {
      projectId: row.project_id,
      customerId: row.customer_id,
      keycloakIssuer: row.keycloak_issuer,
      keycloakAudience: row.keycloak_audience,
    };
  }
}
