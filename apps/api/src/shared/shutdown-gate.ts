/**
 * Refuse new work while the process is shutting down (P249-04, RUN-4).
 *
 * ## Why this exists
 *
 * Nest shuts down in three phases: every provider's `onModuleDestroy`, then the
 * HTTP server is closed, then every `onApplicationShutdown`. Until P249-04 the
 * pools were ended in the first phase while the server was still accepting, so
 * each request in that window reached an ended pool and answered **500** —
 * logged as `Cannot use a pool after calling end on the pool`. A routine
 * redeploy produced a burst of our-fault errors for callers who had done
 * nothing wrong.
 *
 * The pools now close in the last phase (`DbModule.onApplicationShutdown`),
 * and this gate closes in the first: from the moment shutdown begins, a new
 * request is answered **503** as a problem document with `Connection: close`,
 * which a client or Caddy reads as "try another instance, or again shortly".
 * Requests already in flight finish on open pools, because the server's own
 * `close` waits for them before the last phase runs.
 *
 * It answers directly rather than throwing into `ProblemDetailsFilter`: it is
 * registered before every other middleware, so nothing that could fail —
 * CORS, the tenant lookup, the body parser — runs for a request that is going
 * to be refused anyway.
 */

import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";

@Injectable()
export class ShutdownGate implements OnModuleDestroy {
  private closing = false;

  get isClosing(): boolean {
    return this.closing;
  }

  onModuleDestroy(): void {
    this.closing = true;
  }
}

/** Seconds a refused caller should wait; a replacement container starts in a few. */
const RETRY_AFTER_SEC = 5;

export function refuseWhileClosing(
  gate: ShutdownGate,
): (request: Request, response: Response, next: NextFunction) => void {
  return (request, response, next) => {
    if (!gate.isClosing) {
      next();
      return;
    }

    const url = request.originalUrl;
    const query = url.indexOf("?");
    response
      .status(503)
      .set({
        connection: "close",
        "retry-after": String(RETRY_AFTER_SEC),
        "content-type": "application/problem+json; charset=utf-8",
      })
      .send(
        JSON.stringify({
          type: "https://docs.ds-education.de/errors/shutting_down",
          title: "Service Unavailable",
          status: 503,
          // The path only — the query is where capability tokens live, and
          // `ProblemDetailsFilter` drops it for the same reason.
          instance: (query === -1 ? url : url.slice(0, query)).slice(0, 200),
        }),
      );
  };
}
