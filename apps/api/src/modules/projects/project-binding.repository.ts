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

/**
 * White-label branding for a project slug (P10-05).
 *
 * Separate from `ProjectBindingRepository` because it answers a different
 * question for a different caller: this one runs for an **unauthenticated**
 * request, since the widget renders branded loading and error states before it
 * has a token.
 *
 * Also on the raw pool, via its own SECURITY DEFINER function — see
 * `db/migrations/0007_project_branding_lookup.sql` for why it is not folded
 * into `resolve_project_binding`.
 */
export interface ProjectBrandingRepositoryPort {
  resolve(slug: string): Promise<unknown>;
}

export class ProjectBrandingRepository implements ProjectBrandingRepositoryPort {
  constructor(private readonly pool: Pool) {}

  /**
   * Returns the raw JSON. Validation is `parseBranding` in `@ds/domain` —
   * a repository returns rows, and what counts as a valid colour is a rule.
   */
  async resolve(slug: string): Promise<unknown> {
    const result = await this.pool.query<{ branding: unknown }>(
      "SELECT * FROM resolve_project_branding($1)",
      [slug],
    );
    return result.rows[0]?.branding ?? {};
  }
}
