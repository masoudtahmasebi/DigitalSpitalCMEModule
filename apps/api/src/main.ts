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
import { installPlugins } from "./plugins.js";
import { JsonLogger } from "./observability/logger.js";

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const logger = new Logger("Bootstrap");

  // Before the application, not after: the EIV scheduler resolves its
  // accreditation reporter in its constructor, which runs during module
  // initialisation (ADR-0010).
  installPlugins(logger);

  const app = await NestFactory.create(AppModule, {
    // Configured explicitly in `configureApp`, with explicit size limits.
    bodyParser: false,
    // Buffered until `useLogger` below, so the framework's own startup lines
    // are written in the same JSON shape as everything else rather than in
    // Nest's coloured prose. Without this the first fifty lines of every boot
    // are unparseable, which is exactly the window a failed start lives in.
    bufferLogs: true,
  });

  // The **same instance** the request middleware and the error filter use, not
  // a second one (P25-01). Two JsonLoggers would both write correct JSON and
  // would be two objects to configure, so a level change applied to one would
  // silently not apply to the other.
  app.useLogger(app.get(JsonLogger));

  await configureApp(app, config);

  app.enableShutdownHooks();

  await app.listen(config.API_PORT);
  logger.log(`DS Education API listening on :${config.API_PORT} (${config.NODE_ENV})`);
}

bootstrap().catch((error: unknown) => {
  // no-console is a warning, not an error, here: process is exiting and
  // Nest's own logger is not guaranteed to have flushed.
  console.error("Fatal error during bootstrap:", error);

  /*
   * `process.exitCode` alone is not enough here, and the difference matters.
   *
   * It takes effect only when the event loop drains — and by the time a
   * bootstrap failure is thrown, the Postgres pool and the Redis client are
   * already open and keeping the loop alive forever. The process would sit
   * there having logged a fatal error, never exiting and never listening,
   * which to an orchestrator is indistinguishable from a slow start rather
   * than the crash it is. A rolling deploy would wait on it instead of
   * rolling back.
   *
   * So: set the code for the case where the loop *does* drain, and force the
   * exit shortly after for the case where it does not. The timer is `unref`ed
   * so it never delays an otherwise-clean exit, and the delay gives `stderr` —
   * asynchronous when it is a pipe — a tick to flush the message above, which
   * is the only thing anybody will have to debug from.
   */
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 100).unref();
});
