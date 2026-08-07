/**
 * One line per request, and the id that makes everything else findable (P25-01).
 *
 * ## Why middleware and not an interceptor
 *
 * A Nest interceptor runs **after** the guards. Every authentication failure —
 * a 401, an expired session, a missing tenant header, a CORS-adjacent
 * misconfiguration — happens before an interceptor is reached, so those
 * requests would have no context and no access-log line at all. Those are
 * exactly the requests that have needed diagnosing in this project.
 *
 * Middleware runs first. The context opened here wraps the guards, the handler
 * and the error filter alike.
 *
 * ## What is logged, and what is not
 *
 * Method, route, status, duration, tenant, actor. **Never the query string, the
 * body, or any header but the ones named here** — a query string carries
 * `?email=`, a body carries an EFN, and `Authorization` carries a token. The
 * path is logged as the *matched route template* where one exists
 * (`/courses/:slug`), so a log can be aggregated by endpoint rather than by
 * every distinct slug.
 *
 * The whole line still goes through `redact` in the logger. That is belt and
 * braces on purpose: the fields chosen here are the policy, and the redactor is
 * what holds when somebody later adds a field without thinking about it.
 *
 * ## Why the response echoes the id
 *
 * `X-Request-Id` comes back on every response, success or failure. It is what
 * lets somebody paste an id from a browser's network tab into `journalctl` —
 * which is how every bug in this project has actually been reported.
 */

import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { correlationIdFrom, runWithContext, type RequestContext } from "./correlation.js";
import type { JsonLogger } from "./logger.js";
import type { Metrics } from "./metrics.js";

/** Paths that would otherwise be most of the log volume and none of its value. */
const QUIET = new Set(["/health", "/health/live", "/health/ready", "/metrics"]);

@Injectable()
export class RequestLoggingMiddleware implements NestMiddleware {
  constructor(
    private readonly logger: JsonLogger,
    private readonly metrics: Metrics,
  ) {}

  use(request: Request, response: Response, next: NextFunction): void {
    const started = process.hrtime.bigint();
    const context: RequestContext = {
      correlationId: correlationIdFrom(request.headers["x-request-id"]),
    };

    // Set before `next()`, so it is present even if something downstream throws
    // before the response is written.
    response.setHeader("X-Request-Id", context.correlationId);

    runWithContext(context, () => {
      response.on("finish", () => {
        const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;

        // The route template Express matched, which is what makes a log
        // aggregatable. `request.route` is only set once a handler ran, so a
        // 404 or a guard refusal falls back to the path — with the query string
        // removed, because that is where `?email=` lives.
        const route =
          typeof request.route?.path === "string"
            ? `${request.baseUrl ?? ""}${request.route.path}`
            : (request.originalUrl.split("?")[0] ?? request.path);

        this.metrics.observeRequest(
          request.method,
          route,
          response.statusCode,
          durationMs,
        );

        if (QUIET.has(route) && response.statusCode < 400) return;

        this.logger.write_(response.statusCode >= 500 ? "error" : "info", "request", {
          method: request.method,
          route,
          status: response.statusCode,
          durationMs: Math.round(durationMs),
          // Present only when the guard resolved one. Its absence on a 401 is
          // itself the diagnostic.
          ...(context.customerId === undefined ? {} : { customerId: context.customerId }),
        });
      });

      next();
    });
  }
}
