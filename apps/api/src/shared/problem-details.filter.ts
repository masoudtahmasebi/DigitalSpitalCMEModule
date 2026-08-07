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
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { currentCorrelationId, runWithContext } from "../observability/correlation.js";
import { JsonLogger } from "../observability/logger.js";
import {
  AppError,
  schemaRejectionAsAppError,
  toProblemDetails,
} from "./problem-details.js";

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  constructor(private readonly logger: JsonLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    // Outside a request there is no ambient context, so the fallback id below
    // would appear in the client's problem document and in **no log line at
    // all** — an id somebody can quote that matches nothing. Opening a context
    // for the duration of the handling makes the invariant "the id you were
    // shown is the id in the log" hold by construction, rather than by two
    // places agreeing.
    //
    // Inside a request this is a no-op: `currentCorrelationId()` already
    // returns the id the middleware opened, and re-entering with the same value
    // changes nothing.
    if (currentCorrelationId() === undefined) {
      runWithContext({ correlationId: randomUUID() }, () => {
        this.handle(exception, host);
      });
      return;
    }
    this.handle(exception, host);
  }

  private handle(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    // The **request's** id, not a new one (P25-01).
    //
    // This used to be `randomUUID()` here, which meant the id identified the
    // error and nothing else: there was no access-log line carrying it, no way
    // to see what the client asked for, which tenant it was, or how long it ran
    // before failing. The id a user quoted from their browser matched exactly
    // one line in the log — the failure itself, with no context around it.
    //
    // Every production bug in this project so far has been diagnosed from a
    // screenshot of somebody's DevTools instead. This is why.
    //
    // The fallback still exists because an error thrown outside a request —
    // there should be none, but a filter is the wrong place to be sure — must
    // still get an id rather than none.
    // Always present: `catch` above guarantees a context exists by here.
    const correlationId = currentCorrelationId() ?? randomUUID();

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
    // Structured, so "every 500 in the last hour" is a `jq` filter rather than
    // a grep over prose. The stack goes in a named field and is redacted with
    // everything else — a stack quotes source lines, and in this codebase those
    // include SQL.
    this.logger.write_("error", "unhandled error", {
      method: request.method,
      route: path,
      error: exception instanceof Error ? exception : String(exception),
      stack: exception instanceof Error ? exception.stack : undefined,
    });

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
    _correlationId: string,
    request: Request,
    path: string,
  ): void {
    // The internal reason is exactly the detail that must never reach the
    // client — logged here, not in the response. `reason` is written by us and
    // carries ids and slugs; ADR-0004 forbids putting an EFN, a name or a
    // free-text evaluation answer in one.
    // `warn`, not `error`: a 404 or a 422 is the system working. Logging these
    // at error level is how an error-rate alert becomes noise somebody mutes.
    this.logger.write_("warn", "refused", {
      kind: error.kind,
      method: request.method,
      route: path,
      reason: error.reason,
    });
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
