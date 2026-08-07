/**
 * The logger, the metrics registry and the request middleware (P25-01).
 *
 * `@Global` so nothing has to import it to log. That is a deliberate exception
 * to how every other module in this codebase is wired: observability is
 * cross-cutting by definition, and a module that had to be listed in every
 * feature's imports would be one somebody eventually forgets — leaving a
 * feature whose failures are invisible.
 *
 * The providers are registered with `useFactory` and an explicit `inject`
 * array, like everything else here. See `identity-provider.boot-check.ts` for
 * why type-based injection is not used anywhere in this application.
 */

import {
  Global,
  Inject,
  Module,
  type MiddlewareConsumer,
  type NestModule,
} from "@nestjs/common";
import type { AppConfig } from "../config/config.js";
import { APP_CONFIG } from "../db/tokens.js";
import { JsonLogger, levelFrom } from "./logger.js";
import { Metrics } from "./metrics.js";
import { RequestLoggingMiddleware } from "./request-logging.middleware.js";

@Global()
@Module({
  providers: [
    {
      provide: JsonLogger,
      useFactory: (config: AppConfig) => new JsonLogger(levelFrom(config.LOG_LEVEL)),
      inject: [APP_CONFIG],
    },
    { provide: Metrics, useFactory: () => new Metrics() },
    {
      provide: RequestLoggingMiddleware,
      useFactory: (logger: JsonLogger, metrics: Metrics) =>
        new RequestLoggingMiddleware(logger, metrics),
      inject: [JsonLogger, Metrics],
    },
  ],
  exports: [JsonLogger, Metrics],
})
export class ObservabilityModule implements NestModule {
  constructor(
    @Inject(RequestLoggingMiddleware)
    private readonly middleware: RequestLoggingMiddleware,
  ) {}

  configure(consumer: MiddlewareConsumer): void {
    // Every route, including the ones no controller claims. A 404 that never
    // reached a handler is still a request somebody made, and "the path was
    // wrong" is a diagnosis nobody can reach without seeing it.
    consumer.apply(this.middleware.use.bind(this.middleware)).forRoutes("*");
  }
}
