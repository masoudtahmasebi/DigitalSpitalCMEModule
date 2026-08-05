/**
 * Redis-backed rate limiting (P10-03).
 *
 * Backed by Redis rather than in-process counters because the limit must hold
 * across instances — a per-process counter multiplies the real limit by the
 * number of replicas, which is the same as not having one.
 *
 * ## What is limited, and what deliberately is not
 *
 * The costs worth bounding are the ones an attacker can turn into work or into
 * an attempt: quiz submissions (scoring, and guessing at the answer key),
 * completion (an EIV submission), and EFN writes. Those get tight limits.
 *
 * **Progress heartbeats are deliberately generous.** A 25-minute video
 * reporting every few seconds is a legitimate learner producing hundreds of
 * requests, and throttling them would lose watch data — which, since watch
 * coverage gates a CME point, means punishing a real physician for watching
 * the course properly (P10-03 acceptance criterion).
 *
 * The counter is a fixed window: one `INCR` and one `EXPIRE`, cheap and
 * good enough. A sliding window would smooth the boundary but costs a sorted
 * set per key, and nothing here needs that precision.
 */

export interface RateLimitStore {
  /** Increments the key and returns the new count; sets the TTL on first use. */
  increment(key: string, windowSec: number): Promise<number>;
}

export interface RateLimitRule {
  readonly limit: number;
  readonly windowSec: number;
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  readonly retryAfterSec: number;
}

/**
 * The rules, keyed by a stable name rather than a path, so a route can be
 * renamed without silently losing its limit.
 */
export const RATE_LIMIT_RULES = {
  /** Scoring plus answer-key guessing. The tightest limit in the system. */
  quizSubmit: { limit: 10, windowSec: 60 },
  /** Each one can queue a Punktemeldung. */
  completion: { limit: 5, windowSec: 60 },
  /** Cheap to serve, but a write of personal data. */
  efnWrite: { limit: 10, windowSec: 60 },
  /** Generous on purpose — see the note above. */
  progress: { limit: 600, windowSec: 60 },
  /**
   * Rendering a PDF is the most expensive thing a learner token can ask for:
   * pdf-lib composes the document, embeds two images and draws two barcodes,
   * all on the event loop. A learner legitimately downloads their certificate
   * once, occasionally twice. A loop over this endpoint is a CPU denial of
   * service that requires nothing but a valid token.
   */
  certificatePdf: { limit: 10, windowSec: 60 },
  /**
   * Admin uploads: a font is up to 2 MB and the certificate images 512 KB
   * each, all written to bytea. The role check already limits who can do this,
   * so the limit is about a stuck client or a compromised admin session
   * filling a disk, not about an anonymous attacker.
   */
  adminUpload: { limit: 20, windowSec: 60 },
  /**
   * A participant export is where personal data leaves the system's access
   * controls entirely. Every one of them is audited (P9-07); a limit is what
   * keeps that audit trail a record of deliberate acts rather than of a script.
   */
  adminExport: { limit: 10, windowSec: 60 },
  /**
   * Creating a customer mints a tenant boundary. Nobody legitimately does it in
   * bulk, and an accidental loop in a console script should stop rather than
   * seed fifty empty tenants that then have to be found and deleted one by one.
   */
  customerCreate: { limit: 10, windowSec: 60 },
  /**
   * Erasing a subject is irreversible, cross-tenant, and something an operator
   * does a handful of times a year. There is no version of "erase fifty
   * subjects quickly" that is not either a mistake or an attack.
   */
  subjectErasure: { limit: 5, windowSec: 300 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitName = keyof typeof RATE_LIMIT_RULES;

export class RedisRateLimitStore implements RateLimitStore {
  constructor(
    private readonly redis: {
      incr(key: string): Promise<number>;
      expire(key: string, seconds: number): Promise<unknown>;
    },
  ) {}

  async increment(key: string, windowSec: number): Promise<number> {
    const count = await this.redis.incr(key);
    // Only the first increment in a window sets the expiry; refreshing it on
    // every hit would let a steady stream of requests keep the window open
    // forever and never reset the count.
    if (count === 1) await this.redis.expire(key, windowSec);
    return count;
  }
}

export class RateLimiter {
  constructor(private readonly store: RateLimitStore) {}

  /**
   * `subject` is the user id where one is known, and the client IP otherwise.
   * Keying on the user is what stops one learner's quota being consumed by
   * another behind the same hospital NAT.
   */
  async check(
    name: RateLimitName,
    subject: string,
    now: Date,
  ): Promise<RateLimitDecision> {
    const rule = RATE_LIMIT_RULES[name];
    const window = Math.floor(now.getTime() / 1000 / rule.windowSec);
    const key = `ratelimit:${name}:${subject}:${window}`;

    const count = await this.store.increment(key, rule.windowSec);
    const allowed = count <= rule.limit;

    // Seconds until this fixed window rolls over.
    const retryAfterSec = allowed
      ? 0
      : (window + 1) * rule.windowSec - Math.floor(now.getTime() / 1000);

    return {
      allowed,
      limit: rule.limit,
      remaining: Math.max(0, rule.limit - count),
      retryAfterSec,
    };
  }
}
