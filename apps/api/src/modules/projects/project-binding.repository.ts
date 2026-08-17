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

/**
 * The OIDC coordinates a JWT-verifying provider needs.
 *
 * One object rather than two sibling fields because the pair is atomic: an
 * issuer without an audience verifies a signature and then accepts a token
 * minted for a different client, which is ADR-0003's whole point. Modelling
 * them separately made "half-configured" representable, and a half-configured
 * binding is a security hole rather than a smaller feature.
 */
export interface KeycloakBinding {
  readonly issuer: string;
  readonly audience: string;
}

export interface ProjectBinding {
  readonly projectId: string;
  readonly customerId: string;
  /** Which `IdentityProvider` verifies this project's learner tokens. */
  readonly identityProvider: string;
  /**
   * Present only when the project federates to an OIDC provider.
   *
   * Absent — not empty strings — for a `local` project (ADR-0012, P25-02),
   * which authenticates a password against our own tables and has no issuer by
   * design. This used to be two non-nullable `string` fields, and the seeds
   * satisfied that by writing `''` into two columns nothing ever read. The cost
   * of that placeholder was real: `resolve` below refused any project with a
   * NULL issuer, so a `local` project created through the console — which
   * writes NULL, not `''` — was unauthenticatable, while the seeded one worked.
   * Two rows meaning the same thing behaved differently depending on which code
   * path had written them.
   *
   * Optional here means a Keycloak-only field cannot be read without the reader
   * first proving the project is a Keycloak project, which the compiler now
   * enforces.
   */
  readonly keycloak?: KeycloakBinding;
}

/**
 * Which customer a project belongs to, and nothing else (P22-01).
 *
 * Deliberately not a `ProjectBinding` with the Keycloak fields made optional.
 * A caller holding this type *cannot* validate a token, because the type does
 * not carry what token validation needs — which is the property that keeps the
 * staff plane from accidentally growing a learner-plane code path.
 */
export interface ProjectTenant {
  readonly projectId: string;
  readonly customerId: string;
}

export interface ProjectBindingRepositoryPort {
  resolve(slug: string): Promise<ProjectBinding | undefined>;
  /**
   * For callers that authenticate without an identity provider — the staff
   * plane (ADR-0012).
   *
   * `resolve` answers `undefined` for a federating project whose binding is
   * incomplete, which is right for a learner and was wrong for an operator: it
   * made "this project has no Keycloak yet" refuse every tenant-scoped console
   * screen with a 401. A project created through the console has no binding
   * until somebody adds one, and a fresh installation has no project at all —
   * so the screens an operator needs in order to fix that were among the
   * screens refusing.
   */
  resolveTenant(slug: string): Promise<ProjectTenant | undefined>;
}

interface BindingRow {
  project_id: string;
  customer_id: string;
  keycloak_issuer: string | null;
  keycloak_audience: string | null;
  identity_provider: string;
}

/**
 * What an anonymous visitor to `/{tenant}` needs (P21-03).
 *
 * Deliberately carries no issuer. A public payload with one in it invites
 * somebody to build a second login flow out of it, which is the exact mistake
 * this whole ticket exists to undo — the portal used to redirect straight to
 * `login.medice.de`, a route MEDICE never asked for.
 */
export interface ProjectSignIn {
  readonly customerName: string;
  /**
   * The customer's own sign-in page, when they have one — MEDICE's WordPress
   * login, for instance. `undefined` means the portal's own participant
   * sign-in applies.
   */
  readonly loginUrl?: string;
}

export class ProjectSignInRepository {
  constructor(private readonly pool: Pool) {}

  async resolve(slug: string): Promise<ProjectSignIn | undefined> {
    const { rows } = await this.pool.query<{
      customer_name: string;
      login_url: string | null;
    }>("SELECT customer_name, login_url FROM resolve_project_signin($1)", [slug]);

    const row = rows[0];
    if (row === undefined) return undefined;
    return {
      customerName: row.customer_name,
      ...(row.login_url === null ? {} : { loginUrl: row.login_url }),
    };
  }
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

    // Empty string is treated as absent alongside NULL. Two of the seeds write
    // `''` into these columns for `local` projects — see `ProjectBinding` — and
    // an empty issuer reaching `jwtVerify` would be a required-claim comparison
    // against the empty string rather than the refusal it should be.
    const issuer = emptyAsUndefined(row.keycloak_issuer);
    const audience = emptyAsUndefined(row.keycloak_audience);
    const keycloak =
      issuer === undefined || audience === undefined ? undefined : { issuer, audience };

