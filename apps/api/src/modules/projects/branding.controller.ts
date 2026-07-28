/**
 * `GET /branding` (P10-05). Interface layer — ADR-0006.
 *
 * ## Why this one route is public
 *
 * The widget renders three states before it has a token — loading, session
 * expired, and "not correctly embedded" — and the admin console's login screen
 * has no token at all. Branding those requires reading a logo and two colours
 * without authenticating, so this route carries `@Public()`.
 *
 * That is a deliberate, narrow exception and it is the second one in the
 * system after `/health`. What it discloses is what the customer's own public
 * website already shows every visitor: a logo URL, two hex colours and a font
 * name. It returns no id, no Keycloak binding and no SMTP settings, even though
 * they live on the same row — see the migration for how that is enforced in
 * SQL rather than trusted here.
 *
 * ## An unknown slug is not a 404
 *
 * It returns empty branding with a 200, exactly as a known-but-unbranded
 * project does. ADR-0007's rule is that a project's existence is never
 * confirmed or denied, and a 404 here would be a project-slug oracle for the
 * price of one request.
 */

import { Controller, Get, Header, Headers, Inject } from "@nestjs/common";
import { parseBranding, type Branding } from "@ds/domain";
import { Public } from "../../auth/public.decorator.js";
import { PG_POOL } from "../../db/tokens.js";
import type { Pool } from "pg";
import { ProjectBrandingRepository } from "./project-binding.repository.js";

@Controller("branding")
export class BrandingController {
  private readonly repository: ProjectBrandingRepository;

  constructor(@Inject(PG_POOL) pool: Pool) {
    this.repository = new ProjectBrandingRepository(pool);
  }

  @Get()
  @Public()
  // Branding changes rarely and is identical for every visitor of a project,
  // so it is the one response in this API that a shared cache should hold.
  // Five minutes keeps a rebrand from needing a cache purge.
  @Header("cache-control", "public, max-age=300")
  async get(@Headers("x-ds-project") projectSlug?: string): Promise<Branding> {
    if (projectSlug === undefined || projectSlug === "") return {};

    // Validated on read, not only on write: a value written before a validation
    // rule tightened must not be able to reach a stylesheet.
    return parseBranding(await this.repository.resolve(projectSlug));
  }
}
