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
  app.use(helmet());

  // A wildcard here would defeat the point of restricting who may call the
  // API — ADR-0007 keeps the API host-ignorant, but "ignorant of which host"
  // is not the same as "reachable by any origin".
  app.enableCors({
    origin: config.ALLOWED_ORIGINS.length > 0 ? config.ALLOWED_ORIGINS : false,
    credentials: false,
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
