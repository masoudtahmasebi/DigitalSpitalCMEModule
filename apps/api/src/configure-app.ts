/**
 * The HTTP middleware every instance of this API must have.
 *
 * ## Why this is a function and not four lines in `main.ts`
 *
 * It used to be four lines in `main.ts`, and the integration suite built its
 * app with a bare `NestFactory.create(AppModule)` — so the thing under test had
 * no helmet, no CORS policy, and Express's default 100 KB body limit instead of
 * the configured one. Every assertion in that suite was made against an app
 * shaped differently from the one that ships.
 *
 * That is how the font-upload body limit got through: the column allows a 2 MB
 * file, base64 inflates it to ~2.8 MB, the global limit was 1 MB, and no test
 * noticed because a test font is 64 bytes. The parser would have refused a real
 * unsubsetted family with an opaque 413 — before any of the validation that
 * produces a readable German message ran.
 *
 * So the configuration lives here and both callers use it. A test that boots
 * the app differently from production is testing a different application.
 */

import helmet from "helmet";
import type { INestApplication } from "@nestjs/common";
import type { AppConfig } from "./config/config.js";

export async function configureApp(
  app: INestApplication,
  config: AppConfig,
): Promise<void> {
  // One proxy in front: Caddy, which sets X-Real-IP and X-Forwarded-Proto
  // (infra/deploy/Caddyfile). Without this, `request.ip` is Caddy's address
  // for every caller — so the rate limiter's IP fallback would be one shared
  // bucket, and `request.protocol` would read `http` behind TLS.
  //
  // The number matters: `true` would trust the whole X-Forwarded-For chain,
  // including hops a client wrote itself. `1` trusts exactly the one proxy
  // that is actually there.
  const http = app.getHttpAdapter().getInstance() as {
    set?: (key: string, value: unknown) => void;
  };
  http.set?.("trust proxy", 1);

  app.use(helmet());

  /*
   * A wildcard here would defeat the point of restricting who may call the
   * API — ADR-0007 keeps the API host-ignorant, but "ignorant of which host"
   * is not the same as "reachable by any origin".
   *
   * ## Why credentials are now allowed
   *
   * The admin console authenticates with an httpOnly session cookie
   * (ADR-0012), and it is served from a different origin than the API —
   * `verwaltung.…` and `api.…` are the same *site* but not the same origin.
   * With `credentials: false` the browser neither stores the cookie the login
   * response sets nor attaches it to anything afterwards, so the console
   * cannot work at all.
   *
   * This is safe **only because the origin list is an explicit allowlist**.
   * `Access-Control-Allow-Credentials: true` with a wildcard origin is
   * forbidden by the fetch specification precisely because it would let any
   * page on the web make authenticated requests; the two settings are only
   * ever correct together in this direction. An empty `ALLOWED_ORIGINS`
   * resolves to `false` — no origin, rather than every origin — so a
   * misconfigured deployment fails closed.
   *
   * CORS is not the CSRF defence either way: `SameSite=Lax` plus the
   * double-submit token in `X-DS-CSRF` is (see `staff-auth.controller.ts`),
   * which is why that header has to be allowed through the preflight.
   */
  app.enableCors({
    origin: config.ALLOWED_ORIGINS.length > 0 ? config.ALLOWED_ORIGINS : false,
    credentials: true,
    allowedHeaders: [
      "authorization",
      "content-type",
      "accept",
      "x-ds-project",
      "x-ds-csrf",
    ],
  });

  const { json } = await import("express");

  // The font upload is the one route whose legitimate body is measured in
  // megabytes. Scoped rather than global: the reason there is a body limit at
  // all is that a JSON parser is a denial-of-service surface, and raising it
  // everywhere to accommodate one endpoint gives that up. The specific mount
  // has to come first — Express runs middleware in registration order.
  app.use("/admin/branding/font", json({ limit: config.MAX_FONT_BODY_SIZE }));
  app.use(json({ limit: config.MAX_REQUEST_BODY_SIZE }));
}
