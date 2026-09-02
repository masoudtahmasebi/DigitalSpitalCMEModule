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
import type { Pool } from "pg";
import type { AppConfig } from "./config/config.js";
import { PG_POOL } from "./db/tokens.js";
import { EmbedOriginRegistry, ProjectOriginSource } from "./shared/embed-origins.js";

/**
 * `cors`' own callback shape, written out rather than imported.
 *
 * `@nestjs/common`'s `CorsOptions` types this as `any`, so annotating from it
 * would reintroduce the `any` this exists to avoid. Two parameters, and the
 * error one is always `null` here — see the handler for why a refused origin
 * must not be an error.
 */
type CorsCallback = (error: Error | null, allow?: boolean) => void;

/**
 * The headers a client uses to name the tenant it is acting within.
 *
 * Exported so the CORS allow-list and the guard cannot disagree about them —
 * a header the guard reads but CORS refuses never arrives, and the failure is
 * a browser preflight error with nothing on the server side to see (P22-06).
 */
export const TENANT_HEADERS = ["x-ds-project", "x-ds-customer"] as const;

/**
 * Headers the guard reads that do not name a tenant (P105-01).
 *
 * `x-ds-profile` carries the host page's name and email for a realm whose token
 * has none. It belongs in the CORS allow-list for exactly the reason
 * `TENANT_HEADERS` does — a header the guard reads and the preflight refuses
 * never arrives, and the only evidence is a message in somebody else's browser
 * — but it is not a tenant header, and putting it in that list would make the
 * name a lie the next time somebody reads it.
 */
export const GUARD_HEADERS = ["x-ds-profile"] as const;

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
  /*
   * The origin decision is a **function**, not a list, since P18-04.
   *
   * `ALLOWED_ORIGINS` still carries this installation's own two browser
   * origins — the console and the portal, derived from `BASE_DOMAIN` at deploy
   * time — because a deployment whose own console could not reach its own API
   * would be broken in a way no customer configuration should be able to
   * cause. Everything else comes from `projects.embed_origins`.
   *
   * `EmbedOriginRegistry` answers synchronously from a 60-second cache; see
   * its header for why an `await` here would be wrong and why a database error
   * keeps the previous set rather than emptying it.
   */
  const origins = new EmbedOriginRegistry(
    new ProjectOriginSource(app.get<Pool>(PG_POOL)),
    config.ALLOWED_ORIGINS,
  );
  // So the first preflight after a deploy is not a cache miss that answers
  // "no" while the load is still in flight.
  await origins.warm();

  app.enableCors({
    origin: (origin: string | undefined, callback: CorsCallback) => {
      // No `Origin` header at all: a same-origin request, curl, or a
      // server-to-server call. Not a CORS decision to make — the browser is
      // what enforces this, and something that sent no origin is not a browser
      // acting on a page's behalf.
      if (origin === undefined || origin === "") {
        callback(null, true);
        return;
      }
      // `false`, never a thrown error: `cors` turns a thrown error into a 500,
      // and a refused origin is a perfectly ordinary outcome that should not
      // page anybody.
      callback(null, origins.isAllowed(origin));
    },
    credentials: true,
    // Every header the browser is allowed to send on a cross-origin request.
    //
    // This list is easy to forget and impossible to notice from the server: a
    // header missing here is refused by the *browser*, in the preflight, so
    // nothing reaches the API and no log records it. `x-ds-customer` was added
    // to the client and not here, and the console failed with
    //
    //   Request header field x-ds-customer is not allowed by
    //   Access-Control-Allow-Headers in preflight response
    //
    // which is a browser message, not ours. `TENANT_HEADERS` below is checked
    // against this list by a test, so a future header cannot be added to one
    // and not the other (P22-06).
    allowedHeaders: [
      "authorization",
      "content-type",
      "accept",
      ...TENANT_HEADERS,
      ...GUARD_HEADERS,
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