    // A project that federates its identity and has no binding yet cannot
    // authenticate anyone; treat it the same as "not found" rather than
    // crashing on a null issuer downstream.
    //
    // Only for a federating provider. A `local` project has no issuer *by
    // design*, and refusing it here is how a participant who had just signed in
    // successfully was answered `401 unknown or unbound project` on the very
    // next request.
    if (row.identity_provider !== "local" && keycloak === undefined) {
      return undefined;
    }

    return {
      projectId: row.project_id,
      customerId: row.customer_id,
      identityProvider: row.identity_provider,
      ...(keycloak === undefined ? {} : { keycloak }),
    };
  }

  async resolveTenant(slug: string): Promise<ProjectTenant | undefined> {
    // A different function, not this one with the Keycloak checks skipped —
    // `resolve_project_tenant` (migration 0026) returns two ids and no issuer,
    // so there is nothing here that could be mistaken for a binding.
    const result = await this.pool.query<{ project_id: string; customer_id: string }>(
      "SELECT * FROM resolve_project_tenant($1)",
      [slug],
    );

    const row = result.rows[0];
    if (row === undefined) return undefined;

    return { projectId: row.project_id, customerId: row.customer_id };
  }
}

/**
 * `NULL` and `''` both mean "not configured".
 *
 * Two spellings of absent exist in the data because the console writes NULL and
 * two seeds write `''`. Normalising here rather than backfilling the rows means
 * a seed written tomorrow cannot reintroduce the bug.
 */
function emptyAsUndefined(value: string | null): string | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * White-label branding for a project slug (P10-08).
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
export interface ProjectBrandingRow {
  /** The raw `branding` JSON. Validated by `parseBranding` in the service. */
  readonly branding: unknown;
  readonly fontFamilyName: string | null;
  readonly fontUpdatedAt: Date | null;
}

export interface ProjectBrandingRepositoryPort {
  resolve(slug: string): Promise<ProjectBrandingRow>;
}

/** The uploaded font file itself. */
export interface ProjectFontRow {
  readonly bytes: Buffer;
  readonly mime: string;
  readonly updatedAt: Date;
}

export interface ProjectFontRepositoryPort {
  resolve(slug: string): Promise<ProjectFontRow | undefined>;
}

export class ProjectBrandingRepository implements ProjectBrandingRepositoryPort {
  constructor(private readonly pool: Pool) {}

  /**
   * Returns raw values. Validation is `parseBranding` in `@ds/domain` —
   * a repository returns rows, and what counts as a valid colour is a rule.
   */
  async resolve(slug: string): Promise<ProjectBrandingRow> {
    const result = await this.pool.query<{
      branding: unknown;
      font_family_name: string | null;
      font_updated_at: Date | null;
    }>("SELECT * FROM resolve_project_branding($1)", [slug]);

    const row = result.rows[0];
    return {
      branding: row?.branding ?? {},
      fontFamilyName: row?.font_family_name ?? null,
      fontUpdatedAt: row?.font_updated_at ?? null,
    };
  }

  /**
   * The customer's wording overrides, pre-auth (P83-02).
   *
   * Through `resolve_project_copy` for the same reason `resolve` goes through
   * `resolve_project_branding`: the widget renders worded states before it has
   * a token, so this has to be readable without a tenant context, and the
   * SECURITY DEFINER function with its column grant is what bounds exactly
   * what "without a tenant context" may see.
   *
   * Returns the raw value. `parseCopyOverrides` in `@ds/domain` decides what is
   * acceptable — a repository returns rows, and which keys still exist is a
   * rule.
   */
  async resolveCopy(slug: string): Promise<unknown> {
    const result = await this.pool.query<{ copy_overrides: unknown }>(
      "SELECT * FROM resolve_project_copy($1)",
      [slug],
    );
    return result.rows[0]?.copy_overrides ?? {};
  }
}

/**
 * The uploaded webfont's bytes (P10-08).
 *
 * Its own repository and its own SQL function so the branding lookup — called
 * on every widget render — never drags a megabyte of font through it.
 */
export class ProjectFontRepository implements ProjectFontRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async resolve(slug: string): Promise<ProjectFontRow | undefined> {
    const result = await this.pool.query<{
      font_file: Buffer;
      font_mime: string;
      font_updated_at: Date;
    }>("SELECT * FROM resolve_project_font($1)", [slug]);

    const row = result.rows[0];
    if (row === undefined) return undefined;

    return { bytes: row.font_file, mime: row.font_mime, updatedAt: row.font_updated_at };
  }
}
