/**
 * `GET /branding` and `GET /branding/font` (P10-08). Interface layer.
 *
 * ## Why these two routes are public
 *
 * The widget renders three states before it has a token — loading, session
 * expired, and "not correctly embedded" — and the admin console's login screen
 * has no token at all. Branding those requires reading a logo, two colours and
 * a font without authenticating.
 *
 * That is a deliberate, narrow exception and these are the second and third
 * public routes after `/health`. What they disclose is what the customer's own
 * public website already shows every visitor. They return no id, no Keycloak
 * binding and no SMTP settings, even though those live on the same row — see
 * migrations 0007 and 0008 for how that is enforced in SQL rather than trusted
 * here.
 *
 * ## An unknown slug is not a 404
 *
 * `GET /branding` returns empty branding with a 200, exactly as a
 * known-but-unbranded project does. ADR-0007's rule is that a project's
 * existence is never confirmed or denied, and a 404 here would be a
 * project-slug oracle for the price of one request. The font route does 404,
 * because "there is no font" and "there is no project" are the same answer and
 * a font is not evidence of anything.
 */

import {
  Controller,
  Get,
  Header,
  Headers,
  Inject,
  NotFoundException,
  Query,
  StreamableFile,
} from "@nestjs/common";
import { parseBranding, parseCopyOverrides, type Branding } from "@ds/domain";
import { COPY_KEYS } from "@ds/copy";
import { Public } from "../../auth/public.decorator.js";
import { PG_POOL } from "../../db/tokens.js";
import type { Pool } from "pg";
import {
  ProjectBrandingRepository,
  ProjectFontRepository,
} from "./project-binding.repository.js";

@Controller("branding")
export class BrandingController {
  private readonly branding: ProjectBrandingRepository;
  private readonly fonts: ProjectFontRepository;

  constructor(@Inject(PG_POOL) pool: Pool) {
    this.branding = new ProjectBrandingRepository(pool);
    this.fonts = new ProjectFontRepository(pool);
  }

  @Get()
  @Public()
  // Branding changes rarely and is identical for every visitor of a project,
  // so it is the one JSON response in this API a shared cache should hold.
  // Five minutes keeps a rebrand from needing a cache purge.
  @Header("cache-control", "public, max-age=300")
  async get(@Headers("x-ds-project") projectSlug?: string): Promise<Branding> {
    if (projectSlug === undefined || projectSlug === "") return {};

    const row = await this.branding.resolve(projectSlug);

    // Validated on read, not only on write: a value written before a
    // validation rule tightened must not be able to reach a stylesheet.
    return parseBranding({
      ...(typeof row.branding === "object" && row.branding !== null ? row.branding : {}),
      // The font is not part of the stored JSON — it is columns, set by the
      // upload endpoint — so it is merged in here rather than trusted from a
      // blob a client could once have written.
      ...(row.fontFamilyName === null || row.fontUpdatedAt === null
        ? {}
        : {
            fontFamilyName: row.fontFamilyName,
            fontVersion: row.fontUpdatedAt.toISOString(),
          }),
    });
  }

  /**
   * The customer's own words for the learner's screens (P83-02).
   *
   * Its own route rather than a field on `GET /branding`, because the two are
   * different questions: `Branding` is a typed object whose fields become CSS
   * variables and each has a grammar, and this is an open map of dotted locale
   * keys to text. Merging them would give one response two grammars and one
   * parser two jobs.
   *
   * Public and cached the same way, for the same reason: it is identical for
   * every visitor of a project and changes rarely. Five minutes keeps a
   * reworded button from needing a cache purge.
   *
   * **Validated on read, not only on write.** `parseCopyOverrides` drops any
   * key that is no longer in `COPY_KEYS` and any value that is no longer
   * acceptable, so a setting stored before a rule tightened — or before a
   * screen was renamed away — cannot reach a learner. The write path refuses
   * those and tells the operator; this one simply does not serve them, because
   * a learner's page must render whatever is stored.
   */
  @Get("copy")
  @Public()
  @Header("cache-control", "public, max-age=300")
  async copy(
    @Headers("x-ds-project") projectSlug?: string,
  ): Promise<Record<string, string>> {
    if (projectSlug === undefined || projectSlug === "") return {};
    const stored = await this.branding.resolveCopy(projectSlug);
    return { ...parseCopyOverrides(stored, COPY_KEYS) };
  }

  /**
   * The uploaded font file.
   *
   * **This route existing is the GDPR position.** A customer's typeface is
   * served from our own origin, so a learner's browser never contacts a font
   * CDN, no IP address reaches a third party, and there is nothing here for a
   * consent banner or a processing record to cover.
   *
   * ## Why the slug may come from the query string
   *
   * This is the one route in the API that a **browser** requests on its own
   * behalf, from an `@font-face` rule. There is no hook to add `X-DS-Project`
   * to that request — a font is fetched by the CSS engine, not by our code. So
   * `?project=` is accepted as well, and the header still wins when both are
   * present. It discloses nothing the caller did not already have to know.
   *
   * Cached for a year and immutable: the widget appends `?v=<font_updated_at>`,
   * so replacing a font changes the URL. Without the version parameter this
   * would have to be `no-cache`, and a font is the one asset where that is
   * genuinely wasteful.
   */
  @Get("font")
  @Public()
  @Header("cache-control", "public, max-age=31536000, immutable")
  // The widget fetches this from a shadow root on the customer's own origin,
  // so it is cross-origin by definition — and a font requested by `@font-face`
  // is always sent in CORS-anonymous mode, meaning it is dropped without these
  // headers even though it carries no credentials. It reveals nothing beyond
  // the customer's own brand.
  @Header("access-control-allow-origin", "*")
  @Header("cross-origin-resource-policy", "cross-origin")
  @Header("x-content-type-options", "nosniff")
  async font(
    @Headers("x-ds-project") headerSlug?: string,
    @Query("project") querySlug?: string,
  ): Promise<StreamableFile> {
    const projectSlug =
      headerSlug !== undefined && headerSlug !== "" ? headerSlug : querySlug;

    if (projectSlug === undefined || projectSlug === "") {
      throw new NotFoundException();
    }

    const font = await this.fonts.resolve(projectSlug);
    if (font === undefined) throw new NotFoundException();

    // A fresh copy: `pg` returns pooled Buffers for bytea, and a pooled buffer
    // handed to a stream can be recycled underneath it. The same hazard the
    // certificate renderer hit with pdf-lib.
    return new StreamableFile(Uint8Array.from(font.bytes), { type: font.mime });
  }
}
