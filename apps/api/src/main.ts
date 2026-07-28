/**
 * Bootstrap. Kept deliberately thin: everything with a decision behind it
 * (auth, tenancy, error shape) lives in `AppModule` and its imports, and the
 * HTTP middleware lives in `configure-app.ts` so the integration suite boots
 * the same application this does. What is left here is process concerns.
 */

import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { AppModule } from "./app.module.js";
import { configureApp } from "./configure-app.js";
import { loadConfig } from "./config/config.js";

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const logger = new Logger("Bootstrap");

  const app = await NestFactory.create(AppModule, {
    // Configured explicitly in `configureApp`, with explicit size limits.
    bodyParser: false,
  });

  await configureApp(app, config);

  app.enableShutdownHooks();

  await app.listen(config.API_PORT);
  logger.log(`DS Education API listening on :${config.API_PORT} (${config.NODE_ENV})`);
}

bootstrap().catch((error: unknown) => {
  // no-console is a warning, not an error, here: process is exiting and
  // Nest's own logger is not guaranteed to have flushed.
  console.error("Fatal error during bootstrap:", error);
  process.exitCode = 1;
});
