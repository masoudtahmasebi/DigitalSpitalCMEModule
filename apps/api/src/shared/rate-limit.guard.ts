/**
 * Applies a rate-limit rule to a route (P10-03).
 *
 * Runs as a global guard **after** `AuthGuard`, so `request.principal` is
 * available and the counter can be keyed on the user id. Falling back to the
 * client IP only when there is no principal matters: keying purely on IP would
 * let one physician exhaust the quota for a whole hospital behind a single
 * NAT address.
 *
 * A route with no `@RateLimit()` decorator is unlimited, which is the right
 * default here — unlike authorisation, where deny-by-default is correct, an
 * accidentally unlimited read is a performance question, and a wrongly
 * throttled learner loses watch data that gates their CME points.
 *
 * ## When Redis cannot be asked (P249-03, RUN-3)
 *
 * A store failure used to escape this guard as an unknown error, so all
 * rate-limited routes answered 500 for the length of a Redis outage — sign-in
 * and progress alike. Each rule now declares `onStoreFailure`: `closed`
 * refuses with a 503 problem document and `Retry-After`; `open` serves the
 * request unthrottled. Both increment
 * `ds_rate_limit_store_failures_total{rule,policy}` on every failure, and log
 * at most once a minute per rule, so an outage is one line per rule per minute
 * rather than one per request.
 *
 * How long "cannot be asked" takes is the Redis client's `commandTimeout`
 * (`db.module.ts`): without it a command queued against a dead connection
 * waited for reconnects instead of failing.
 */

import {
  Inject,
  Injectable,
  Logger,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request, Response } from "express";
import { AppError } from "./problem-details.js";
import { Metrics } from "../observability/metrics.js";
import {
  RATE_LIMIT_RULES,
  RateLimiter,
  type RateLimitDecision,
  type RateLimitName,
} from "./rate-limit.js";

/** How long a refused caller is told to wait while the store is down. */
const STORE_FAILURE_RETRY_AFTER_SEC = 30;
/** At most one log line per rule per this many milliseconds. */
const STORE_FAILURE_LOG_INTERVAL_MS = 60_000;

export const RATE_LIMIT_KEY = "ds:rate-limit";

/** Names the rule from `RATE_LIMIT_RULES`, so limits live in one place. */
export const RateLimit = (name: RateLimitName) => SetMetadata(RATE_LIMIT_KEY, name);

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
    @Inject(Metrics) private readonly metrics: Metrics,
  ) {}

  private readonly logger = new Logger(RateLimitGuard.name);
  /** When each rule last logged a store failure, in epoch milliseconds. */
  private readonly lastLogged = new Map<RateLimitName, number>();

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const name = this.reflector.getAllAndOverride<RateLimitName | undefined>(
      RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (name === undefined) return true;

    const request = context.switchToHttp().getRequest<Request>();

    /*
     * `staffProfile` is consulted because staff routes above the tenant have no
     * `principal` at all — there is no customer to resolve a role within
     * (ADR-0012). Without it every such route would key on the client IP, and
     * two operators sharing an office NAT would share a quota: one of them
     * creating customers would throttle the other's session lookups.
     *
     * Both ids name the same account when both are present, so the order is
     * arbitrary; what matters is that neither is skipped.
     */
    const subject =
      request.principal?.userId ?? request.staffProfile?.id ?? request.ip ?? "unknown";

    const response = context.switchToHttp().getResponse<Response>();

    let decision: RateLimitDecision;
    try {
      decision = await this.limiter.check(name, subject, new Date());
    } catch (error) {
      return this.storeFailed(name, error, response);
    }

    // Standard headers so a well-behaved client can back off before being
    // refused, rather than discovering the limit by hitting it.
    response.setHeader("RateLimit-Limit", decision.limit);
    response.setHeader("RateLimit-Remaining", decision.remaining);

    if (!decision.allowed) {
      response.setHeader("Retry-After", decision.retryAfterSec);
      throw new AppError(
        "rate_limited",
        `rate limit ${name} exceeded by subject=${subject}`,
        "Zu viele Anfragen. Bitte versuchen Sie es in Kürze erneut.",
      );
    }

    return true;
  }

  /** The rule's declared policy, counted and (at most once a minute) logged. */
  private storeFailed(name: RateLimitName, error: unknown, response: Response): boolean {
    const policy = RATE_LIMIT_RULES[name].onStoreFailure;
    this.metrics.increment("rate_limit_store_failures", { rule: name, policy });

    const now = Date.now();
    const last = this.lastLogged.get(name);
    if (last === undefined || now - last >= STORE_FAILURE_LOG_INTERVAL_MS) {
      this.lastLogged.set(name, now);
      // The error's name and message only: an ioredis message names the
      // command, never a key or a value.
      this.logger.warn(
        `rate limit store unavailable for rule=${name} policy=${policy}: ${
          error instanceof Error ? `${error.name}: ${error.message}` : "unknown"
        }`,
      );
    }

    if (policy === "open") return true;

    response.setHeader("Retry-After", STORE_FAILURE_RETRY_AFTER_SEC);
    throw new AppError(
      "unavailable",
      `rate limit store unavailable; rule ${name} fails closed`,
      "Dieser Dienst ist vorübergehend nicht erreichbar. Bitte versuchen Sie es in Kürze erneut.",
    );
  }
}
