/**
 * Global exception filter — the single place a thrown value becomes an HTTP
 * response (`CLAUDE.md` §5: every error crossing the API boundary uses the
 * problem-details shape; no stack trace or internal identifier leaks).
 *
 * Three cases:
 * - `AppError` → its own kind/status, `clientDetail` if the error chose to set
 *   one, otherwise nothing beyond the generic title.
 * - Nest's built-in `HttpException` (thrown by pipes, e.g. a malformed route
 *   param) → mapped by status, message kept since Nest's own messages are
 *   already client-safe by construction.
 * - Anything else → bare 500. An unexpected error's message is, by
 *   definition, not something we have decided is safe to disclose.
 *
 * Every unexpected error is logged server-side with a correlation id before
 * being reduced to a safe response, so the detail is never lost — only kept
 * off the wire.
 *
 * ## Query strings are never logged and never echoed
 *
 * `request.originalUrl` carries the query string, and a query string is where
 * capability tokens end up. Today ours carry only a project slug and a
 * cache-busting version, so nothing is leaking right now — but
 * `certificates.download_token` already exists in the schema for the emailed
 * certificate, and the first link that carries one will put it here. A log
 * line is the wrong place for it: logs outlive sessions, are shipped where the
 * database is not, and are read by people who have no business being able to
 * download somebody's Teilnahmebescheinigung.
 *
 * Dropping the query now means that link cannot introduce the leak later.
 *
 * So the path is used and the query is dropped, in the log **and** in the
 * response's `instance`. This is a data-minimisation rule (Art. 5(1)(c) GDPR)
 * as much as a security one, and it is applied here rather than at each call
 * site because there is exactly one place every error passes through.
 */

import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import {
  AppError,
  schemaRejectionAsAppError,
  toProblemDetails,
} from "./problem-details.js";

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger("ProblemDetailsFilter");

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const correlationId = randomUUID();

    const path = safePath(request);

    /*
     * A schema rejection is normalised into an `AppError` here rather than
     * falling through to the 500 branch.
     *
     * Most controllers wrap `safeParse` in a local helper that already
     * produces one. Some call `schema.parse` directly, and a `ZodError`
     * reaching this filter used to be reported as "Internal server error" —
     * telling a caller who sent a malformed body that the server is broken,
     * and burying a client-fixable mistake in the 500 rate.
     */
    const appError =
      exception instanceof AppError ? exception : schemaRejectionAsAppError(exception);

    if (appError !== undefined) {
      const problem = toProblemDetails(appError, path);
      this.logAppError(appError, correlationId, request, path);
      response.status(problem.status).json({ ...problem, correlationId });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const message =
        typeof body === "string" ? body : ((body as { message?: string }).message ?? "");

      response.status(status).json({
        type: "https://docs.ds-education.de/errors/http",
        title: HttpStatus[status] ?? "Error",
        status,
        ...(message === "" ? {} : { detail: message }),
        instance: path,
        correlationId,
      });
      return;
    }

    // Unknown failure. Logged in full server-side; the client gets nothing
    // beyond a correlation id to quote back.
    this.logger.error(
      `unhandled error [${correlationId}] ${request.method} ${path}`,
      exception instanceof Error ? exception.stack : String(exception),
    );

    response.status(500).json({
      type: "https://docs.ds-education.de/errors/internal",
      title: "Internal server error",
      status: 500,
      instance: path,
      correlationId,
    });
  }

  private logAppError(
    error: AppError,
    correlationId: string,
    request: Request,
    path: string,
  ): void {
    // The internal reason is exactly the detail that must never reach the
    // client — logged here, not in the response. `reason` is written by us and
    // carries ids and slugs; ADR-0004 forbids putting an EFN, a name or a
    // free-text evaluation answer in one.
    this.logger.warn(
      `${error.kind} [${correlationId}] ${request.method} ${path}: ${error.reason}`,
    );
  }
}

/**
 * The request path with the query string removed.
 *
 * Truncated as well: a path is a route, and a kilobyte of it is somebody
 * probing rather than somebody browsing. Logging the whole of it would let a
 * caller choose how much of our log file they fill.
 */
function safePath(request: Request): string {
  const url = request.originalUrl;
  const query = url.indexOf("?");
  return (query === -1 ? url : url.slice(0, query)).slice(0, MAX_LOGGED_PATH);
}

const MAX_LOGGED_PATH = 200;
