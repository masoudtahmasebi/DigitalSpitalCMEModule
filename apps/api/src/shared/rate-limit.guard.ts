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
 */

import {
  Inject,
  Injectable,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request, Response } from "express";
import { AppError } from "./problem-details.js";
import { RateLimiter, type RateLimitName } from "./rate-limit.js";

export const RATE_LIMIT_KEY = "ds:rate-limit";

/** Names the rule from `RATE_LIMIT_RULES`, so limits live in one place. */
export const RateLimit = (name: RateLimitName) => SetMetadata(RATE_LIMIT_KEY, name);

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const name = this.reflector.getAllAndOverride<RateLimitName | undefined>(
      RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (name === undefined) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const subject = request.principal?.userId ?? request.ip ?? "unknown";

    const decision = await this.limiter.check(name, subject, new Date());

    // Standard headers so a well-behaved client can back off before being
    // refused, rather than discovering the limit by hitting it.
    const response = context.switchToHttp().getResponse<Response>();
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
}
