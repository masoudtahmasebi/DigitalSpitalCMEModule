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
import { AppError, toProblemDetails } from "./problem-details.js";

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger("ProblemDetailsFilter");

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const correlationId = randomUUID();

    if (exception instanceof AppError) {
      const problem = toProblemDetails(exception, request.originalUrl);
      this.logAppError(exception, correlationId, request);
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
        instance: request.originalUrl,
        correlationId,
      });
      return;
    }

    // Unknown failure. Logged in full server-side; the client gets nothing
    // beyond a correlation id to quote back.
    this.logger.error(
      `unhandled error [${correlationId}] ${request.method} ${request.originalUrl}`,
      exception instanceof Error ? exception.stack : String(exception),
    );

    response.status(500).json({
      type: "https://docs.ds-education.de/errors/internal",
      title: "Internal server error",
      status: 500,
      instance: request.originalUrl,
      correlationId,
    });
  }

  private logAppError(error: AppError, correlationId: string, request: Request): void {
    // The internal reason is exactly the detail that must never reach the
    // client — logged here, not in the response.
    this.logger.warn(
      `${error.kind} [${correlationId}] ${request.method} ${request.originalUrl}: ${error.reason}`,
    );
  }
}
