/**
 * `GET /media/:id` — a stable, public URL for an image (P212-01).
 *
 * ## What it is for
 *
 * Media is addressed internally by `s3://<key>` and handed to a browser as a
 * presigned URL that expires after `S3_URL_TTL_SEC` — 3600 s by default. That
 * is the right shape for a lecture video: the signature **is** the
 * authorisation, and a signature is the only kind that can travel on an `<img>`
 * or a `<video>` request, because neither can carry an Authorization header.
 *
 * It is the wrong shape for a course's Titelbild and a Referent's photograph.
 * The client wants to paste that URL into WordPress and have it keep working,
 * and it is a URL a physician's browser re-fetches on a page that may have been
 * open for a day. So the id is the stable part of the address and the signature
 * is minted per request, behind it.
 *
 * The client's own description, which is exactly what this does:
 *
 * > you give aaaa.com/imageurl.jpg -> our system generates the public url and
 * > gives it back to the browser
 *
 * ## Why it is `@Public()`, stated plainly
 *
 * There is no token on this request and there cannot be one: an `<img>` sends
 * no Authorization header, and the URL is meant to be pasted onto a page seen
 * by people with no account at all. So the protection is that the id is an
 * unguessable uuid, and **that is only acceptable because of what it may
 * serve.**
 *
 * A course cover and a speaker photograph are marketing images on a catalogue
 * page. A lecture video is gated content whose watch percentage decides a CME
 * point, and an unguessable id is not that gate. The images-only rule is
 * therefore in `resolve_public_image` (migration 0054) rather than here: the
 * predicate is `mime_type LIKE 'image/%'`, the function is SECURITY DEFINER
 * with a three-column grant, and widening it takes a migration in a diff.
 *
 * A controller check would have been one line and could be edited by anybody
 * in a hurry. This one cannot serve a video even if this file is wrong.
 *
 * ## 302 rather than proxying the bytes
 *
 * A redirect costs one small response; proxying would put every course cover on
 * the API's event loop and through its egress. The redirect is `Cache-Control:
 * no-store` because the *location* it points at expires, while the URL the
 * browser holds does not — caching the redirect would hand somebody a stale
 * signature and a broken image, which is the failure this route exists to
 * remove.
 */

import { Controller, Get, Inject, NotFoundException, Param, Res } from "@nestjs/common";
import type { Response } from "express";
import type { Pool } from "pg";
import { Public } from "../../auth/public.decorator.js";
import { RateLimit } from "../../shared/rate-limit.guard.js";
import { PG_POOL, APP_CONFIG } from "../../db/tokens.js";
import type { AppConfig } from "../../config/config.js";
import { mediaResolverFor } from "../../shared/media-url.factory.js";
import type { MediaResolver } from "../../shared/media-url.js";

/** A uuid, checked here so a malformed id is a 404 rather than a 500 from `pg`. */
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

@Controller("media")
export class PublicMediaController {
  private readonly media: MediaResolver;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.media = mediaResolverFor(config);
  }

  /**
   * `:id` carries an optional extension — `…/media/<uuid>.jpg` — which is
   * ignored. It exists because a URL pasted into a CMS, a mail client or a
   * social preview is treated differently when it looks like an image, and
   * because the client asked for a URL shaped like `imageurl.jpg`. The id is
   * the whole address; the suffix is cosmetic and is not trusted for anything.
   */
  @Get(":id")
  @Public()
  @RateLimit("mediaPublic")
  async image(@Param("id") id: string, @Res() response: Response): Promise<void> {
    const uuid = id.split(".")[0] ?? "";
    if (!UUID.test(uuid)) throw new NotFoundException();

    const { rows } = await this.pool.query<{
      storage_key: string;
      mime_type: string | null;
    }>("SELECT * FROM resolve_public_image($1)", [uuid]);

    const row = rows[0];
    if (row === undefined) throw new NotFoundException();

    /*
     * The customer id comes from the key itself, which is what the key's first
     * segment is. That is not a weakening: the resolver's tenant check exists
     * to catch a *row* pointing at another tenant's object, and here the row
     * and the key are the same fact — there is no second opinion to compare it
     * against, because there is no caller with a tenant.
     *
     * What bounds this request is the function's predicate, not a tenant.
     */
    const customerId = row.storage_key.replace(/^s3:\/\//u, "").split("/")[0] ?? "";
    const signed = this.media.resolve(row.storage_key, customerId, new Date());
    if (signed === null) throw new NotFoundException();

    // The signature expires; this URL does not. Caching the redirect would
    // hand a browser a stale location and a broken image.
    response.setHeader("Cache-Control", "no-store");
    response.redirect(302, signed);
  }
}
