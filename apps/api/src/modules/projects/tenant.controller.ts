/**
 * `GET /tenants/{slug}` (P21-03). Interface layer — ADR-0006.
 *
 * ## Why this route is public
 *
 * The portal renders `/medice` for somebody who has not signed in and cannot,
 * until it knows *where* MEDICE's learners sign in. That question has to be
 * answerable without a token, for the same reason `/branding` is: the page has
 * to exist before the login does.
 *
 * ## Why it exists at all
 *
 * The portal used to decide this for itself. `PORTAL_PROJECT_SLUG` in the
 * deployment named one customer, and the sign-in button ran an OIDC
 * authorization-code redirect against that customer's Keycloak — which for
 * MEDICE meant dropping a visitor on `login.medice.de` with no way back, using
 * a flow MEDICE does not use. Their WordPress plugin signs learners in from a
 * form on their own site.
 *
 * So the answer moves to where it is configured — the project row — and the
 * portal links rather than deciding.
 *
 * ## What it discloses, and what it must not
 *
 * A display name and a link, both of which the customer publishes on their own
 * website. No id, no Keycloak issuer, no audience: see
 * `resolve_project_signin` in migration 0028 for why the issuer is absent
 * rather than merely unused.
 *
 * An unknown slug is a **200 with an empty body**, not a 404 — the same rule
 * `/branding` follows. A 404 here would be a project-slug oracle for the price
 * of one unauthenticated request (ADR-0007).
 */

import { Controller, Get, Header, Inject, Param } from "@nestjs/common";
import type { Pool } from "pg";
import { Public } from "../../auth/public.decorator.js";
import { PG_POOL } from "../../db/tokens.js";
import { ProjectSignInRepository } from "./project-binding.repository.js";

/**
 * How a learner signs in to this tenant.
 *
 * A tagged union rather than an optional URL, because the portal renders three
 * genuinely different things and a missing field would make "we do not know"
 * and "sign in here" the same value.
 */
export type TenantSignIn =
  /** The slug named no project we hold. Rendered as "unknown tenant". */
  | { readonly kind: "unknown" }
  /** The customer signs learners in on their own site. */
  | { readonly kind: "external"; readonly customerName: string; readonly url: string }
  /** Our own participant sign-in applies (P21-02). */
  | { readonly kind: "portal"; readonly customerName: string };

@Controller("tenants")
export class TenantController {
  private readonly signIn: ProjectSignInRepository;

  constructor(@Inject(PG_POOL) pool: Pool) {
    this.signIn = new ProjectSignInRepository(pool);
  }

  @Get(":slug")
  @Public()
  // Changes about as often as branding does and is identical for every visitor,
  // so it is cacheable on the same terms. Five minutes keeps a customer moving
  // their login page from needing a purge.
  @Header("cache-control", "public, max-age=300")
  async get(@Param("slug") slug: string): Promise<TenantSignIn> {
    const row = await this.signIn.resolve(slug);
    if (row === undefined) return { kind: "unknown" };

    return row.loginUrl === undefined
      ? { kind: "portal", customerName: row.customerName }
      : { kind: "external", customerName: row.customerName, url: row.loginUrl };
  }
}
