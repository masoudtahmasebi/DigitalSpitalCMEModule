/**
 * The catalogue, for a visitor who has signed in with DocCheck (P213-01).
 *
 * ## What this is, in the client's words
 *
 * > when the user logs in with doccheck they are able to see the course list,
 * > and they can see course descriptions, but if they want to participate, they
 * > will get a popup, that for this feature you have to login with medice login
 *
 * A DocCheck login identifies somebody as a healthcare professional to the
 * *website*. It **cannot produce a platform token** — the WordPress plugin has
 * said so since P96, and a CME point cannot be awarded to somebody the
 * accreditation chain cannot name. So this route serves the two things a
 * visitor may see without one, and nothing else.
 *
 * ## The three things that make this safe, none of which is in this file
 *
 * 1. **Whether the project opted in** is `resolve_catalogue_preview` (migration
 *    0055): a SECURITY DEFINER function owned by the BYPASSRLS resolver role,
 *    with a three-column grant, whose predicate is `doccheck_login_allowed`. A
 *    project that has not opted in yields no row and is therefore
 *    indistinguishable from one that does not exist (ADR-0007, §9.5).
 *
 * 2. **Which courses are visible** is the ordinary catalogue query, run inside
 *    `runInTenant` with the customer that function returned. RLS applies
 *    exactly as it does for a signed-in learner, and the published/validity
 *    rules are the same code — there is no second implementation of "what is in
 *    the catalogue" to drift (§9.10b, §4 invariant 6).
 *
 * 3. **What a preview reader may do** is bounded by there being no user. Not by
 *    a filter somebody has to remember: the user id is `undefined`, so
 *    `CatalogService` does not run the enrolment query at all, and every route
 *    that advances a Fortbildung lives on `LearningController`,
 *    `AssessmentController`, `CompletionController` or `CertificateController`
 *    — all of which require a principal and are untouched by this file.
 *
 * ## Why it is a separate controller rather than `@Public()` on the real one
 *
 * `@Public()` makes the auth guard skip the route **entirely**, so a signed-in
 * learner's token would be ignored and their enrolment state would vanish from
 * their own catalogue. The two audiences need different answers from the same
 * data, which is two routes over one service — not one route with a weaker
 * guard.
 */

import { Controller, Get, Headers, Inject, Param, Query } from "@nestjs/common";
import type { Pool } from "pg";
import { Public } from "../../auth/public.decorator.js";
import { RateLimit } from "../../shared/rate-limit.guard.js";
import { AppError } from "../../shared/problem-details.js";
import { APP_CONFIG, PG_POOL } from "../../db/tokens.js";
import type { AppConfig } from "../../config/config.js";
import { runInTenant } from "../../db/tenant-db.js";
import { mediaResolverFor } from "../../shared/media-url.factory.js";
import type { MediaResolver } from "../../shared/media-url.js";
import { CatalogService } from "./catalog.service.js";
import { courseListQuerySchema } from "./catalog.dto.js";

/**
 * The project this request is about, from the same header every other route
 * uses. A missing one is a page-integration mistake, not a learner problem.
 */
const PROJECT_HEADER = "x-ds-project";

/**
 * Nobody is asking on their own behalf.
 *
 * `undefined`, and the first attempt was an empty string — which is worse than
 * wrong. `enrolments.user_id` is a `uuid`, so `''` does not quietly match
 * nothing: Postgres rejects it and the request 500s. `CatalogService` skips the
 * enrolment query entirely for `undefined`, which is the only honest reading of
 * "this reader has no account".
 */
const NO_USER = undefined;

@Controller("preview")
export class CataloguePreviewController {
  private readonly media: MediaResolver;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.media = mediaResolverFor(config);
  }

  @Get("courses")
  @Public()
  @RateLimit("cataloguePreview")
  async list(
    @Query() query: Record<string, unknown>,
    @Headers(PROJECT_HEADER) projectSlug: string | undefined,
  ) {
    const parsed = courseListQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new AppError(
        "validation",
        `invalid course list query: ${parsed.error.message}`,
        "One or more query parameters are invalid.",
      );
    }

    return this.inPreview(projectSlug, async (service) =>
      service.listCourses(parsed.data, NO_USER),
    );
  }

  @Get("courses/:slug")
  @Public()
  @RateLimit("cataloguePreview")
  async detail(
    @Param("slug") slug: string,
    @Headers(PROJECT_HEADER) projectSlug: string | undefined,
  ) {
    return this.inPreview(projectSlug, async (service) =>
      service.getCourseBySlug(slug, NO_USER),
    );
  }

  /**
   * Resolve the project, or refuse in a way that says nothing.
   *
   * The refusal is the same for "no such project", "that project does not
   * permit DocCheck" and "you sent no header". Telling them apart would make
   * this route a project-slug oracle for the price of one request, which is
   * ADR-0007's rule and the reason `GET /branding` answers 200 with empty
   * branding for a slug that does not exist.
   */
  private async inPreview<T>(
    projectSlug: string | undefined,
    work: (service: CatalogService) => Promise<T>,
  ): Promise<T> {
    const slug = (projectSlug ?? "").trim();
    const customerId = slug === "" ? undefined : await this.customerFor(slug);

    if (customerId === undefined) {
      throw new AppError(
        "not_found",
        `no catalogue preview for project slug=${slug}`,
        "Diese Fortbildungsübersicht ist nicht verfügbar.",
      );
    }

    /*
     * `learner`, not a new role. The preview reads exactly what a learner's
     * catalogue reads, and inventing a role would mean a row in the policy
     * matrix that nothing else understands — and one somebody would later
     * widen. There is no user attached to it, which is what makes it a
     * preview.
     */
    return runInTenant(this.pool, { customerId, role: "learner" }, async (db) =>
      work(CatalogService.fromDb(db, this.media)),
    );
  }

  private async customerFor(slug: string): Promise<string | undefined> {
    const { rows } = await this.pool.query<{ customer_id: string }>(
      "SELECT * FROM resolve_catalogue_preview($1)",
      [slug],
    );
    return rows[0]?.customer_id;
  }
}
