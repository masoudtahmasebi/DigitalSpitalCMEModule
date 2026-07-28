/**
 * Bootstrap. Kept deliberately thin: everything with a decision behind it
 * (auth, tenancy, error shape) lives in `AppModule` and its imports, so this
 * file is transport/process concerns only.
 */

import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import helmet from "helmet";
import { AppModule } from "./app.module.js";
import { loadConfig } from "./config/config.js";

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const logger = new Logger("Bootstrap");

  const app = await NestFactory.create(AppModule, {
    bodyParser: false, // configured explicitly below with an explicit size limit
  });

  app.use(helmet());
  // A wildcard here would defeat the point of restricting who may call the
  // API — ADR-0007 keeps the API host-ignorant, but "ignorant of which host"
  // is not the same as "reachable by any origin".
  app.enableCors({
    origin: config.ALLOWED_ORIGINS.length > 0 ? config.ALLOWED_ORIGINS : false,
    credentials: false,
  });

  const { json } = await import("express");
  app.use(json({ limit: config.MAX_REQUEST_BODY_SIZE }));

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
